import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import * as xmljs from 'xml-js';
import { isMigrationNeeded, migrateMetaDocxToParts } from './migration-from-meta-docx.js';
import { decodeYjsToEnvelope } from './json-crdt.js';
import { parseXmlToJson } from '../../../core/super-converter/v2/docxHelper.js';
import {
  PARTS_MAP_KEY,
  META_MAP_KEY,
  META_PARTS_MIGRATION_KEY,
  META_PARTS_CAPABILITY_KEY,
  META_PARTS_SCHEMA_VERSION_KEY,
} from './constants.js';

describe('migration-from-meta-docx', () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
  });

  afterEach(() => {
    ydoc.destroy();
  });

  function seedMetaDocx(entries: Array<{ name: string; content: unknown }>) {
    const metaMap = ydoc.getMap(META_MAP_KEY);
    metaMap.set('docx', entries);
  }

  describe('isMigrationNeeded', () => {
    it('returns true when meta.docx exists and parts is empty', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: { elements: [] } }]);

      expect(isMigrationNeeded(ydoc)).toBe(true);
    });

    it('returns false when no meta.docx exists', () => {
      expect(isMigrationNeeded(ydoc)).toBe(false);
    });

    it('returns true when migration status is not success', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: { elements: [] } }]);
      const metaMap = ydoc.getMap(META_MAP_KEY);
      metaMap.set(META_PARTS_MIGRATION_KEY, { status: 'failed' });

      expect(isMigrationNeeded(ydoc)).toBe(true);
    });

    it('returns true for partial migration (missing keys)', () => {
      seedMetaDocx([
        { name: 'word/styles.xml', content: { elements: [] } },
        { name: 'word/numbering.xml', content: { elements: [] } },
      ]);

      // Only styles migrated
      const partsMap = ydoc.getMap(PARTS_MAP_KEY);
      partsMap.set('word/styles.xml', new Y.Map());

      const metaMap = ydoc.getMap(META_MAP_KEY);
      metaMap.set(META_PARTS_MIGRATION_KEY, { status: 'success' });

      expect(isMigrationNeeded(ydoc)).toBe(true);
    });
  });

  describe('migrateMetaDocxToParts', () => {
    it('migrates all non-document parts', () => {
      seedMetaDocx([
        { name: 'word/document.xml', content: { doc: true } },
        { name: 'word/styles.xml', content: { type: 'element', name: 'doc', elements: [] } },
        { name: 'word/numbering.xml', content: { type: 'element', name: 'doc', elements: [] } },
        { name: 'word/settings.xml', content: { type: 'element', name: 'doc', elements: [] } },
      ]);

      const result = migrateMetaDocxToParts(ydoc);

      expect(result.migrated).toBe(true);
      expect(result.partsMigrated).toBe(3); // Excludes word/document.xml
      expect(result.error).toBeNull();

      const partsMap = ydoc.getMap(PARTS_MAP_KEY);
      expect(partsMap.has('word/styles.xml')).toBe(true);
      expect(partsMap.has('word/numbering.xml')).toBe(true);
      expect(partsMap.has('word/settings.xml')).toBe(true);
      expect(partsMap.has('word/document.xml')).toBe(false);
    });

    it('sets version to 1 on migrated entries', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: { type: 'element' } }]);

      migrateMetaDocxToParts(ydoc);

      const partsMap = ydoc.getMap(PARTS_MAP_KEY);
      const entry = partsMap.get('word/styles.xml') as Y.Map<unknown>;
      const envelope = decodeYjsToEnvelope(entry);
      expect(envelope?.v).toBe(1);
    });

    it('sets partsCapability atomically', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: { type: 'element' } }]);

      migrateMetaDocxToParts(ydoc);

      const metaMap = ydoc.getMap(META_MAP_KEY);
      const capability = metaMap.get(META_PARTS_CAPABILITY_KEY) as Record<string, unknown>;
      expect(capability.version).toBe(1);
      expect(capability.clientId).toBe(ydoc.clientID);
    });

    it('sets partsSchemaVersion', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: { type: 'element' } }]);

      migrateMetaDocxToParts(ydoc);

      const metaMap = ydoc.getMap(META_MAP_KEY);
      expect(metaMap.get(META_PARTS_SCHEMA_VERSION_KEY)).toBe(1);
    });

    it('does not delete meta.docx', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: { type: 'element' } }]);

      migrateMetaDocxToParts(ydoc);

      const metaMap = ydoc.getMap(META_MAP_KEY);
      expect(metaMap.get('docx')).toBeDefined();
    });

    it('records success in migration metadata', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: { type: 'element' } }]);

      migrateMetaDocxToParts(ydoc);

      const metaMap = ydoc.getMap(META_MAP_KEY);
      const migration = metaMap.get(META_PARTS_MIGRATION_KEY) as Record<string, unknown>;
      expect(migration.status).toBe('success');
    });

    it('fails gracefully on null content', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: null }]);

      const result = migrateMetaDocxToParts(ydoc);

      expect(result.migrated).toBe(false);
      expect(result.error).toContain('no content');

      const partsMap = ydoc.getMap(PARTS_MAP_KEY);
      expect(partsMap.size).toBe(0);
    });

    it('parses string content (XML) from meta.docx', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: '<w:styles></w:styles>' }]);

      const result = migrateMetaDocxToParts(ydoc);

      expect(result.migrated).toBe(true);
      expect(result.error).toBeNull();
    });

    it('is idempotent — skips already-migrated keys', () => {
      seedMetaDocx([
        { name: 'word/styles.xml', content: { type: 'element' } },
        { name: 'word/numbering.xml', content: { type: 'element' } },
      ]);

      // First migration
      migrateMetaDocxToParts(ydoc);

      // Second migration — should be a no-op
      const result = migrateMetaDocxToParts(ydoc);
      expect(result.migrated).toBe(false);
      expect(result.partsMigrated).toBe(0);
    });

    it('fills missing keys on partial migration retry', () => {
      seedMetaDocx([
        { name: 'word/styles.xml', content: { type: 'element' } },
        { name: 'word/numbering.xml', content: { type: 'element' } },
      ]);

      // Simulate partial migration: only styles written
      const partsMap = ydoc.getMap(PARTS_MAP_KEY);
      const fakeEnvelope = new Y.Map<unknown>();
      fakeEnvelope.set('v', 1);
      fakeEnvelope.set('clientId', 0);
      fakeEnvelope.set('data', new Y.Map());
      partsMap.set('word/styles.xml', fakeEnvelope);

      const result = migrateMetaDocxToParts(ydoc);

      expect(result.migrated).toBe(true);
      expect(result.partsMigrated).toBe(1); // Only numbering
      expect(partsMap.has('word/numbering.xml')).toBe(true);
    });

    it('returns no-op when meta.docx is empty', () => {
      seedMetaDocx([]);

      const result = migrateMetaDocxToParts(ydoc);
      expect(result.migrated).toBe(false);
      expect(result.error).toContain('No meta.docx entries');
    });

    it('parses multiple XML string entries from meta.docx', () => {
      seedMetaDocx([
        { name: 'word/styles.xml', content: '<w:styles></w:styles>' },
        { name: 'word/numbering.xml', content: '<w:numbering></w:numbering>' },
      ]);

      const result = migrateMetaDocxToParts(ydoc);

      expect(result.migrated).toBe(true);
      expect(result.partsMigrated).toBe(2);
      expect(result.error).toBeNull();

      const partsMap = ydoc.getMap(PARTS_MAP_KEY);
      expect(partsMap.has('word/styles.xml')).toBe(true);
      expect(partsMap.has('word/numbering.xml')).toBe(true);
    });

    it('parses XML string content into a JSON tree', () => {
      seedMetaDocx([{ name: 'word/styles.xml', content: '<w:styles></w:styles>' }]);

      const result = migrateMetaDocxToParts(ydoc);

      expect(result.migrated).toBe(true);
      expect(result.partsMigrated).toBe(1);
      expect(result.error).toBeNull();

      const partsMap = ydoc.getMap(PARTS_MAP_KEY);
      const entry = partsMap.get('word/styles.xml') as Y.Map<unknown>;
      const envelope = decodeYjsToEnvelope(entry);
      expect(envelope?.data).toBeDefined();
      // Verify it's a parsed JSON tree, not a string
      expect(typeof envelope?.data).toBe('object');
    });

    it('XML string parsing produces same shape as parseXmlToJson', () => {
      const xml =
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph"><w:name w:val="Normal"/></w:style></w:styles>';
      seedMetaDocx([{ name: 'word/styles.xml', content: xml }]);

      const result = migrateMetaDocxToParts(ydoc);
      expect(result.migrated).toBe(true);

      const partsMap = ydoc.getMap(PARTS_MAP_KEY);
      const entry = partsMap.get('word/styles.xml') as Y.Map<unknown>;
      const envelope = decodeYjsToEnvelope(entry);

      // Compare against direct parseXmlToJson — shapes must be identical
      const expected = parseXmlToJson(xml);
      expect(envelope?.data).toEqual(expected);
    });

    it.each(['p:', ''])('retains legacy raw people whitespace on dynamic paths (prefix %s)', (prefix) => {
      const namespace = 'http://schemas.microsoft.com/office/word/2012/wordml';
      const raw = `<${prefix}people xmlns${prefix ? ':p' : ''}="${namespace}" xmlns:v="urn:vendor">\n <${prefix}person xmlns:p="${namespace}" p:author="Old"><${prefix}presenceInfo p:providerId="vendor" p:userId="old&#9;account"/><v:extra xml:space="preserve">  <v:child/> \t <v:child/>  </v:extra></${prefix}person>\n <![CDATA[root &amp; <tag>]]><v:mixed>before&#13;<v:child/>after &amp;amp;</v:mixed>\n</${prefix}people>`;
      const entries = [{ name: 'word/metadata/people-custom.xml', content: raw }];
      seedMetaDocx(entries);
      expect(migrateMetaDocxToParts(ydoc).error).toBeNull();
      const data = decodeYjsToEnvelope(ydoc.getMap(PARTS_MAP_KEY).get(entries[0].name))?.data;
      expect(data).toEqual(xmljs.xml2js(raw, { captureSpacesBetweenElements: true }));
      expect(ydoc.getMap(META_MAP_KEY).get('docx')).toEqual(entries);
    });

    it('retains an authoritative people object and skips an already-current room part', () => {
      const path = 'word/current-people.xml';
      const raw = '<p:people xmlns:p="http://schemas.microsoft.com/office/word/2012/wordml"> <p:person/> </p:people>';
      const tree = xmljs.xml2js(raw, { captureSpacesBetweenElements: true });
      const entries = [{ name: path, content: tree }];
      seedMetaDocx(entries);
      expect(migrateMetaDocxToParts(ydoc).error).toBeNull();
      expect(decodeYjsToEnvelope(ydoc.getMap(PARTS_MAP_KEY).get(path))?.data).toEqual(tree);
      seedMetaDocx([{ name: path, content: raw.replace('> <', '>    <') }]);
      expect(migrateMetaDocxToParts(ydoc).partsMigrated).toBe(0);
      expect(decodeYjsToEnvelope(ydoc.getMap(PARTS_MAP_KEY).get(path))?.data).toEqual(tree);
      expect(entries[0].content).toBe(tree);
    });
  });
});
