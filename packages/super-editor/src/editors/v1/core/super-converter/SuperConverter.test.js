import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuperConverter } from './SuperConverter.js';
import { v4 as uuidv4 } from 'uuid';
import * as xmljs from 'xml-js';

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

describe('SuperConverter people whitespace import boundary', () => {
  it('retains people text on any part path without changing generic XML parsing', () => {
    const raw =
      '<x:people xmlns:x="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:v="urn:vendor">\n <x:person><v:extra xml:space="preserve"> <v:child/> </v:extra></x:person>\n</x:people>';
    const other = '<x:people xmlns:x="urn:vendor"> <x:child/> </x:people>';
    const docx = [
      { name: 'word/metadata/people-custom.xml', content: raw },
      { name: 'word/unrelated.xml', content: other },
      {
        name: 'word/document.xml',
        content:
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
      },
    ];
    const snapshot = JSON.stringify(docx);
    const converter = new SuperConverter({ docx });
    expect(converter.convertedXml['word/metadata/people-custom.xml']).toEqual(
      xmljs.xml2js(raw, { captureSpacesBetweenElements: true }),
    );
    expect(converter.convertedXml['word/unrelated.xml']).toEqual(converter.parseXmlToJson(other));
    expect(JSON.stringify(docx)).toBe(snapshot);
  });
});

describe('SuperConverter Document GUID', () => {
  let mockDocx;
  let mockCustomXml;
  let mockSettingsXml;

  beforeEach(() => {
    vi.clearAllMocks();

    // These need to match the actual file structure expected by SuperConverter
    mockCustomXml = {
      name: 'docProps/custom.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
        </Properties>`,
    };

    mockSettingsXml = {
      name: 'word/settings.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        </w:settings>`,
    };

    // Add a minimal document.xml to prevent parsing errors
    const mockDocumentXml = {
      name: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body><w:p><w:r><w:t>Test</w:t></w:r></w:p></w:body>
        </w:document>`,
    };

    mockDocx = [mockCustomXml, mockSettingsXml, mockDocumentXml];
  });

  describe('Document Identifier Resolution', () => {
    it('prioritizes Microsoft docId from settings.xml', () => {
      mockSettingsXml.content = `<?xml version="1.0" encoding="UTF-8"?>
        <w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                    xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
          <w15:docId w15:val="{MICROSOFT-GUID-123}"/>
        </w:settings>`;

      const converter = new SuperConverter({ docx: mockDocx });
      expect(converter.getDocumentGuid()).toBe('MICROSOFT-GUID-123');
    });

    it('uses custom DocumentGuid when no Microsoft GUID exists', () => {
      // Override just the custom.xml with the GUID
      const customDocx = [...mockDocx];
      customDocx[0] = {
        name: 'docProps/custom.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <property name="DocumentGuid" fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2">
              <vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">CUSTOM-GUID-456</vt:lpwstr>
            </property>
          </Properties>`,
      };

      const converter = new SuperConverter({ docx: customDocx });
      expect(converter.getDocumentGuid()).toBe('CUSTOM-GUID-456');
    });

    it('generates content hash and assigns GUID for document without GUID/timestamp', async () => {
      const fileSource = Buffer.from('test file content');
      const converter = new SuperConverter({
        docx: mockDocx,
        fileSource,
      });

      // Before calling getDocumentIdentifier, no GUID is assigned
      expect(converter.getDocumentGuid()).toBeNull();

      // getDocumentIdentifier assigns GUID and returns content hash (since no timestamp)
      const identifier = await converter.getDocumentIdentifier();
      expect(identifier).toBe('HASH-61D1432F');

      // GUID is now assigned (for persistence on export)
      expect(converter.getDocumentGuid()).toBe('test-uuid-1234');
      expect(converter.documentModified).toBe(true);
    });

    it('new file: sets fresh timestamp on init', () => {
      const mockCoreXml = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          </cp:coreProperties>`,
      };

      const converter = new SuperConverter({
        docx: [...mockDocx, mockCoreXml],
        isNewFile: true,
      });

      // New file should have timestamp set immediately
      const timestamp = converter.getDocumentCreatedTimestamp();
      expect(timestamp).not.toBeNull();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it('new file: uses identifier hash (GUID + timestamp)', async () => {
      const mockCoreXml = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          </cp:coreProperties>`,
      };
      const mockSettingsWithGuid = {
        name: 'word/settings.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                      xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
            <w15:docId w15:val="{NEW-FILE-GUID}"/>
          </w:settings>`,
      };

      const converter = new SuperConverter({
        docx: [mockCustomXml, mockSettingsWithGuid, mockDocx[2], mockCoreXml],
        isNewFile: true,
      });

      // Has both GUID and timestamp, so should use identifier hash
      const identifier = await converter.getDocumentIdentifier();
      expect(identifier).toMatch(/^HASH-[A-F0-9]+$/);
      expect(converter.documentModified).toBeFalsy();
    });

    it('imported file with GUID and timestamp: uses identifier hash', async () => {
      const mockCoreXmlWithTimestamp = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <dcterms:created xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:created>
          </cp:coreProperties>`,
      };
      const mockSettingsWithGuid = {
        name: 'word/settings.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                      xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
            <w15:docId w15:val="{EXISTING-GUID-123}"/>
          </w:settings>`,
      };

      const converter = new SuperConverter({
        docx: [mockCustomXml, mockSettingsWithGuid, mockDocx[2], mockCoreXmlWithTimestamp],
        isNewFile: false,
      });

      const identifier = await converter.getDocumentIdentifier();
      expect(identifier).toBe('HASH-A5FD6589');
      expect(converter.getDocumentGuid()).toBe('EXISTING-GUID-123');
      expect(converter.getDocumentCreatedTimestamp()).toBe('2024-01-15T10:30:00Z');
      expect(converter.documentModified).toBeFalsy();
    });

    it('imported file with GUID but no timestamp: uses content hash and generates timestamp', async () => {
      const mockCoreXmlEmpty = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          </cp:coreProperties>`,
      };
      const mockSettingsWithGuid = {
        name: 'word/settings.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                      xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
            <w15:docId w15:val="{EXISTING-GUID-456}"/>
          </w:settings>`,
      };
      const fileSource = Buffer.from('test file content for guid no timestamp');

      const converter = new SuperConverter({
        docx: [mockCustomXml, mockSettingsWithGuid, mockDocx[2], mockCoreXmlEmpty],
        fileSource,
        isNewFile: false,
      });

      // Has GUID but no timestamp
      expect(converter.getDocumentGuid()).toBe('EXISTING-GUID-456');
      expect(converter.getDocumentCreatedTimestamp()).toBeNull();

      const identifier = await converter.getDocumentIdentifier();
      expect(identifier).toMatch(/^HASH-[A-F0-9]+$/);

      // Timestamp should now be generated
      expect(converter.getDocumentCreatedTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(converter.documentModified).toBe(true);
    });

    it('imported file with timestamp but no GUID: uses content hash and generates GUID', async () => {
      const mockCoreXmlWithTimestamp = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <dcterms:created xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:created>
          </cp:coreProperties>`,
      };
      const fileSource = Buffer.from('test file content for timestamp no guid');

      const converter = new SuperConverter({
        docx: [mockCustomXml, mockSettingsXml, mockDocx[2], mockCoreXmlWithTimestamp],
        fileSource,
        isNewFile: false,
      });

      // Has timestamp but no GUID
      expect(converter.getDocumentGuid()).toBeNull();
      expect(converter.getDocumentCreatedTimestamp()).toBe('2024-01-15T10:30:00Z');

      const identifier = await converter.getDocumentIdentifier();
      expect(identifier).toMatch(/^HASH-[A-F0-9]+$/);

      // GUID should now be generated
      expect(converter.getDocumentGuid()).toBe('test-uuid-1234');
      expect(converter.documentModified).toBe(true);
    });

    it('imported file with neither GUID nor timestamp: uses content hash and generates both', async () => {
      const mockCoreXmlEmpty = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          </cp:coreProperties>`,
      };
      const fileSource = Buffer.from('test file content for neither');

      const converter = new SuperConverter({
        docx: [mockCustomXml, mockSettingsXml, mockDocx[2], mockCoreXmlEmpty],
        fileSource,
        isNewFile: false,
      });

      // Has neither
      expect(converter.getDocumentGuid()).toBeNull();
      expect(converter.getDocumentCreatedTimestamp()).toBeNull();

      const identifier = await converter.getDocumentIdentifier();
      expect(identifier).toMatch(/^HASH-[A-F0-9]+$/);

      // Both should now be generated
      expect(converter.getDocumentGuid()).toBe('test-uuid-1234');
      expect(converter.getDocumentCreatedTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(converter.documentModified).toBe(true);
    });

    it('content hash is stable for same file content', async () => {
      const fileSource = Buffer.from('identical file content');
      const mockCoreXmlEmpty = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">
          </cp:coreProperties>`,
      };

      const converter1 = new SuperConverter({
        docx: [mockCustomXml, mockSettingsXml, mockDocx[2], mockCoreXmlEmpty],
        fileSource,
        isNewFile: false,
      });

      const converter2 = new SuperConverter({
        docx: [mockCustomXml, mockSettingsXml, mockDocx[2], mockCoreXmlEmpty],
        fileSource,
        isNewFile: false,
      });

      const identifier1 = await converter1.getDocumentIdentifier();
      const identifier2 = await converter2.getDocumentIdentifier();

      expect(identifier1).toBe(identifier2);
    });

    it('identifier hash is stable for same GUID and timestamp', async () => {
      const mockCoreXmlWithTimestamp = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <dcterms:created xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:created>
          </cp:coreProperties>`,
      };
      const mockSettingsWithGuid = {
        name: 'word/settings.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                      xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
            <w15:docId w15:val="{STABLE-GUID}"/>
          </w:settings>`,
      };

      const converter1 = new SuperConverter({
        docx: [mockCustomXml, mockSettingsWithGuid, mockDocx[2], mockCoreXmlWithTimestamp],
      });

      const converter2 = new SuperConverter({
        docx: [mockCustomXml, mockSettingsWithGuid, mockDocx[2], mockCoreXmlWithTimestamp],
      });

      const identifier1 = await converter1.getDocumentIdentifier();
      const identifier2 = await converter2.getDocumentIdentifier();

      expect(identifier1).toBe(identifier2);
    });
  });

  describe('Document Timestamp Methods', () => {
    it('getDocumentCreatedTimestamp returns timestamp when present', () => {
      const mockCoreXmlWithTimestamp = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <dcterms:created xsi:type="dcterms:W3CDTF">2024-06-15T14:30:00Z</dcterms:created>
          </cp:coreProperties>`,
      };

      const converter = new SuperConverter({
        docx: [...mockDocx, mockCoreXmlWithTimestamp],
      });

      expect(converter.getDocumentCreatedTimestamp()).toBe('2024-06-15T14:30:00Z');
    });

    it('getDocumentCreatedTimestamp returns null when not present', () => {
      const mockCoreXmlEmpty = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">
          </cp:coreProperties>`,
      };

      const converter = new SuperConverter({
        docx: [...mockDocx, mockCoreXmlEmpty],
      });

      expect(converter.getDocumentCreatedTimestamp()).toBeNull();
    });

    it('getDocumentCreatedTimestamp returns null when core.xml is missing', () => {
      const converter = new SuperConverter({
        docx: mockDocx,
      });

      expect(converter.getDocumentCreatedTimestamp()).toBeNull();
    });

    it('setDocumentCreatedTimestamp updates existing timestamp', () => {
      const mockCoreXmlWithTimestamp = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <dcterms:created xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:created>
          </cp:coreProperties>`,
      };

      const converter = new SuperConverter({
        docx: [...mockDocx, mockCoreXmlWithTimestamp],
      });

      expect(converter.getDocumentCreatedTimestamp()).toBe('2024-01-01T00:00:00Z');

      converter.setDocumentCreatedTimestamp('2024-12-25T12:00:00Z');

      expect(converter.getDocumentCreatedTimestamp()).toBe('2024-12-25T12:00:00Z');
    });

    it('setDocumentCreatedTimestamp creates element when dcterms:created is missing', () => {
      const mockCoreXmlEmpty = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                            xmlns:dcterms="http://purl.org/dc/terms/"
                            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          </cp:coreProperties>`,
      };

      const converter = new SuperConverter({
        docx: [...mockDocx, mockCoreXmlEmpty],
      });

      expect(converter.getDocumentCreatedTimestamp()).toBeNull();

      converter.setDocumentCreatedTimestamp('2024-07-04T09:00:00Z');

      expect(converter.getDocumentCreatedTimestamp()).toBe('2024-07-04T09:00:00Z');
    });

    it('setDocumentCreatedTimestamp creates elements array when missing', () => {
      const mockCoreXmlNoElements = {
        name: 'docProps/core.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>`,
      };

      const converter = new SuperConverter({
        docx: [...mockDocx, mockCoreXmlNoElements],
      });

      expect(converter.getDocumentCreatedTimestamp()).toBeNull();

      converter.setDocumentCreatedTimestamp('2024-08-15T16:30:00Z');

      expect(converter.getDocumentCreatedTimestamp()).toBe('2024-08-15T16:30:00Z');
    });

    it('generateWordTimestamp returns correct format without milliseconds', () => {
      const timestamp = SuperConverter.generateWordTimestamp();

      // Should match YYYY-MM-DDTHH:MM:SSZ format (no milliseconds)
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

      // Seconds should be 00 (truncated to minute precision)
      expect(timestamp).toMatch(/:00Z$/);
    });
  });

  describe('GUID Promotion', () => {
    it('promoteToGuid returns existing GUID if already set', async () => {
      const fileSource = Buffer.from('test file content');
      const converter = new SuperConverter({
        docx: mockDocx,
        fileSource,
      });

      // getDocumentIdentifier assigns a GUID
      await converter.getDocumentIdentifier();
      expect(converter.getDocumentGuid()).toBe('test-uuid-1234');

      // Clear the mock to verify promoteToGuid doesn't generate a new one
      vi.clearAllMocks();

      // promoteToGuid should return the existing GUID
      const guid = converter.promoteToGuid();
      expect(guid).toBe('test-uuid-1234');
      expect(uuidv4).not.toHaveBeenCalled();
    });

    it('does not re-promote if already has GUID', () => {
      // Override just the custom.xml with the GUID
      const customDocx = [...mockDocx];
      customDocx[0] = {
        name: 'docProps/custom.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
          <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <property name="DocumentGuid" fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2">
              <vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">EXISTING-GUID</vt:lpwstr>
            </property>
          </Properties>`,
      };

      const converter = new SuperConverter({ docx: customDocx });
      const guid = converter.promoteToGuid();
      expect(guid).toBe('EXISTING-GUID');
      expect(uuidv4).not.toHaveBeenCalled();
    });
  });

  describe('Static Methods', () => {
    it('getDocumentGuid checks both sources', () => {
      // Test Microsoft GUID
      const docxWithMsGuid = [
        {
          name: 'word/settings.xml',
          content:
            '<w:settings xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:docId w15:val="{MS-GUID}"/></w:settings>',
        },
      ];
      expect(SuperConverter.extractDocumentGuid(docxWithMsGuid)).toBe('MS-GUID');

      // Test when no GUID exists
      const guid = SuperConverter.extractDocumentGuid(mockDocx);
      expect(guid).toBeNull();
    });
  });

  describe('Version Methods', () => {
    it('stores and retrieves version', () => {
      const docx = {
        'docProps/custom.xml': {
          elements: [
            {
              name: 'Properties',
              elements: [],
            },
          ],
        },
      };

      // Set version
      SuperConverter.setStoredSuperdocVersion(docx, '1.2.3');
      const prop = docx['docProps/custom.xml'].elements[0].elements[0];
      expect(prop.elements[0].elements[0].text).toBe('1.2.3');

      // Get version
      const version = SuperConverter.getStoredSuperdocVersion([
        {
          name: 'docProps/custom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
          <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <property name="SuperdocVersion" pid="2">
              <vt:lpwstr>1.2.3</vt:lpwstr>
            </property>
          </Properties>`,
        },
      ]);
      expect(version).toBe('1.2.3');
    });
  });

  describe('Custom Properties', () => {
    it('stores a custom property', () => {
      const docx = {
        'docProps/custom.xml': {
          elements: [
            {
              name: 'Properties',
              elements: [],
            },
          ],
        },
      };

      SuperConverter.setStoredCustomProperty(docx, 'MyCustomProp', 'MyValue');
      const prop = docx['docProps/custom.xml'].elements[0].elements[0];
      expect(prop.attributes.name).toBe('MyCustomProp');
      expect(prop.elements[0].elements[0].text).toBe('MyValue');
    });

    it('retrieves a custom property', () => {
      const docx = {
        name: 'docProps/custom.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
        <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
          <property name="MyCustomProp" pid="2">
            <vt:lpwstr>MyValue</vt:lpwstr>
          </property>
        </Properties>`,
      };
      const value = SuperConverter.getStoredCustomProperty([docx], 'MyCustomProp');
      expect(value).toBe('MyValue');
    });

    it('returns null if custom property does not exist', () => {
      const value = SuperConverter.getStoredCustomProperty(
        [
          {
            name: 'docProps/custom.xml',
            content: `<?xml version="1.0" encoding="UTF-8"?>
            <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            </Properties>`,
          },
        ],
        'NonExistentProp',
      );
      expect(value).toBeNull();
    });

    it('returns null when custom.xml is malformed or missing Properties root', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const value = SuperConverter.getStoredCustomProperty(
        [
          {
            name: 'docProps/custom.xml',
            // Simulate a bad payload coming from collaboration sync
            content: `<?xml version="1.0" encoding="UTF-8"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            </Relationships>`,
          },
        ],
        'DocumentGuid',
      );
      expect(value).toBeNull();
      warnSpy.mockRestore();
    });

    describe('Namespace Prefix Support', () => {
      it('retrieves property when Properties element has namespace prefix', () => {
        const docx = {
          name: 'docProps/custom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
          <op:Properties xmlns:op="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <property name="MyCustomProp" pid="2">
              <vt:lpwstr>MyValue</vt:lpwstr>
            </property>
          </op:Properties>`,
        };
        const value = SuperConverter.getStoredCustomProperty([docx], 'MyCustomProp');
        expect(value).toBe('MyValue');
      });

      it('retrieves property when property element has namespace prefix', () => {
        const docx = {
          name: 'docProps/custom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
          <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <op:property name="MyCustomProp" pid="2">
              <vt:lpwstr>MyValue</vt:lpwstr>
            </op:property>
          </Properties>`,
        };
        const value = SuperConverter.getStoredCustomProperty([docx], 'MyCustomProp');
        expect(value).toBe('MyValue');
      });

      it('retrieves property when both elements have namespace prefixes', () => {
        const docx = {
          name: 'docProps/custom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
          <op:Properties xmlns:op="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <op:property name="MyCustomProp" pid="2">
              <vt:lpwstr>MyValue</vt:lpwstr>
            </op:property>
          </op:Properties>`,
        };
        const value = SuperConverter.getStoredCustomProperty([docx], 'MyCustomProp');
        expect(value).toBe('MyValue');
      });

      it('retrieves property with different namespace prefixes', () => {
        const docx = {
          name: 'docProps/custom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
          <custom:Properties xmlns:custom="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <custom:property name="TestProp" pid="2">
              <vt:lpwstr>TestValue</vt:lpwstr>
            </custom:property>
          </custom:Properties>`,
        };
        const value = SuperConverter.getStoredCustomProperty([docx], 'TestProp');
        expect(value).toBe('TestValue');
      });

      it('handles mixed prefixed and non-prefixed properties', () => {
        const docx = {
          name: 'docProps/custom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
          <op:Properties xmlns:op="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <property name="NormalProp" pid="2">
              <vt:lpwstr>NormalValue</vt:lpwstr>
            </property>
            <op:property name="PrefixedProp" pid="3">
              <vt:lpwstr>PrefixedValue</vt:lpwstr>
            </op:property>
          </op:Properties>`,
        };
        expect(SuperConverter.getStoredCustomProperty([docx], 'NormalProp')).toBe('NormalValue');
        expect(SuperConverter.getStoredCustomProperty([docx], 'PrefixedProp')).toBe('PrefixedValue');
      });

      it('sets property when Properties element has namespace prefix', () => {
        const docx = {
          'docProps/custom.xml': {
            elements: [
              {
                name: 'op:Properties',
                elements: [],
              },
            ],
          },
        };

        SuperConverter.setStoredCustomProperty(docx, 'MyCustomProp', 'MyValue');
        const prop = docx['docProps/custom.xml'].elements[0].elements[0];
        expect(prop.name).toBe('op:property'); // Verify namespace prefix is preserved
        expect(prop.attributes.name).toBe('MyCustomProp');
        expect(prop.elements[0].elements[0].text).toBe('MyValue');
      });

      it('updates existing property with namespace prefix', () => {
        const docx = {
          'docProps/custom.xml': {
            elements: [
              {
                name: 'op:Properties',
                elements: [
                  {
                    name: 'op:property',
                    attributes: {
                      name: 'ExistingProp',
                      pid: 2,
                    },
                    elements: [
                      {
                        type: 'element',
                        name: 'vt:lpwstr',
                        elements: [
                          {
                            type: 'text',
                            text: 'OldValue',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };

        SuperConverter.setStoredCustomProperty(docx, 'ExistingProp', 'NewValue');
        const prop = docx['docProps/custom.xml'].elements[0].elements[0];
        expect(prop.name).toBe('op:property'); // Verify namespace prefix is preserved
        expect(prop.elements[0].elements[0].text).toBe('NewValue');
      });

      it('normalizes existing property namespace prefix to match parent', () => {
        const docx = {
          'docProps/custom.xml': {
            elements: [
              {
                name: 'op:Properties',
                elements: [
                  {
                    // Existing property without prefix, but parent has prefix
                    name: 'property',
                    attributes: {
                      name: 'MismatchedProp',
                      pid: 2,
                    },
                    elements: [
                      {
                        type: 'element',
                        name: 'vt:lpwstr',
                        elements: [
                          {
                            type: 'text',
                            text: 'OldValue',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };

        SuperConverter.setStoredCustomProperty(docx, 'MismatchedProp', 'NewValue');
        const prop = docx['docProps/custom.xml'].elements[0].elements[0];
        expect(prop.name).toBe('op:property'); // Verify namespace prefix is normalized to match parent
        expect(prop.elements[0].elements[0].text).toBe('NewValue');
      });

      it('normalizes existing property when parent has no prefix', () => {
        const docx = {
          'docProps/custom.xml': {
            elements: [
              {
                name: 'Properties',
                elements: [
                  {
                    // Existing property with prefix, but parent has no prefix
                    name: 'op:property',
                    attributes: {
                      name: 'MismatchedProp',
                      pid: 2,
                    },
                    elements: [
                      {
                        type: 'element',
                        name: 'vt:lpwstr',
                        elements: [
                          {
                            type: 'text',
                            text: 'OldValue',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };

        SuperConverter.setStoredCustomProperty(docx, 'MismatchedProp', 'NewValue');
        const prop = docx['docProps/custom.xml'].elements[0].elements[0];
        expect(prop.name).toBe('property'); // Verify namespace prefix is normalized to match parent (no prefix)
        expect(prop.elements[0].elements[0].text).toBe('NewValue');
      });
    });

    describe('Edge Cases and Error Handling', () => {
      it('returns null for malformed property structure (missing nested elements)', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const docx = {
          name: 'docProps/custom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
          <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <property name="MalformedProp" pid="2">
            </property>
          </Properties>`,
        };
        const value = SuperConverter.getStoredCustomProperty([docx], 'MalformedProp');
        expect(value).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Malformed property structure for "MalformedProp"');

        consoleWarnSpy.mockRestore();
      });

      it('returns null for property with empty text', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const docx = {
          name: 'docProps/custom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
          <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <property name="EmptyProp" pid="2">
              <vt:lpwstr></vt:lpwstr>
            </property>
          </Properties>`,
        };
        const value = SuperConverter.getStoredCustomProperty([docx], 'EmptyProp');
        expect(value).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Malformed property structure for "EmptyProp"');

        consoleWarnSpy.mockRestore();
      });

      it('handles malformed property structure in setStoredCustomProperty with preserveExisting', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const docx = {
          'docProps/custom.xml': {
            elements: [
              {
                name: 'Properties',
                elements: [
                  {
                    name: 'property',
                    attributes: {
                      name: 'MalformedProp',
                      pid: 2,
                    },
                    elements: [], // Malformed: missing nested elements
                  },
                ],
              },
            ],
          },
        };

        const value = SuperConverter.setStoredCustomProperty(docx, 'MalformedProp', 'NewValue', true);
        expect(value).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Malformed existing property structure for "MalformedProp"');

        consoleWarnSpy.mockRestore();
      });

      it('recreates property structure when updating malformed property', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const docx = {
          'docProps/custom.xml': {
            elements: [
              {
                name: 'Properties',
                elements: [
                  {
                    name: 'property',
                    attributes: {
                      name: 'MalformedProp',
                      pid: 2,
                    },
                    elements: [], // Malformed: missing nested elements
                  },
                ],
              },
            ],
          },
        };

        const value = SuperConverter.setStoredCustomProperty(docx, 'MalformedProp', 'NewValue');
        expect(value).toBe('NewValue');
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Malformed property structure for "MalformedProp", recreating structure',
        );

        const prop = docx['docProps/custom.xml'].elements[0].elements[0];
        expect(prop.elements[0].elements[0].text).toBe('NewValue');

        consoleWarnSpy.mockRestore();
      });

      it('returns null when Properties element is not found in setStoredCustomProperty', () => {
        const docx = {
          'docProps/custom.xml': {
            elements: [
              {
                name: 'SomeOtherElement',
                elements: [],
              },
            ],
          },
        };

        const value = SuperConverter.setStoredCustomProperty(docx, 'MyProp', 'MyValue');
        expect(value).toBeNull();
      });

      it('handles empty element name gracefully', () => {
        const docx = {
          name: 'docProps/custom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
          <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
            <property name="ValidProp" pid="2">
              <vt:lpwstr>ValidValue</vt:lpwstr>
            </property>
          </Properties>`,
        };
        // Should still work for valid property
        const value = SuperConverter.getStoredCustomProperty([docx], 'ValidProp');
        expect(value).toBe('ValidValue');
      });

      it('does not match element with empty prefix', () => {
        // Test the _matchesElementName helper directly
        expect(SuperConverter._matchesElementName(':Properties', 'Properties')).toBe(false);
        expect(SuperConverter._matchesElementName(':property', 'property')).toBe(false);
      });
    });

    describe('_matchesElementName Helper', () => {
      it('matches exact name without prefix', () => {
        expect(SuperConverter._matchesElementName('Properties', 'Properties')).toBe(true);
        expect(SuperConverter._matchesElementName('property', 'property')).toBe(true);
      });

      it('matches name with valid namespace prefix', () => {
        expect(SuperConverter._matchesElementName('op:Properties', 'Properties')).toBe(true);
        expect(SuperConverter._matchesElementName('custom:property', 'property')).toBe(true);
        expect(SuperConverter._matchesElementName('ns1:Properties', 'Properties')).toBe(true);
      });

      it('does not match different element names', () => {
        expect(SuperConverter._matchesElementName('SomeOther', 'Properties')).toBe(false);
        expect(SuperConverter._matchesElementName('prop', 'property')).toBe(false);
      });

      it('does not match empty prefix', () => {
        expect(SuperConverter._matchesElementName(':Properties', 'Properties')).toBe(false);
        expect(SuperConverter._matchesElementName(':property', 'property')).toBe(false);
      });

      it('handles null and undefined element names', () => {
        expect(SuperConverter._matchesElementName(null, 'Properties')).toBe(false);
        expect(SuperConverter._matchesElementName(undefined, 'Properties')).toBe(false);
        expect(SuperConverter._matchesElementName('', 'Properties')).toBe(false);
      });

      it('handles non-string element names', () => {
        expect(SuperConverter._matchesElementName(123, 'Properties')).toBe(false);
        expect(SuperConverter._matchesElementName({}, 'Properties')).toBe(false);
        expect(SuperConverter._matchesElementName([], 'Properties')).toBe(false);
      });

      it('handles null and undefined expected names', () => {
        expect(SuperConverter._matchesElementName('Properties', null)).toBe(false);
        expect(SuperConverter._matchesElementName('Properties', undefined)).toBe(false);
        expect(SuperConverter._matchesElementName('Properties', '')).toBe(false);
      });

      it('matches case-sensitive names', () => {
        expect(SuperConverter._matchesElementName('properties', 'Properties')).toBe(false);
        expect(SuperConverter._matchesElementName('PROPERTY', 'property')).toBe(false);
      });
    });
  });

  describe('Backward Compatibility', () => {
    it('deprecated methods show warnings', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      SuperConverter.updateDocumentVersion(mockDocx, '1.0.0');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'updateDocumentVersion is deprecated, use setStoredSuperdocVersion instead',
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Fonts', () => {
    const mockFontTableWithFonts = {
      name: 'word/fontTable.xml',
      content: `
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:fonts xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
          xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
          xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"
          xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"
          xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml"
          xmlns:w16du="http://schemas.microsoft.com/office/word/2023/wordml/word16du"
          xmlns:w16sdtdh="http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash"
          xmlns:w16sdtfl="http://schemas.microsoft.com/office/word/2024/wordml/sdtformatlock"
          xmlns:w16se="http://schemas.microsoft.com/office/word/2015/wordml/symex" mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh w16sdtfl w16du">
          <w:font w:name="Aptos">
              <w:panose1 w:val="020B0004020202020204"/>
              <w:charset w:val="00"/>
              <w:family w:val="swiss"/>
              <w:pitch w:val="variable"/>
              <w:sig w:usb0="20000287" w:usb1="00000003" w:usb2="00000000" w:usb3="00000000" w:csb0="0000019F" w:csb1="00000000"/>
          </w:font>
          <w:font w:name="Times New Roman">
              <w:panose1 w:val="02020603050405020304"/>
              <w:charset w:val="01"/>
              <w:family w:val="roman"/>
              <w:pitch w:val="variable"/>
              <w:sig w:usb0="E0002EFF" w:usb1="C000785B" w:usb2="00000009" w:usb3="00000000" w:csb0="000001FF" w:csb1="00000000"/>
          </w:font>
          <w:font w:name="Aptos Display">
              <w:panose1 w:val="020B0004020202020204"/>
              <w:charset w:val="00"/>
              <w:family w:val="swiss"/>
              <w:pitch w:val="variable"/>
              <w:sig w:usb0="20000287" w:usb1="00000003" w:usb2="00000000" w:usb3="00000000" w:csb0="0000019F" w:csb1="00000000"/>
          </w:font>
        </w:fonts>`,
    };

    const mockFontTableWithoutWFonts = {
      name: 'word/fontTable.xml',
      content: `
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    };

    const mockFontTableWithoutWFont = {
      name: 'word/fontTable.xml',
      content: `
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:fonts xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
          xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
          xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"
          xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"
          xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml"
          xmlns:w16du="http://schemas.microsoft.com/office/word/2023/wordml/word16du"
          xmlns:w16sdtdh="http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash"
          xmlns:w16sdtfl="http://schemas.microsoft.com/office/word/2024/wordml/sdtformatlock"
          xmlns:w16se="http://schemas.microsoft.com/office/word/2015/wordml/symex" mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh w16sdtfl w16du">
        </w:fonts>`,
    };

    describe('getDocumentFonts', () => {
      it('should return fonts used in the document', () => {
        const converter = new SuperConverter({ docx: [...mockDocx, mockFontTableWithFonts] });
        const fonts = converter.getDocumentFonts();
        const expected = ['Aptos', 'Aptos Display', 'Times New Roman'];

        expect(fonts.sort()).toEqual(expected.sort());
      });

      it('should return empty fonts if fontTable is not available', () => {
        const converter = new SuperConverter({ docx: mockDocx });
        const fonts = converter.getDocumentFonts();

        expect(fonts).toEqual([]);
      });

      it('should return empty fonts if w:fonts is not present', () => {
        const converter = new SuperConverter({ docx: [...mockDocx, mockFontTableWithoutWFonts] });
        const fonts = converter.getDocumentFonts();

        expect(fonts).toEqual([]);
      });

      it('should return empty fonts if no w:font at all', () => {
        const converter = new SuperConverter({ docx: [...mockDocx, mockFontTableWithoutWFont] });
        const fonts = converter.getDocumentFonts();

        expect(fonts).toEqual([]);
      });

      it('should return inline document fonts if fontTable is not available', () => {
        const converter = new SuperConverter({ docx: mockDocx });
        converter.inlineDocumentFonts = ['SomeFont', 'SomeFont2'];
        const fonts = converter.getDocumentFonts();

        expect(fonts).toEqual(['SomeFont', 'SomeFont2']);
      });

      it('should not return duplicate fonts', () => {
        const converter = new SuperConverter({ docx: [...mockDocx, mockFontTableWithFonts] });
        // Include some fonts that are already on the fontTable
        converter.inlineDocumentFonts = ['Aptos', 'Times New Roman'];
        const fonts = converter.getDocumentFonts();
        const expected = ['Aptos', 'Aptos Display', 'Times New Roman'];

        expect(fonts.sort()).toEqual(expected.sort());
      });

      it('should not return duplicate fonts (inline fonts)', () => {
        const converter = new SuperConverter({ docx: mockDocx });
        converter.inlineDocumentFonts = ['SomeFont', 'SomeFont', 'SomeFont'];
        const fonts = converter.getDocumentFonts();
        const expected = ['SomeFont'];
        expect(fonts.sort()).toEqual(expected.sort());
      });
    });
  });
});

describe('XML whitespace preservation', () => {
  it('preserves whitespace-only w:t runs without xml:space attribute', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xml:space="preserve">
        <w:body>
          <w:p><w:r><w:t> </w:t></w:r><w:r><w:t>Word</w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    const converter = new SuperConverter({ docx: [{ name: 'word/document.xml', content: xml }] });
    const doc = converter.convertedXml['word/document.xml'];

    // Find all w:t nodes
    const textNodes = [];
    const collectTextNodes = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.name === 'w:t') textNodes.push(node);
      if (Array.isArray(node.elements)) node.elements.forEach(collectTextNodes);
    };
    collectTextNodes(doc.elements?.[0]);

    // The whitespace-only node should have [[sdspace]] placeholders
    const placeholderNode = textNodes.find((node) => node.elements?.[0]?.text?.includes('[[sdspace]]'));
    expect(placeholderNode).toBeTruthy();
  });

  it('preserves whitespace-only w:delText runs', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:del><w:r><w:delText> </w:delText></w:r></w:del></w:p>
        </w:body>
      </w:document>`;
    const converter = new SuperConverter({ docx: [{ name: 'word/document.xml', content: xml }] });
    const doc = converter.convertedXml['word/document.xml'];

    // Find all w:delText nodes
    const textNodes = [];
    const collectTextNodes = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.name === 'w:delText') textNodes.push(node);
      if (Array.isArray(node.elements)) node.elements.forEach(collectTextNodes);
    };
    collectTextNodes(doc.elements?.[0]);

    // The whitespace-only node should have [[sdspace]] placeholders
    const placeholderNode = textNodes.find((node) => node.elements?.[0]?.text?.includes('[[sdspace]]'));
    expect(placeholderNode).toBeTruthy();
  });

  it('captures document-level xml:space attribute', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xml:space="preserve">
        <w:body><w:p><w:r><w:t>Test</w:t></w:r></w:p></w:body>
      </w:document>`;
    const converter = new SuperConverter({ docx: [{ name: 'word/document.xml', content: xml }] });

    expect(converter.documentAttributes?.['xml:space']).toBe('preserve');
  });

  it('does not corrupt literal [[sdspace]] in document content', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>This text contains [[sdspace]] literal placeholder</w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    const converter = new SuperConverter({ docx: [{ name: 'word/document.xml', content: xml }] });
    const doc = converter.convertedXml['word/document.xml'];

    // Find the text node
    const textNodes = [];
    const collectTextNodes = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.name === 'w:t') textNodes.push(node);
      if (Array.isArray(node.elements)) node.elements.forEach(collectTextNodes);
    };
    collectTextNodes(doc.elements?.[0]);

    // The literal [[sdspace]] should still be present in the parsed JSON
    // (it will be removed during text node processing in t-translator)
    const textNode = textNodes[0];
    expect(textNode.elements[0].text).toBe('This text contains [[sdspace]] literal placeholder');
  });

  it('handles w:t elements with attributes correctly', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    const converter = new SuperConverter({ docx: [{ name: 'word/document.xml', content: xml }] });
    const doc = converter.convertedXml['word/document.xml'];

    // Find the text node with attributes
    const textNodes = [];
    const collectTextNodes = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.name === 'w:t') textNodes.push(node);
      if (Array.isArray(node.elements)) node.elements.forEach(collectTextNodes);
    };
    collectTextNodes(doc.elements?.[0]);

    const textNode = textNodes[0];
    expect(textNode.attributes?.['xml:space']).toBe('preserve');
    expect(textNode.elements[0].text).toContain('[[sdspace]]');
  });

  it('handles multiple w:t elements with mixed attributes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:r><w:t>Normal text</w:t></w:r>
            <w:r><w:t xml:space="preserve"> </w:t></w:r>
            <w:r><w:t xml:space="default">Trimmed text  </w:t></w:r>
          </w:p>
        </w:body>
      </w:document>`;
    const converter = new SuperConverter({ docx: [{ name: 'word/document.xml', content: xml }] });
    const doc = converter.convertedXml['word/document.xml'];

    // Find all text nodes
    const textNodes = [];
    const collectTextNodes = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.name === 'w:t') textNodes.push(node);
      if (Array.isArray(node.elements)) node.elements.forEach(collectTextNodes);
    };
    collectTextNodes(doc.elements?.[0]);

    expect(textNodes.length).toBe(3);
    expect(textNodes[0].elements[0].text).toBe('Normal text');
    expect(textNodes[1].attributes?.['xml:space']).toBe('preserve');
    expect(textNodes[1].elements[0].text).toContain('[[sdspace]]');
    expect(textNodes[2].attributes?.['xml:space']).toBe('default');
    expect(textNodes[2].elements[0].text).toBe('Trimmed text  ');
  });
});

describe('SuperConverter styles fallback', () => {
  const baseDocumentXml = {
    name: 'word/document.xml',
    content: `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>Test</w:t></w:r></w:p></w:body>
      </w:document>`,
  };

  const buildStylesXml = (styleId) => ({
    name: 'word/styles2.xml',
    content: `<?xml version="1.0" encoding="UTF-8"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:styleId="${styleId}">
          <w:name w:val="${styleId}"/>
        </w:style>
      </w:styles>`,
  });

  it('uses styles2.xml when styles.xml is missing', () => {
    const styles2Xml = buildStylesXml('AltStyle2');
    const converter = new SuperConverter({ docx: [baseDocumentXml, styles2Xml] });
    const styles = converter.convertedXml['word/styles.xml'];

    expect(styles).toBeTruthy();
    expect(styles.elements?.[0]?.name).toBe('w:styles');
    expect(styles.elements?.[0]?.elements?.[0]?.attributes?.['w:styleId']).toBe('AltStyle2');
  });

  it('prefers the lowest-indexed styles file when multiple exist', () => {
    const styles2Xml = buildStylesXml('AltStyle2');
    const styles4Xml = {
      name: 'word/styles4.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:style w:type="paragraph" w:styleId="AltStyle4">
            <w:name w:val="AltStyle4"/>
          </w:style>
        </w:styles>`,
    };

    const converter = new SuperConverter({ docx: [baseDocumentXml, styles4Xml, styles2Xml] });
    const styles = converter.convertedXml['word/styles.xml'];

    expect(styles?.elements?.[0]?.elements?.[0]?.attributes?.['w:styleId']).toBe('AltStyle2');
  });
});

describe('SuperConverter comment cleanup on export', () => {
  const makeCommentCleanupDocx = () => [
    {
      name: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body><w:p><w:r><w:t>Test</w:t></w:r></w:p></w:body>
        </w:document>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
          <Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="./commentsExtended.xml"/>
          <Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2016/09/relationships/commentsIds" Target="/word/commentsIds.xml"/>
          <Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible" Target="word/commentsExtensible.xml"/>
          <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
          <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="comments.xml"/>
        </Relationships>`,
    },
    {
      name: 'docProps/custom.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
        </Properties>`,
    },
    {
      name: 'word/numbering.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`,
    },
    {
      name: 'word/comments.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`,
    },
    {
      name: 'word/commentsExtended.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>`,
    },
    {
      name: 'word/commentsIds.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"/>`,
    },
    {
      name: 'word/commentsExtensible.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <w16cex:commentsExtensible xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"/>`,
    },
  ];

  it('removes stale comment files and prunes only comment relationships when no comments remain', async () => {
    const converter = new SuperConverter({ docx: makeCommentCleanupDocx() });
    converter.numbering = { abstracts: {}, definitions: {} };

    const exportToXmlJsonSpy = vi.spyOn(converter, 'exportToXmlJson').mockReturnValue({
      result: converter.convertedXml['word/document.xml'].elements[0],
      params: {
        relationships: [],
        media: {},
        exportedCommentDefs: [],
      },
    });

    await converter.exportToDocx({}, {}, {}, false, 'external', [], null, false, null);

    expect(converter.convertedXml['word/comments.xml']).toBeUndefined();
    expect(converter.convertedXml['word/commentsExtended.xml']).toBeUndefined();
    expect(converter.convertedXml['word/commentsIds.xml']).toBeUndefined();
    expect(converter.convertedXml['word/commentsExtensible.xml']).toBeUndefined();

    const relationships =
      converter.convertedXml['word/_rels/document.xml.rels'].elements.find((el) => el.name === 'Relationships')
        .elements || [];

    expect(
      relationships.some((rel) =>
        [
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
          'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
          'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
          'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible',
        ].includes(rel.attributes?.Type),
      ),
    ).toBe(false);

    // Non-comment relationships are retained even if they share a target name.
    expect(relationships.some((rel) => rel.attributes?.Type?.includes('/hyperlink'))).toBe(true);
    expect(
      relationships.some((rel) => rel.attributes?.Type?.includes('/header') && rel.attributes?.Id === 'rId6'),
    ).toBe(true);

    exportToXmlJsonSpy.mockRestore();
  });
});
