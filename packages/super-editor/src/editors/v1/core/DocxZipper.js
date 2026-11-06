import { readPeopleRelationship, PEOPLE_CONTENT_TYPE } from './super-converter/comment-author-identity.js';
import * as xmljs from 'xml-js';
import JSZip from 'jszip';
import { getContentTypesFromXml, base64ToUint8Array, detectImageType } from './super-converter/helpers.js';
import { ensureXmlString, isXmlLike } from './encoding-helpers.js';
import { DOCX } from '@superdoc/common';
import { COMMENT_FILE_BASENAMES } from './super-converter/constants.js';
import { syncPackageMetadata } from './opc/sync-package-metadata.js';
import { reconcileDocumentRelationships, MANAGED_DOCUMENT_PARTS } from './opc/reconcile-document-relationships.js';
import { validateEmbeddedFonts } from './opc/validate-embedded-fonts.js';
import { serializeOpcXml } from './opc/xml-serialization.js';

/** Image file extensions recognized during import and export. */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif', 'emf', 'wmf', 'svg', 'webp']);

/** Map file extensions to correct MIME sub-types where they differ. */
const MIME_TYPE_FOR_EXT = { tif: 'tiff', jpg: 'jpeg', svg: 'svg+xml' };
const CUSTOM_XML_ITEM_PROPS_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml';
const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** Match a content-types expanded name, including namespace declarations local to a child. */
function isContentTypesElement(element, localName, parentAttributes = {}) {
  const [prefix, name] = element.name?.includes(':') ? element.name.split(':') : ['', element.name];
  const declaration = prefix ? `xmlns:${prefix}` : 'xmlns';
  return (
    element.type === 'element' &&
    name === localName &&
    (element.attributes?.[declaration] ?? parentAttributes[declaration]) === CONTENT_TYPES_NAMESPACE
  );
}

/** OOXML content types for embedded font file extensions. */
const FONT_CONTENT_TYPES = {
  odttf: 'application/vnd.openxmlformats-officedocument.obfuscatedFont',
  ttf: 'application/x-font-ttf',
  otf: 'application/vnd.ms-opentype',
};

/**
 * Class to handle unzipping and zipping of docx files
 */
class DocxZipper {
  constructor(params = {}) {
    this.debug = params.debug || false;
    this.zip = new JSZip();
    this.files = [];
    this.media = {};
    this.mediaFiles = {};
    this.fonts = {};
    /** @type {Uint8Array | null} Decrypted ZIP bytes when the input was encrypted, otherwise null. */
    this.decryptedFileData = null;
  }

  /**
   * Read the first `n` bytes from any supported file input type.
   * Used for magic-byte detection without converting the entire file to bytes.
   */
  async #peekBytes(file, n) {
    if (file instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(file))) {
      return new Uint8Array(file.buffer, file.byteOffset, Math.min(n, file.byteLength));
    }
    if (file instanceof ArrayBuffer) {
      return new Uint8Array(file, 0, Math.min(n, file.byteLength));
    }
    // Blob / File — read the first n bytes via FileReader or arrayBuffer()
    if (typeof Blob !== 'undefined' && file instanceof Blob) {
      try {
        // Prefer Blob.arrayBuffer() (standard, available in modern runtimes)
        if (typeof file.arrayBuffer === 'function') {
          const buf = await file.arrayBuffer();
          return new Uint8Array(buf, 0, Math.min(n, buf.byteLength));
        }
      } catch {
        // Fall through to empty — treat as unknown (normal ZIP path)
      }
    }
    // Unknown type — return empty so detectContainerType returns 'unknown'
    // and we fall through to the normal JSZip path
    return new Uint8Array(0);
  }

  /**
   * Get all docx data from the zipped docx
   *
   * [ContentTypes].xml
   * _rels/.rels
   * word/document.xml
   * word/_rels/document.xml.rels
   * word/footnotes.xml
   * word/endnotes.xml
   * word/header1.xml
   * word/theme/theme1.xml
   * word/settings.xml
   * word/styles.xml
   * word/webSettings.xml
   * word/fontTable.xml
   * docProps/core.xml
   * docProps/app.xml
   * */
  async getDocxData(file, isNode = false, options = {}) {
    // Detect encrypted files before JSZip sees them. We only need raw bytes
    // for the 8-byte magic check; if the file is a normal ZIP we hand the
    // original input straight to JSZip (which accepts Blob, Buffer, etc.).
    const { detectContainerType } = await import('./ooxml-encryption/detect-container.js');

    const peekBytes = await this.#peekBytes(file, 8);
    const containerType = detectContainerType(peekBytes);

    let fileData = file;
    if (containerType === 'cfb') {
      // Encrypted CFB container — must decrypt before JSZip can parse it
      const { decryptDocxIfNeeded } = await import('./ooxml-encryption/decrypt-docx.js');
      const raw =
        file instanceof Uint8Array
          ? file
          : file instanceof ArrayBuffer
            ? new Uint8Array(file)
            : new Uint8Array(await file.arrayBuffer());
      const result = await decryptDocxIfNeeded(raw, { password: options.password });
      fileData = result.data;
      // Store decrypted ZIP bytes so the export path can use them instead of
      // the original encrypted source — avoids re-decryption and ensures
      // exportFromOriginalFile() receives a valid ZIP, not a CFB container.
      this.decryptedFileData = result.data;
    }
    // If caller supplied a password but the file isn't encrypted, ignore it.

    const extractedFiles = await this.unzip(fileData);
    const files = Object.entries(extractedFiles.files);

    for (const [, zipEntry] of files) {
      const name = zipEntry.name;

      if (isXmlLike(name)) {
        // Read raw bytes and decode (handles UTF-8 & UTF-16)
        const u8 = await zipEntry.async('uint8array');
        const content = ensureXmlString(u8);
        this.files.push({ name, content });
      } else if (
        (name.startsWith('word/media') && name !== 'word/media/') ||
        (zipEntry.name.startsWith('media') && zipEntry.name !== 'media/') ||
        (name.startsWith('media') && name !== 'media/') ||
        (name.startsWith('word/embeddings') && name !== 'word/embeddings/')
      ) {
        // Media and embedded binaries (charts, OLE)
        if (isNode) {
          const buffer = await zipEntry.async('nodebuffer');
          const fileBase64 = buffer.toString('base64');
          this.mediaFiles[name] = fileBase64;
        } else {
          const fileBase64 = await zipEntry.async('base64');
          let extension = this.getFileExtension(name)?.toLowerCase();
          // Only build data URIs for images; keep raw base64 for other binaries (e.g., xlsx)
          // For unknown extensions (like .tmp), try to detect the image type from content
          let detectedType = null;
          if (!IMAGE_EXTS.has(extension) || extension === 'tmp') {
            detectedType = detectImageType(fileBase64);
            if (detectedType) {
              extension = detectedType;
            }
          }

          if (IMAGE_EXTS.has(extension)) {
            const mimeSubtype = MIME_TYPE_FOR_EXT[extension] || extension;
            this.mediaFiles[name] = `data:image/${mimeSubtype};base64,${fileBase64}`;
            const blob = await zipEntry.async('blob');
            const fileObj = new File([blob], name, { type: blob.type });
            const imageUrl = URL.createObjectURL(fileObj);
            this.media[name] = imageUrl;
          } else {
            this.mediaFiles[name] = fileBase64;
          }
        }
      } else if (name.startsWith('word/fonts') && name !== 'word/fonts/') {
        // Font files
        const uint8array = await zipEntry.async('uint8array');
        this.fonts[name] = uint8array;
      }
    }

    return this.files;
  }

  getFileExtension(fileName) {
    const fileSplit = fileName.split('.');
    if (fileSplit.length < 2) return null;
    return fileSplit[fileSplit.length - 1];
  }

  /**
   * Update [Content_Types].xml with extensions of new Image annotations
   */
  async updateContentTypes(docx, media, fromJson, updatedDocs = {}, fonts = {}) {
    const additionalPartNames = Object.keys(updatedDocs || {});
    const newMediaTypes = Object.keys(media)
      .map((name) => this.getFileExtension(name))
      .filter((ext) => ext && IMAGE_EXTS.has(ext));
    const extensionlessMediaOverrides = Object.entries(media)
      .filter(([name]) => !this.getFileExtension(name))
      .map(([name, value]) => ({ name, contentType: this.#detectImageContentType(value) }))
      .filter((entry) => entry.contentType);

    const contentTypesPath = '[Content_Types].xml';
    let contentTypesXml;
    if (fromJson) {
      if (Array.isArray(docx.files)) {
        contentTypesXml = docx.files.find((file) => file.name === contentTypesPath)?.content || '';
      } else {
        contentTypesXml = docx.files?.[contentTypesPath] || '';
      }
    } else contentTypesXml = await docx.file(contentTypesPath).async('string');

    let typesString = '';

    const defaultMediaTypes = getContentTypesFromXml(contentTypesXml);

    // Update media types in content types
    const seenTypes = new Set();
    for (let type of newMediaTypes) {
      // Current extension already presented in Content_Types
      if (defaultMediaTypes.includes(type)) continue;
      if (seenTypes.has(type)) continue;

      const mime = MIME_TYPE_FOR_EXT[type] || type;
      const newContentType = `<Default Extension="${type}" ContentType="image/${mime}"/>`;
      typesString += newContentType;
      seenTypes.add(type);
    }

    // Register content types for embedded font extensions
    if (fonts) {
      const fontExts = new Set(
        Object.keys(fonts)
          .map((name) => this.getFileExtension(name))
          .filter((ext) => ext && FONT_CONTENT_TYPES[ext]),
      );
      for (const ext of fontExts) {
        if (defaultMediaTypes.includes(ext)) continue;
        if (seenTypes.has(ext)) continue;
        typesString += `<Default Extension="${ext}" ContentType="${FONT_CONTENT_TYPES[ext]}"/>`;
        seenTypes.add(ext);
      }
    }

    // Update for comments and extensionless media overrides.
    const xmlJson = JSON.parse(xmljs.xml2json(contentTypesXml, null, 2));
    const types = xmlJson.elements?.find((el) => el.name === 'Types') || {};
    const hasPartOverride = (partName) =>
      types.elements?.some((el) => el.name === 'Override' && el.attributes.PartName === partName);

    for (const { name, contentType } of extensionlessMediaOverrides) {
      const partName = `/${name}`;
      if (hasPartOverride(partName)) continue;
      typesString += `<Override PartName="${partName}" ContentType="${contentType}" />`;
    }

    // Overrides
    const hasComments = types.elements?.some(
      (el) => el.name === 'Override' && el.attributes.PartName === '/word/comments.xml',
    );
    const hasCommentsExtended = types.elements?.some(
      (el) => el.name === 'Override' && el.attributes.PartName === '/word/commentsExtended.xml',
    );
    const hasCommentsIds = types.elements?.some(
      (el) => el.name === 'Override' && el.attributes.PartName === '/word/commentsIds.xml',
    );
    const hasCommentsExtensible = types.elements?.some(
      (el) => el.name === 'Override' && el.attributes.PartName === '/word/commentsExtensible.xml',
    );

    /**
     * Check if a file will exist in the final zip output.
     * A null value in updatedDocs means the file is explicitly deleted.
     */
    const hasFile = (filename) => {
      if (updatedDocs && Object.prototype.hasOwnProperty.call(updatedDocs, filename)) {
        return updatedDocs[filename] !== null;
      }
      if (!docx?.files) return false;
      if (!fromJson) return Boolean(docx.files[filename]);
      if (Array.isArray(docx.files)) return docx.files.some((file) => file.name === filename);
      return Boolean(docx.files[filename]);
    };

    if (hasFile('word/comments.xml')) {
      const commentsDef = `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml" />`;
      if (!hasComments) typesString += commentsDef;
    }

    if (hasFile('word/commentsExtended.xml')) {
      const commentsExtendedDef = `<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml" />`;
      if (!hasCommentsExtended) typesString += commentsExtendedDef;
    }

    if (hasFile('word/commentsIds.xml')) {
      const commentsIdsDef = `<Override PartName="/word/commentsIds.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml" />`;
      if (!hasCommentsIds) typesString += commentsIdsDef;
    }

    if (hasFile('word/commentsExtensible.xml')) {
      const commentsExtendedDef = `<Override PartName="/word/commentsExtensible.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml" />`;
      if (!hasCommentsExtensible) typesString += commentsExtendedDef;
    }

    // Update for footnotes
    const hasFootnotes = types.elements?.some(
      (el) => el.name === 'Override' && el.attributes.PartName === '/word/footnotes.xml',
    );
    const hasEndnotes = types.elements?.some(
      (el) => el.name === 'Override' && el.attributes.PartName === '/word/endnotes.xml',
    );

    if (hasFile('word/footnotes.xml')) {
      const footnotesDef = `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml" />`;
      if (!hasFootnotes) typesString += footnotesDef;
    }

    if (hasFile('word/endnotes.xml')) {
      const endnotesDef = `<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml" />`;
      if (!hasEndnotes) typesString += endnotesDef;
    }

    // Update for managed document-level singleton parts (e.g., numbering)
    for (const entry of MANAGED_DOCUMENT_PARTS) {
      if (hasFile(entry.zipPath) && !hasPartOverride(`/${entry.zipPath}`)) {
        typesString += `<Override PartName="/${entry.zipPath}" ContentType="${entry.contentType}" />`;
      }
    }

    const partNames = new Set(additionalPartNames);
    if (docx?.files) {
      if (fromJson && Array.isArray(docx.files)) {
        docx.files.forEach((file) => partNames.add(file.name));
      } else {
        Object.keys(docx.files).forEach((key) => partNames.add(key));
      }
    }

    partNames.forEach((name) => {
      if (!/^customXml\/itemProps\d+\.xml$/i.test(name)) return;
      if (!hasFile(name)) return;
      const partName = `/${name}`;
      if (hasPartOverride(partName)) return;
      typesString += `<Override PartName="${partName}" ContentType="${CUSTOM_XML_ITEM_PROPS_CONTENT_TYPE}" />`;
    });

    partNames.forEach((name) => {
      if (name.includes('.rels')) return;
      if (!name.includes('header') && !name.includes('footer')) return;
      const hasExtensible = types.elements?.some(
        (el) => el.name === 'Override' && el.attributes.PartName === `/${name}`,
      );
      const type = name.includes('header') ? 'header' : 'footer';
      const extendedDef = `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`;
      if (!hasExtensible) {
        typesString += extendedDef;
      }
    });

    // Prune stale comment Override entries for parts that will not exist in the final zip.
    const commentPartNames = COMMENT_FILE_BASENAMES.map((name) => `/word/${name}`);
    const staleOverridePartNames = commentPartNames.filter((partName) => {
      const filename = partName.slice(1); // strip leading /
      return !hasFile(filename);
    });

    // Also prune Custom XML props Override entries whose part was deleted
    // (tombstoned via updatedDocs[path] = null, e.g. by `customXml.parts.remove`).
    // Without this, [Content_Types].xml retains an Override pointing at a
    // missing part, which is spec-malformed.
    //
    // Identify by ContentType, not by filename — OOXML does not require
    // the props part to be named itemPropsN.xml. Foreign producers can
    // use arbitrary names, linked via customXml/_rels/itemN.xml.rels.
    const CUSTOM_XML_PROPS_CT = 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml';
    if (types?.elements?.length) {
      for (const el of types.elements) {
        if (el?.name !== 'Override') continue;
        if (el?.attributes?.ContentType !== CUSTOM_XML_PROPS_CT) continue;
        const partName = el?.attributes?.PartName;
        if (typeof partName !== 'string' || !partName.startsWith('/')) continue;
        const filename = partName.slice(1); // strip leading /
        if (!hasFile(filename)) staleOverridePartNames.push(partName);
      }
    }

    const beginningString = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
    let updatedContentTypesXml = contentTypesXml.replace(beginningString, `${beginningString}${typesString}`);

    // Remove Override elements for parts that no longer exist
    for (const partName of staleOverridePartNames) {
      const escapedPartName = partName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const overrideRegex = new RegExp(`\\s*<Override[^>]*PartName="${escapedPartName}"[^>]*/>`, 'g');
      updatedContentTypesXml = updatedContentTypesXml.replace(overrideRegex, '');
    }

    // Include any header/footer targets referenced from document relationships
    let relationshipsXml = updatedDocs['word/_rels/document.xml.rels'];
    if (!relationshipsXml) {
      if (fromJson) {
        if (Array.isArray(docx.files)) {
          relationshipsXml = docx.files.find((file) => file.name === 'word/_rels/document.xml.rels')?.content;
        } else {
          relationshipsXml = docx.files?.['word/_rels/document.xml.rels'];
        }
      } else {
        relationshipsXml = await docx.file('word/_rels/document.xml.rels')?.async('string');
      }
    }

    if (relationshipsXml) {
      const people = readPeopleRelationship(xmljs.xml2js(relationshipsXml));
      if (people.path && hasFile(people.path)) {
        const manifest = xmljs.xml2js(updatedContentTypesXml, { captureSpacesBetweenElements: true });
        const root = manifest.elements?.find((element) => isContentTypesElement(element, 'Types'));
        const registered = root?.elements?.some(
          (element) =>
            isContentTypesElement(element, 'Override', root.attributes) &&
            element.attributes?.PartName === `/${people.path}`,
        );
        if (root && !registered) {
          (root.elements ??= []).push({
            type: 'element',
            name: root.name.replace(/Types$/, 'Override'),
            attributes: { PartName: `/${people.path}`, ContentType: PEOPLE_CONTENT_TYPE },
          });
          updatedContentTypesXml = serializeOpcXml(manifest);
        }
      }
      try {
        const relJson = xmljs.xml2js(relationshipsXml, { compact: false });
        const relationships = relJson.elements?.find((el) => el.name === 'Relationships');
        relationships?.elements?.forEach((rel) => {
          const type = rel.attributes?.Type;
          const target = rel.attributes?.Target;
          if (!type || !target) return;
          const isHeader = type.includes('/header');
          const isFooter = type.includes('/footer');
          if (!isHeader && !isFooter) return;
          let sanitizedTarget = target.replace(/^\.\//, '');
          if (sanitizedTarget.startsWith('../')) sanitizedTarget = sanitizedTarget.slice(3);
          if (sanitizedTarget.startsWith('/')) sanitizedTarget = sanitizedTarget.slice(1);
          const partName = sanitizedTarget.startsWith('word/') ? sanitizedTarget : `word/${sanitizedTarget}`;
          partNames.add(partName);
        });
      } catch (error) {
        console.warn('Failed to parse document relationships while updating content types', error);
      }
    }

    partNames.forEach((name) => {
      if (name.includes('.rels')) return;
      if (!name.includes('header') && !name.includes('footer')) return;
      if (updatedContentTypesXml.includes(`PartName="/${name}"`)) return;
      const type = name.includes('header') ? 'header' : 'footer';
      const extendedDef = `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`;
      updatedContentTypesXml = updatedContentTypesXml.replace('</Types>', `${extendedDef}</Types>`);
    });

    // Reconcile document-level singleton relationships (e.g., numbering).
    // Parts auto-created at runtime (via mutatePart/ensurePart) may exist in
    // the package without a corresponding word/_rels/document.xml.rels entry.
    if (relationshipsXml) {
      const reconciledRels = reconcileDocumentRelationships(relationshipsXml, hasFile);
      if (reconciledRels !== relationshipsXml) {
        if (fromJson) {
          updatedDocs['word/_rels/document.xml.rels'] = reconciledRels;
        } else {
          docx.file('word/_rels/document.xml.rels', reconciledRels);
        }
      }
    }

    if (fromJson) return updatedContentTypesXml;

    docx.file(contentTypesPath, updatedContentTypesXml);
  }

  /**
   * Run the OPC package metadata synchronizer against a JSZip instance.
   *
   * Reads [Content_Types].xml and _rels/.rels from the zip, reconciles
   * managed package-level parts, and writes the corrected files back.
   *
   * The assembled zip is treated as the single source of truth — no stale
   * updatedDocs are passed, so the synchronizer sees exactly what
   * updateContentTypes() already wrote.
   *
   * @param {JSZip} zip - The fully assembled zip to reconcile.
   */
  async #syncPackageMetadataInZip(zip) {
    // Build a base-files map from the zip's current listing.
    // At this point the zip already contains all base + updated + media entries.
    const baseForSync = {};
    zip.forEach((path) => {
      baseForSync[path] = ''; // non-null signals "exists"
    });

    // Read the two metadata files the synchronizer needs to parse.
    // Use JSZip's async API to correctly handle all internal storage formats.
    const ctEntry = zip.file('[Content_Types].xml');
    if (ctEntry) {
      baseForSync['[Content_Types].xml'] = await ctEntry.async('string');
    }
    const rlEntry = zip.file('_rels/.rels');
    if (rlEntry) {
      baseForSync['_rels/.rels'] = await rlEntry.async('string');
    }

    // Pass an empty updatedDocs — the zip is already the assembled truth.
    const { contentTypesXml, relsXml } = syncPackageMetadata({
      baseFiles: baseForSync,
      updatedDocs: {},
    });

    zip.file('[Content_Types].xml', contentTypesXml);
    zip.file('_rels/.rels', relsXml);
  }

  async unzip(file) {
    const zip = await this.zip.loadAsync(file);
    return zip;
  }

  async updateZip({ docx, updatedDocs, originalDocxFile, media, fonts, isHeadless, compression = 'DEFLATE' }) {
    // We use a different re-zip process if we have the original docx vs the docx xml metadata
    let zip;

    if (originalDocxFile) {
      zip = await this.exportFromOriginalFile(originalDocxFile, updatedDocs, media, fonts);
    } else {
      zip = await this.exportFromCollaborativeDocx(docx, updatedDocs, media, fonts);
    }

    // Validate the assembled package, including parts retained from a carrier
    // file. A successful export must never leave dangling font embeddings.
    await validateEmbeddedFonts(zip);

    // If we are headless we don't have 'blob' support, so export as 'nodebuffer'
    const exportType = isHeadless ? 'nodebuffer' : 'blob';
    return await zip.generateAsync({
      type: exportType,
      mimeType: DOCX,
      compression,
      compressionOptions: compression === 'DEFLATE' ? { level: 6 } : undefined,
    });
  }

  /**
   * Export the Editor content to a docx file, updating changed docs
   * @param {Object} docx An object containing the unzipped docx files (keys are relative file names)
   * @param {Object} updatedDocs An object containing the updated docs (keys are relative file names)
   * @returns {Promise<JSZip>} The unzipped but updated docx file ready for zipping
   */
  async exportFromCollaborativeDocx(docx, updatedDocs, media, fonts) {
    if (!Array.isArray(docx)) {
      throw new Error('Collaborative DOCX export requires base package entries');
    }

    const zip = new JSZip();

    // Rebuild original files
    for (const file of docx) {
      const content = file.content;
      zip.file(file.name, content);
    }

    // Replace updated docs (null = delete from zip)
    Object.keys(updatedDocs).forEach((key) => {
      if (updatedDocs[key] === null) {
        zip.remove(key);
      } else {
        zip.file(key, updatedDocs[key]);
      }
    });

    Object.keys(media).forEach((path) => {
      const value = media[path];
      const binaryData = typeof value === 'string' ? base64ToUint8Array(value) : value;
      zip.file(path, binaryData);
    });

    // Export font files
    for (const [fontName, fontUintArray] of Object.entries(fonts)) {
      zip.file(fontName, fontUintArray);
    }

    await this.updateContentTypes(zip, media, false, updatedDocs, fonts);

    // Reconcile package-level singleton metadata as a final safety pass.
    await this.#syncPackageMetadataInZip(zip);

    return zip;
  }

  /**
   * Export the Editor content to a docx file, updating changed docs
   * Requires the original docx file
   * @param {File} originalDocxFile The original docx file
   * @param {Object} updatedDocs An object containing the updated docs (keys are relative file names)
   * @returns {Promise<JSZip>} The unzipped but updated docx file ready for zipping
   */
  async exportFromOriginalFile(originalDocxFile, updatedDocs, media, fonts) {
    const unzippedOriginalDocx = await this.unzip(originalDocxFile);
    const filePromises = [];
    unzippedOriginalDocx.forEach((relativePath, zipEntry) => {
      // Read as raw bytes to handle non-UTF-8 encodings (e.g. UTF-16 LE
      // customXml parts). XML/rels files are decoded to valid UTF-8 strings;
      // other entries are kept as raw bytes.
      const promise = zipEntry.async('uint8array').then((u8) => {
        unzippedOriginalDocx.file(zipEntry.name, isXmlLike(zipEntry.name) ? ensureXmlString(u8) : u8);
      });
      filePromises.push(promise);
    });
    await Promise.all(filePromises);

    // Make replacements of updated docs (null = delete from zip)
    Object.keys(updatedDocs).forEach((key) => {
      if (updatedDocs[key] === null) {
        unzippedOriginalDocx.remove(key);
      } else {
        unzippedOriginalDocx.file(key, updatedDocs[key]);
      }
    });

    Object.keys(media).forEach((path) => {
      unzippedOriginalDocx.file(path, media[path]);
    });

    // Export caller-supplied font files
    if (fonts) {
      for (const [fontName, fontUintArray] of Object.entries(fonts)) {
        unzippedOriginalDocx.file(fontName, fontUintArray);
      }
    }

    await this.updateContentTypes(unzippedOriginalDocx, media, false, updatedDocs, fonts);

    // Reconcile package-level singleton metadata as a final safety pass.
    await this.#syncPackageMetadataInZip(unzippedOriginalDocx);

    return unzippedOriginalDocx;
  }

  #detectImageContentType(value) {
    if (value == null) return null;

    // Data URI: trust declared MIME type.
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);/i);
      return match?.[1]?.toLowerCase() || null;
    }

    let detectedType = null;
    if (value instanceof ArrayBuffer) {
      detectedType = detectImageType(new Uint8Array(value));
    } else if (ArrayBuffer.isView(value)) {
      const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      detectedType = detectImageType(view);
    } else if (typeof value === 'string') {
      // May be raw base64 or data URI payload.
      detectedType = detectImageType(value.startsWith('data:') ? value.split(',', 2)[1] : value);
    }

    if (!detectedType) return null;
    const mimeSubtype = MIME_TYPE_FOR_EXT[detectedType] || detectedType;
    return `image/${mimeSubtype}`;
  }
}

export default DocxZipper;
