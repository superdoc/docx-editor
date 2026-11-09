/**
 * Shared DOCX privacy inspection.
 *
 * Reads the identity-bearing parts of a .docx without a ZIP dependency: a
 * DOCX is an ordinary ZIP, and Node's zlib can inflate its entries, so the
 * gate stays runnable from a clean checkout with no install step.
 *
 * Used by scripts/check-docx-privacy.mjs (report) and scripts/sanitize-docx.mjs
 * (rewrite).
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * An XML part as text, honouring its byte-order mark.
 *
 * Word writes UTF-8, but a part saved as UTF-16 decodes to NUL-separated
 * letters under a UTF-8 read, and every metadata regex then matches nothing.
 *
 * @param {Buffer} raw
 * @returns {string}
 */
export function decodeXmlPart(raw) {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString('utf16le');
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    const body = raw.subarray(2);
    // swap16 needs an even length, and a truncated part need not have one.
    const even = body.length % 2 === 0 ? body : body.subarray(0, body.length - 1);
    return Buffer.from(even).swap16().toString('utf16le');
  }
  // A BOM is not required. XML's own encoding autodetection reads the first
  // character instead, which must be `<`: a UTF-16LE part begins `3C 00` and a
  // UTF-16BE part `00 3C`. Falling straight through to UTF-8 turns such a part
  // into NUL-separated letters, and every metadata pattern in this module then
  // matches nothing — the part reads as empty rather than as unreadable, so an
  // author survives in the archive while the gate reports the fixture clean.
  if (raw.length >= 4 && raw[0] === 0x3c && raw[1] === 0x00 && raw[3] === 0x00) {
    const even = raw.length % 2 === 0 ? raw : raw.subarray(0, raw.length - 1);
    return even.toString('utf16le');
  }
  if (raw.length >= 4 && raw[0] === 0x00 && raw[1] === 0x3c && raw[2] === 0x00) {
    const even = raw.length % 2 === 0 ? raw : raw.subarray(0, raw.length - 1);
    return Buffer.from(even).swap16().toString('utf16le');
  }
  return raw.toString('utf8');
}

/**
 * Serialize XML back into a part, keeping the declaration true of the bytes.
 *
 * Everything here writes UTF-8, including parts that arrived as UTF-16 and were
 * decoded by `decodeXmlPart`. Writing UTF-8 bytes under an inherited
 * `encoding="UTF-16"` declaration produces a part that this gate reads back
 * fine — it sniffs the BOM — and that Word and any conforming XML parser
 * misdecode or reject. The declaration is the only thing a downstream reader
 * has to go on, so it has to name the encoding actually used.
 *
 * @param {string} text
 * @returns {Buffer}
 */
export function encodeXmlPart(text) {
  const normalized = text.replace(
    /^(\uFEFF?\s*<\?xml\b[^?>]*?\bencoding\s*=\s*)(["'])[^"']*\2/i,
    (whole, head, quote) => `${head}${quote}UTF-8${quote}`,
  );
  return Buffer.from(normalized, 'utf8');
}

export function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error('Not a ZIP archive (no end-of-central-directory record).');
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    // Throw rather than break. Returning the entries parsed so far would make a
    // truncated or malformed archive look like one that simply lacks the part
    // holding an author, so the gate would report it clean: a fail-open on
    // exactly the input most likely to be hiding something.
    if (offset + 46 > buffer.length) {
      throw new Error(`central directory entry ${index} runs past the end of the archive`);
    }
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`central directory entry ${index} has no central-directory signature`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    // The local header repeats the name/extra lengths, and its extra field can
    // differ in length from the central one, so read them from the local record.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    if (entries.has(name)) {
      // A later member silently replaces an earlier one, so a real core.xml
      // followed by a clean copy inspects as clean while the archive still
      // publishes both. Word never writes duplicates; refuse the archive.
      throw new Error(`Duplicate archive entry: ${name}.`);
    }
    if (method === STORED) {
      entries.set(name, Buffer.from(raw));
    } else if (method === DEFLATED) {
      entries.set(name, inflateRawSync(raw));
    } else {
      // Dropping the entry would make an uninspectable part look like an absent
      // one, and the gate would call the fixture clean. Refuse the archive.
      throw new Error(`Unsupported compression method ${method} for ${name}.`);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
  // A directory that advertises more members than it yields is malformed in a
  // way the loop above may not have caught. Refuse it rather than inspecting a
  // subset and calling the result clean.
  if (entries.size !== entryCount) {
    throw new Error(`central directory advertises ${entryCount} entries but yielded ${entries.size}`);
  }

  return entries;
}

/**
 * Whether `entryCount` central-directory headers starting at `offset` occupy
 * exactly `size` bytes.
 *
 * Walking the headers is the only way to tie a declared count to the directory
 * it claims to describe. Comparing the two catches a record that under-declares
 * its count to hide trailing entries.
 */
function describesWholeDirectory(buffer, offset, size, entryCount) {
  let cursor = offset;
  for (let seen = 0; seen < entryCount; seen += 1) {
    if (cursor + 46 > buffer.length) return false;
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) return false;
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return cursor - offset === size;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 66 * 1024);
  for (let index = buffer.length - 22; index >= minimum; index -= 1) {
    if (buffer.readUInt32LE(index) !== EOCD_SIGNATURE) continue;

    // A ZIP comment is arbitrary bytes, so it can contain an EOCD signature of
    // its own. Scanning backward for the first signature therefore lets an
    // archive nominate a forged zero-entry record as its directory, and every
    // part goes uninspected while the gate reports the file clean.
    //
    // The real record is the one whose declared comment ends exactly at the end
    // of the archive. Check that rather than trusting the signature.
    const commentLength = buffer.readUInt16LE(index + 20);
    if (index + 22 + commentLength !== buffer.length) continue;

    // The comment check alone is not enough: an appended forgery also ends at
    // the end of the archive, and the backward scan reaches it first. So verify
    // the record actually describes a directory, by checking that the offset it
    // gives lands on a central-directory signature. A zero-entry forgery
    // pointing at offset 0 fails here, and the real record behind it wins.
    const entryCount = buffer.readUInt16LE(index + 10);
    const directorySize = buffer.readUInt32LE(index + 12);
    const directoryOffset = buffer.readUInt32LE(index + 16);
    if (entryCount === 0) continue;
    if (directoryOffset + 4 > buffer.length) continue;
    if (buffer.readUInt32LE(directoryOffset) !== CENTRAL_SIGNATURE) continue;

    // Pointing at a real directory is still not enough. A forgery can reuse the
    // genuine offset and size while under-declaring the count, and the reader
    // then stops early: the parts it never reaches look absent, so an identity
    // in a later entry goes unreported and the gate calls the file clean.
    //
    // So walk exactly `entryCount` headers and require them to consume exactly
    // `directorySize` bytes. An under-declared count leaves bytes over and a
    // over-declared one runs past, either way failing this record and letting
    // the genuine one behind it win.
    if (!describesWholeDirectory(buffer, directoryOffset, directorySize, entryCount)) continue;

    // The directory must also end exactly where this record begins. Without
    // that, a forgery can declare one entry and the size of just that entry:
    // internally consistent, pointing at a real directory, and still stopping
    // the reader before the entry that holds the identity. Anchoring the end to
    // the record leaves no room to under-declare.
    if (directoryOffset + directorySize !== index) continue;

    return index;
  }
  return -1;
}

/**
 * Serialize entries back into a ZIP archive.
 *
 * Everything is DEFLATE-compressed with a zeroed timestamp so sanitizing the
 * same fixture twice produces byte-identical output. That keeps fixture diffs
 * reviewable and avoids gratuitous churn in git history.
 *
 * @param {Map<string, Buffer>} entries
 * @returns {Buffer}
 */
export function writeZipEntries(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(content, { level: 9 });
    const crc = crc32(content);

    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(DEFLATED, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x0021, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    nameBuffer.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(DEFLATED, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centrals.push(central);

    offset += local.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.size, 8);
  eocd.writeUInt16LE(entries.size, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const SCHEMA_NAMESPACE_HOSTS = [
  'schemas.microsoft.com',
  'schemas.openxmlformats.org',
  'purl.org',
  'www.w3.org',
  'w3.org',
  'dublincore.org',
];

const RFC_2606_RESERVED_HOSTS = ['example.com', 'example.org', 'example.net'];

const STANDARDS_NAMESPACE_HOSTS = [...SCHEMA_NAMESPACE_HOSTS, ...RFC_2606_RESERVED_HOSTS];

const WORD_DEFAULT_CONTENT_TYPE_NAMES = new Set(['document', 'doc', 'item', '']);

export const CONTENT_TYPE_NAME_PATTERN =
  /(?:^|\s)(?:[A-Za-z_][\w.-]*:)?contentTypeName\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

const START_TAG_PATTERN = /<[A-Za-z_](?:[^>"']|"[^"]*"|'[^']*')*>/g;

export function contentTypeNames(xml) {
  const values = [];
  START_TAG_PATTERN.lastIndex = 0;
  for (const tag of xml.matchAll(START_TAG_PATTERN)) {
    CONTENT_TYPE_NAME_PATTERN.lastIndex = 0;
    for (const match of tag[0].matchAll(CONTENT_TYPE_NAME_PATTERN)) {
      values.push(match[1] ?? match[2] ?? '');
    }
  }
  return values;
}

export const elementNameSource = (localName) => `(?:[A-Za-z_][\\w.-]*:)?${localName}`;

export const elementEndSource = (localName) => `</${elementNameSource(localName)}\\s*>`;

const START_TAG_ATTRIBUTES = String.raw`(?:"[^"]*"|'[^']*'|[^>"'])*`;

export function pairedElementPattern(localName, flags = 'gi') {
  return new RegExp(
    `(<${elementNameSource(localName)}${START_TAG_ATTRIBUTES}>)([\\s\\S]*?)(${elementEndSource(localName)})`,
    flags,
  );
}

export function emptyElementPattern(localName, flags = 'gi') {
  const open = `<${elementNameSource(localName)}${START_TAG_ATTRIBUTES}`;
  return new RegExp(`${open}/>|${open}>\\s*${elementEndSource(localName)}`, flags);
}

const RECEIVER_NAME_TAGS = ['Assembly', 'Class'];

const SHIPPED_WITH_SHAREPOINT = /^(?:Microsoft|System)\./;

export function organizationReceivers(xml) {
  const found = [];
  const receiverBlocks = [...xml.matchAll(pairedElementPattern('Receivers'))].map((match) => match[2]);
  if (receiverBlocks.length === 0) return found;
  const insideReceivers = receiverBlocks.join('\n');
  for (const tag of RECEIVER_NAME_TAGS) {
    for (const match of insideReceivers.matchAll(pairedElementPattern(tag))) {
      const value = match[2].trim();
      if (!value || SHIPPED_WITH_SHAREPOINT.test(value)) continue;
      found.push({ tag, value });
    }
  }
  return found;
}

export function isGenericContentTypeName(value) {
  return WORD_DEFAULT_CONTENT_TYPE_NAMES.has(String(value).trim().toLowerCase());
}

const WORD_DEFAULT_TEMPLATE_NAMES = new Set(['', 'Normal', 'Normal.dotm', 'Normal.dotx']);

const VERSIONED_TEMPLATE_CODE = String.raw`\b[A-Z][A-Z0-9]{2,}(?:[-_][A-Z0-9]+){1,4}\s+(?:VERSION|VER|V)\s*[\d.]+[a-z]?\b`;

const DMS_REFERENCE_NUMBER = String.raw`\b(?:DMS|NRPORTBL|IMANAGE|EDOCS)[-_ ]?\d{4,}\b`;

const DOCUMENT_STAMP_PATTERN = new RegExp(`${VERSIONED_TEMPLATE_CODE}|${DMS_REFERENCE_NUMBER}`, 'g');

const SANITIZER_SYNTHETIC_STAMP = 'SUPERDOC-TEST VERSION 1.0a';

const TOOL_CUSTOM_PROPERTIES = new Set([
  'SuperdocVersion',
  'DocumentGuid',
  'Created',
  'Producer',
  'LastSaved',
  'AppVersion',
]);

const DOCUMENT_MANAGEMENT_PROPERTY_NAME =
  /^(_dlc_|ContentTypeId$|eDOCS|iManage|NRPortbl|ClientID$|MatterID$|db_contract|.*-Document-ID$)/i;

export function isReportableCustomProperty(name) {
  return !TOOL_CUSTOM_PROPERTIES.has(name);
}

function customProperties(xml) {
  const results = [];
  const pattern = new RegExp(
    `<${elementNameSource('property')}\\b[^>]*\\bname\\s*=\\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\\s\\S]*?)${elementEndSource('property')}`,
    'gi',
  );
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    const value = match[3].replace(/<[^>]*>/g, '').trim();
    results.push({ name: (match[1] ?? match[2] ?? '').trim(), value });
  }
  return results;
}

function addsCredentialsOrContent(url) {
  return Boolean(url.username || url.password || url.search || url.hash);
}

export function isStandardsNamespace(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (addsCredentialsOrContent(parsed)) return false;
  return STANDARDS_NAMESPACE_HOSTS.includes(parsed.hostname.toLowerCase());
}

function blankXmlCommentsKeepingOffsets(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, (match) => ' '.repeat(match.length));
}

const localNameOf = (tag) => (tag.includes(':') ? tag.split(':').pop() : tag);

function everyTextValueOf(xml, tag) {
  const localName = escapeRegex(localNameOf(tag));
  return [...blankXmlCommentsKeepingOffsets(xml).matchAll(pairedElementPattern(localName, 'gi'))]
    .map((match) => match[2].trim())
    .filter(Boolean);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startTagAttributeValues(xml, attribute) {
  const values = [];
  const pattern = new RegExp(`${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gi');
  START_TAG_PATTERN.lastIndex = 0;
  const tags = [...xml.matchAll(START_TAG_PATTERN)].map((tag) => tag[0]).join('\n');
  let match;
  while ((match = pattern.exec(tags)) !== null) {
    const value = (match[1] ?? match[2] ?? '').trim();
    if (value) values.push(value);
  }
  return values;
}

const OLE_COMPOUND_FILE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function isEncryptedDocx(buffer) {
  return (
    buffer.length >= OLE_COMPOUND_FILE_MAGIC.length &&
    buffer.subarray(0, OLE_COMPOUND_FILE_MAGIC.length).equals(OLE_COMPOUND_FILE_MAGIC)
  );
}

const XML_NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/**
 * XML text as the character data it denotes.
 *
 * A parser resolves entities before anything reads the value, so
 * `ACME&#45;FILE` *is* `ACME-FILE` on the page and `https&#58;//host` is a URL.
 * Matching the raw spelling made the encoding the gate, the same way an escaped
 * JS string literal once did in the export scanner.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeXmlEntities(text) {
  // CDATA sections are literal character data wherever they appear, and a text
  // node may mix them with ordinary content or place several side by side —
  // `ACME<![CDATA[ VERSION 1.0a]]>` renders as one string. Each section's
  // payload is taken as-is and the text around it is decoded normally;
  // unwrapping only a whole-node section left the delimiters in the middle of
  // the value and the stamp unmatched.
  // Only when a section is actually closed. An unmatched `<![CDATA[` — inside a
  // comment, say — made the outside branch re-enter this function on the same
  // tail forever, which threw RangeError and took the whole scan with it.
  if (/<!\[CDATA\[[\s\S]*?\]\]>/.test(text)) {
    return text.replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]+?)(?=<!\[CDATA\[[\s\S]*?\]\]>|$)/g,
      (whole, inside, outside) => (inside !== undefined ? inside : decodeEntitiesOnly(outside ?? '')),
    );
  }
  return decodeEntitiesOnly(text);
}

/**
 * Entity references only, with no CDATA handling. Split out so the CDATA branch
 * above cannot recurse into itself.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeEntitiesOnly(text) {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g, (whole, decimal, hex, named) => {
    if (decimal !== undefined || hex !== undefined) {
      const value = Number.parseInt(decimal ?? hex, decimal !== undefined ? 10 : 16);
      // Out of Unicode range is not a character; leave the source text alone
      // rather than decode it into something shorter than it really is.
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;
    }
    return XML_NAMED_ENTITIES.get(named.toLowerCase()) ?? whole;
  });
}

/**
 * An attribute's value, decoded.
 *
 * Delimiters are located in the raw text and only the value between them is
 * decoded, because an XML reader resolves character references inside a value
 * rather than around it. Decoding first lets an encoded quote act as a
 * delimiter and silently truncate the value.
 *
 * @param {string} element raw start tag
 * @param {string} name attribute local name
 * @returns {string}
 */
export function attributeValueOf(element, name) {
  const match = new RegExp(`(?:^|\\s)(?:[A-Za-z_][\\w.-]*:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(
    element,
  );
  return decodeXmlEntities(match?.[1] ?? match?.[2] ?? '');
}

/**
 * Character data as XML text.
 *
 * The inverse of `decodeXmlEntities`, for writing back text that was decoded
 * before it was matched. Only the characters that would otherwise change the
 * markup are escaped.
 *
 * @param {string} text
 * @returns {string}
 */
export function encodeXmlText(text) {
  return text.replace(/[&<>]/g, (character) => (character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;'));
}

export const TEXT_ELEMENTS = ['t', 'delText'];

export const VISIBLE_TEXT_PARTS =
  /^word\/(?:document\d*|header\d*|footer\d*|footnotes\d*|endnotes\d*|comments\d*|commentsExtended\d*|commentsIds\d*)\.xml$/i;

export function visibleTextReadings(xml) {
  const nodes = TEXT_ELEMENTS.flatMap((localName) => [...xml.matchAll(pairedElementPattern(localName))])
    .sort((left, right) => left.index - right.index)
    .map((match) => decodeXmlEntities(match[2]));
  return { joined: nodes.join(''), spaced: nodes.join(' ') };
}

export const SYNTHETIC_IDENTITIES = new Set([
  'SuperDoc',
  'SuperDoc Test User',
  'ST',
  'S::reviewer@example.com::00000000-0000-0000-0000-000000000000',
  'SuperDoc Legal Team',
  'Reviewer',
  'Author',
  'Editor',
  'Guide',
  'Alex Rivera',
  'Morgan Lee',
  'Default SuperDoc user',
  'python-docx',
  'docx',
  'Word',
  'Microsoft Word',
]);

const APPROVED_RELATIONSHIP_TARGETS = new Set([
  'https://superdoc.dev/',
  'https://docs.superdoc.dev/',
  'https://docs.superdoc.dev/solutions/esign/introduction',
  'https://www.harbourshare.com/',
  'http://www.betterbuildingspartnership.co.uk/working-groups/green-leases/green-lease-toolkit/',
]);

const ENCYCLOPEDIA_ARTICLE = /^https:\/\/en\.wikipedia\.org\/wiki\/[A-Za-z0-9_%(),.'-]+$/;

const APPROVED_RELATIONSHIP_PATTERNS = [ENCYCLOPEDIA_ARTICLE];

const RFC_2606_RESERVED_HOST_OR_SUBDOMAIN = /^(?:[^.]+\.)*example\.(?:com|org|net)$/i;

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  return (
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('169.254.') ||
    host === '0.0.0.0'
  );
}

function isReviewedTarget(target) {
  return APPROVED_RELATIONSHIP_TARGETS.has(target) || APPROVED_RELATIONSHIP_PATTERNS.some((pattern) => pattern.test(target));
}

export function relationshipTargetProblem(target) {
  const raw = String(target ?? '').trim();
  if (!raw) return null;
  if (isReviewedTarget(raw)) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'unparseable external target';
  }
  if (url.username || url.password) return 'credentials in an external target';
  const scheme = url.protocol.replace(':', '').toLowerCase();
  if (scheme === 'mailto') return 'email target';
  if (scheme === 'file') return 'file target';
  if (scheme !== 'http' && scheme !== 'https') return `${scheme} target`;
  if (isPrivateHost(url.hostname)) return 'private or local network target';
  if (url.search || url.hash) return 'external target carrying query or fragment';
  if (RFC_2606_RESERVED_HOST_OR_SUBDOMAIN.test(url.hostname)) return null;
  return 'unreviewed external target';
}

const CORE_PROPERTIES_PART = 'docProps/core.xml';
const APP_PROPERTIES_PART = 'docProps/app.xml';
const CUSTOM_PROPERTIES_PART = 'docProps/custom.xml';
const ANY_WORD_XML_PART = /^word\/.*\.xml$/i;
const CUSTOM_XML_STORE_PART = /^customXml\/item(?:Props)?\d*\.xml$/i;
export const RELATIONSHIPS_PART = /(?:^|\/)_rels\/[^/]*\.rels$/i;

const CORE_IDENTITY_TAGS = ['dc:creator', 'cp:lastModifiedBy', 'dc:title', 'dc:subject', 'cp:keywords', 'dc:description'];
const APP_IDENTITY_TAGS = ['Company', 'Manager'];

const REVIEWER_IDENTITY_ATTRIBUTES = [
  { kind: 'w:author', attribute: '[A-Za-z0-9_.-]+:author' },
  { kind: 'w:initials', attribute: '[A-Za-z0-9_.-]+:initials' },
  { kind: 'w15:userId', attribute: '[A-Za-z0-9_.-]+:userId' },
];

const HTTP_URL_ANY_SCHEME_CASE = /https?:\/\/[^\s"'<>]+/gi;
const EXTERNAL_TARGET_MODE = /^External$/i;

function addIdentity(identities, kind, value) {
  if (value && String(value).trim()) identities.push({ kind, value: String(value).trim() });
}

function addPropertyIdentities(identities, { core, app, custom }) {
  for (const tag of CORE_IDENTITY_TAGS) {
    for (const value of everyTextValueOf(core, tag)) addIdentity(identities, tag, value);
  }
  for (const tag of APP_IDENTITY_TAGS) {
    for (const value of everyTextValueOf(app, tag)) addIdentity(identities, tag, value);
  }
  for (const hyperlinkBase of everyTextValueOf(app, 'HyperlinkBase')) {
    const problem = relationshipTargetProblem(hyperlinkBase);
    if (problem) addIdentity(identities, 'HyperlinkBase', `${problem} ${hyperlinkBase}`);
  }
  for (const template of everyTextValueOf(app, 'Template')) {
    if (!WORD_DEFAULT_TEMPLATE_NAMES.has(template.trim())) addIdentity(identities, 'Template', template.trim());
  }
  if (!custom.trim()) return;
  for (const { name, value } of customProperties(custom)) {
    if (!isReportableCustomProperty(name)) continue;
    const kind = DOCUMENT_MANAGEMENT_PROPERTY_NAME.test(name) ? 'dms-property' : 'custom-property';
    addIdentity(identities, kind, value ? `${name}=${value}` : name);
  }
}

function addReviewerIdentities(identities, entries) {
  for (const [name, content] of entries) {
    if (!ANY_WORD_XML_PART.test(name)) continue;
    const xml = decodeXmlPart(content);
    for (const { kind, attribute } of REVIEWER_IDENTITY_ATTRIBUTES) {
      for (const value of startTagAttributeValues(xml, attribute)) addIdentity(identities, kind, value);
    }
  }
}

function customXmlTaxonomy(entries) {
  const taxonomy = [];
  for (const [name, content] of entries) {
    if (!CUSTOM_XML_STORE_PART.test(name)) continue;
    const xml = decodeXmlPart(content);
    for (const contentTypeValue of contentTypeNames(xml)) {
      if (!isGenericContentTypeName(contentTypeValue)) {
        taxonomy.push(`${name}: contentTypeName="${contentTypeValue}"`);
      }
    }
    for (const { tag, value } of organizationReceivers(xml)) {
      taxonomy.push(`${name}: <${tag}>${value.split(',')[0]}`);
    }
    for (const url of new Set(decodeXmlEntities(xml).match(HTTP_URL_ANY_SCHEME_CASE) ?? [])) {
      if (isStandardsNamespace(url)) continue;
      taxonomy.push(`${name}: external URL ${url}`);
    }
  }
  return taxonomy;
}

const isSanitizerStampOrItsPrefix = (stamp) => SANITIZER_SYNTHETIC_STAMP.startsWith(stamp);

function visibleDocumentStamps(entries) {
  const bodyStamps = [];
  for (const [name, content] of entries) {
    if (!VISIBLE_TEXT_PARTS.test(name)) continue;
    const { joined, spaced } = visibleTextReadings(decodeXmlPart(content));
    const seenStamps = new Set();
    for (const text of [spaced, joined]) {
      for (const match of text.matchAll(DOCUMENT_STAMP_PATTERN)) {
        const stamp = match[0].trim();
        if (seenStamps.has(stamp)) continue;
        if (isSanitizerStampOrItsPrefix(stamp)) continue;
        seenStamps.add(stamp);
        bodyStamps.push(`${name}: ${stamp}`);
      }
    }
  }
  return bodyStamps;
}

function unpublishableRelationships(entries) {
  const relationships = [];
  for (const [name, content] of entries) {
    if (!RELATIONSHIPS_PART.test(name)) continue;
    for (const element of decodeXmlPart(content).matchAll(emptyElementPattern('Relationship'))) {
      if (!EXTERNAL_TARGET_MODE.test(attributeValueOf(element[0], 'TargetMode'))) continue;
      const value = attributeValueOf(element[0], 'Target');
      const problem = relationshipTargetProblem(value);
      if (problem) relationships.push(`${name}: ${problem} ${value}`);
    }
  }
  return relationships;
}

export function inspectDocx(buffer) {
  if (isEncryptedDocx(buffer)) {
    return { identities: [], taxonomy: [], bodyStamps: [], relationships: [], encrypted: true };
  }
  const entries = readZipEntries(buffer);
  const read = (name) => (entries.has(name) ? decodeXmlPart(entries.get(name)) : '');

  const identities = [];
  addPropertyIdentities(identities, {
    core: read(CORE_PROPERTIES_PART),
    app: read(APP_PROPERTIES_PART),
    custom: read(CUSTOM_PROPERTIES_PART),
  });
  addReviewerIdentities(identities, entries);

  return {
    identities,
    taxonomy: customXmlTaxonomy(entries),
    bodyStamps: visibleDocumentStamps(entries),
    relationships: unpublishableRelationships(entries),
    encrypted: false,
  };
}
