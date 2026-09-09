/**
 * Builds the short fixtures used by focused Editor demos:
 *
 * - `public/fixtures/formatting-sample.docx`
 * - `public/fixtures/document-modes.docx`
 * - `public/fixtures/tracked-review.docx`
 * - `public/fixtures/comments-sample.docx`
 * - `public/fixtures/custom-comments-workflow.docx`
 * - `public/fixtures/custom-track-changes-workflow.docx`
 * - `public/fixtures/custom-content-controls-workflow.docx`
 * - `public/fixtures/custom-selection-workflow.docx`
 * - `public/fixtures/search-sample.docx`
 * - `public/fixtures/hyperlinks-sample.docx`
 * - `public/fixtures/context-menu-sample.docx`
 * - `public/fixtures/content-controls-sample.docx`
 * - `public/fixtures/clause-library-sample.docx`
 *
 * The other two fixtures are full synthetic NDAs, sized for guides that need a
 * realistic contract. These demos need the opposite: each reader has one job,
 * so every extra paragraph is something to scroll past first. The documents
 * are authored here rather than trimmed from `nda.docx` so only the relevant
 * content remains.
 *
 * The formatting and document-mode fixtures are deliberately plain. The
 * built-in comments fixture has one short thread because its page teaches
 * configuration. The tracked-review fixture has one replacement because its
 * page teaches one human decision. The custom comments fixture puts two threads
 * on separate pages because its page teaches application-owned navigation. The
 * custom tracked-changes fixture puts three review decisions on separate pages
 * for the same reason. The custom content-controls fixture puts a text field and a
 * checkbox on separate pages so its application panel can demonstrate field
 * navigation as well as typed mutations. The custom selection fixture puts
 * selectable text on two pages so a floating prompt can follow painted
 * geometry through scroll and zoom changes. The search fixture follows the
 * same rule:
 * three large-type paragraphs across three short pages, with enough repeated
 * terms to show the real search surface moving between results and one pending
 * deletion for the tracked-deletion search option. The hyperlinks fixture contains one real
 * external hyperlink. The context-menu fixture keeps one selectable instruction
 * sentence in view. The content-controls fixture has one text control and one
 * checkbox so readers can inspect the built-in chrome and the metadata reported
 * when they click a control. The clause-library fixture has one block-level
 * control whose paragraph can be replaced.
 *
 * Written as a minimal OOXML package rather than through a library so the bytes
 * are stable: no timestamps, no generated ids, no zip metadata that changes
 * between runs. Regenerating produces no git diff.
 *
 * Run: node scripts/build-demo-fixtures.mjs
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(HERE, '../public/fixtures');

const PLAIN_FIXTURES = [
  {
    fileName: 'formatting-sample.docx',
    paragraphs: [
      'Select this sentence and press the Bold button above.',
      'The button is part of this documentation page, not part of SuperDoc. It reads whether it can run from the editor, and runs through it.',
      'Everything else here — the page, the text, the selection you just made — is SuperDoc rendering a real DOCX file.',
    ],
  },
  {
    fileName: 'document-modes.docx',
    paragraphs: ['Notice period', 'Either party may end this agreement by giving 30 days’ written notice.'],
  },
  {
    fileName: 'context-menu-sample.docx',
    paragraphs: ['Context menu', 'Select this sentence, then right-click it to open the document menu.'],
  },
];

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const COMMENT_CONTENT_TYPES = CONTENT_TYPES.replace(
  '</Types>',
  '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>',
);

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const COMMENT_DOCUMENT_RELS = DOCUMENT_RELS.replace(
  '</Relationships>',
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>',
);

const HYPERLINKS_DOCUMENT_RELS = DOCUMENT_RELS.replace(
  '</Relationships>',
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://docs.superdoc.dev/" TargetMode="External"/></Relationships>',
);

/**
 * Word's defaults only, at 16pt rather than the usual 11pt.
 *
 * The embed scales the page to fit its container width, so a normal body size
 * renders small and reads as a zoomed-out document. Authoring larger means the
 * fitted result looks like text someone would actually work with.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

const SEARCH_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

const COMPACT_WORKFLOW_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

const escapeXml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const paragraph = (text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

const plainParagraph = (text) => `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;

const heading = (text) =>
  `<w:p><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;

const commentParagraph = (id, before, target, after) =>
  `<w:p><w:r><w:t xml:space="preserve">${escapeXml(before)}</w:t></w:r><w:commentRangeStart w:id="${id}"/><w:r><w:t>${escapeXml(target)}</w:t></w:r><w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r><w:r><w:t>${escapeXml(after)}</w:t></w:r></w:p>`;

const trackedInsertion = (id, author, date, text) =>
  `<w:ins w:id="${id}" w:author="${escapeXml(author)}" w:date="${date}"><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:ins>`;

const trackedDeletion = (
  text,
  id = 0,
  author = 'SuperDoc Test User',
  date = '2025-01-15T00:00:00Z',
) =>
  `<w:del w:id="${id}" w:author="${escapeXml(author)}" w:date="${date}"><w:r><w:delText xml:space="preserve">${escapeXml(text)}</w:delText></w:r></w:del>`;

const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const TRACKED_REVIEW_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${heading(
  'Service agreement',
)}<w:p><w:r><w:t xml:space="preserve">Either party may end this agreement by giving </w:t></w:r>${trackedDeletion(
  '30',
  1,
  'Alex Rivera',
  '2026-08-15T12:00:00Z',
)}${trackedInsertion(2, 'Alex Rivera', '2026-08-15T12:00:00Z', '60')}<w:r><w:t xml:space="preserve"> days’ written notice.</w:t></w:r></w:p>${paragraph(
  'The confidentiality obligations continue after this agreement ends.',
)}<w:sectPr><w:pgSz w:w="12240" w:h="6480"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

/**
 * A short page, not US Letter.
 *
 * Three paragraphs on an 11in page is mostly blank paper, and the embed would
 * either scroll through it or shrink the text to fit its height. At 4.5in the
 * whole document is visible at once, so the frame needs no scrollbars and the
 * reader sees the sentence they are asked to select without moving anything.
 *
 * The width stays 8.5in so the fitted zoom is computed from a familiar page
 * width; margins are tightened to give the text more of it.
 */
const documentXml = (paragraphs) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
  .map(paragraph)
  .join('')}<w:sectPr><w:pgSz w:w="12240" w:h="6480"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const COMMENTS_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Project schedule</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">The final delivery date is </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>September 30, 2026</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r><w:r><w:t>.</w:t></w:r></w:p><w:p><w:r><w:t>Select another phrase to start a new thread.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="6480"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const COMMENTS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="0" w:author="SuperDoc Test User" w:initials="ST" w:date="2025-01-15T00:00:00Z"><w:p w14:paraId="00000001"><w:r><w:t>Does this match the signed schedule?</w:t></w:r></w:p></w:comment></w:comments>`;

const CUSTOM_COMMENTS_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${heading(
  'Project kickoff',
)}${commentParagraph(0, 'Kickoff date: ', 'January 12, 2027', '.')}${paragraph(
  'Use the comment list to return to this date.',
)}${pageBreak}${heading('Scope review')}${paragraph(
  'Select the approval criteria and add a comment.',
)}${paragraph('This middle page is ready for a new thread.')}${pageBreak}${heading('Final delivery')}${commentParagraph(
  1,
  'Delivery date: ',
  'September 30, 2027',
  '.',
)}${paragraph(
  'Use the other thread to move between the first and final pages.',
)}<w:sectPr><w:pgSz w:w="12240" w:h="7920"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const CUSTOM_COMMENTS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="SuperDoc Test User" w:initials="ST" w:date="2025-01-15T00:00:00Z"><w:p><w:r><w:t>Confirm the kickoff date.</w:t></w:r></w:p></w:comment><w:comment w:id="1" w:author="SuperDoc Test User" w:initials="ST" w:date="2025-01-15T00:00:00Z"><w:p><w:r><w:t>Does this match the signed schedule?</w:t></w:r></w:p></w:comment></w:comments>`;

const CUSTOM_TRACK_CHANGES_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${heading(
  'Payment terms',
)}<w:p><w:r><w:t xml:space="preserve">Invoices are due </w:t></w:r>${trackedInsertion(
  1001,
  'Alex Rivera',
  '2026-08-12T09:00:00Z',
  'within 10 business days',
)}<w:r><w:t xml:space="preserve"> after receipt.</w:t></w:r></w:p>${paragraph(
  'Review the inserted payment deadline.',
)}${pageBreak}${heading(
  'Renewal',
)}<w:p><w:r><w:t xml:space="preserve">The agreement </w:t></w:r>${trackedDeletion(
  'automatically renews for one year',
  1002,
  'Morgan Lee',
  '2026-08-13T14:30:00Z',
)}<w:r><w:t xml:space="preserve"> unless either party gives notice.</w:t></w:r></w:p>${paragraph(
  'Review the deleted renewal term.',
)}${pageBreak}${heading(
  'Travel expenses',
)}<w:p><w:r><w:t xml:space="preserve">Travel expenses require </w:t></w:r>${trackedInsertion(
  1003,
  'Alex Rivera',
  '2026-08-14T11:15:00Z',
  'prior written approval',
)}<w:r><w:t>.</w:t></w:r></w:p>${paragraph(
  'Review the inserted approval requirement.',
)}<w:sectPr><w:pgSz w:w="12240" w:h="7920"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const CUSTOM_CONTENT_CONTROLS_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"><w:body>${heading(
  'Agreement details',
)}<w:p><w:r><w:t xml:space="preserve">Client name: </w:t></w:r><w:sdt><w:sdtPr><w:alias w:val="Client name"/><w:tag w:val="client-name"/><w:id w:val="3001"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Acme Inc.</w:t></w:r></w:sdtContent></w:sdt></w:p>${plainParagraph(
  'Update the client name from the field panel.',
)}${pageBreak}${heading(
  'Review',
)}<w:p><w:sdt><w:sdtPr><w:alias w:val="Review approved"/><w:tag w:val="review-approved"/><w:id w:val="3002"/><w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:font="MS Gothic" w14:val="2612"/><w14:uncheckedState w14:font="MS Gothic" w14:val="2610"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> Approved for review</w:t></w:r></w:p>${plainParagraph(
  'Use Show in document to move between fields.',
)}<w:sectPr><w:pgSz w:w="12240" w:h="6480"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const CUSTOM_SELECTION_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${heading(
  'Limitation of liability',
)}${paragraph('Neither party’s aggregate liability may exceed the fees Customer paid in the twelve months before the claim.')}${paragraph(
  'Select the cap and choose Ask AI.',
)}${pageBreak}${heading('Term and renewal')}${paragraph(
  'This Agreement renews unless either party gives sixty days’ written notice.',
)}${paragraph(
  'Select the notice to move the prompt.',
)}<w:sectPr><w:pgSz w:w="12240" w:h="6480"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const SEARCH_PARAGRAPHS = [
  'The Client team opens the project brief and checks every Client name before review begins.',
  'During review, the Client owner compares each client request with the source file. The Client team then replaces outdated terms.',
  'When the Client owner finishes, the Client sponsor reads the final document and confirms that the Client workspace is ready.',
];

const searchParagraph = (text, index) => {
  if (index !== 1) return paragraph(text);

  const [before, after] = text.split(' client request');
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(before)}</w:t></w:r>${trackedDeletion(' Legacy')}<w:r><w:t xml:space="preserve"> client request${escapeXml(after)}</w:t></w:r></w:p>`;
};

const SEARCH_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${SEARCH_PARAGRAPHS.map(
  (text, index) => `${index === 0 ? '' : pageBreak}${searchParagraph(text, index)}`,
).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="6480"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const HYPERLINKS_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Hyperlink behavior</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Click </w:t></w:r><w:hyperlink r:id="rId2" w:history="1"><w:r><w:rPr><w:color w:val="1355FF"/><w:u w:val="single"/></w:rPr><w:t>SuperDoc documentation</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> to try the selected activation behavior.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="6480"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const CONTENT_CONTROLS_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"><w:body><w:p><w:r><w:t>Content controls</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Client name: </w:t></w:r><w:sdt><w:sdtPr><w:alias w:val="Client name"/><w:tag w:val="client-name"/><w:id w:val="2001"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Acme Inc.</w:t></w:r></w:sdtContent></w:sdt></w:p><w:p><w:sdt><w:sdtPr><w:alias w:val="Review approved"/><w:tag w:val="review-approved"/><w:id w:val="2002"/><w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:font="MS Gothic" w14:val="2612"/><w14:uncheckedState w14:font="MS Gothic" w14:val="2610"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> Approved for review</w:t></w:r></w:p><w:p><w:r><w:t>Click either field to inspect its DOCX metadata.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="6480"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const CLAUSE_LIBRARY_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Confidentiality</w:t></w:r></w:p><w:sdt><w:sdtPr><w:alias w:val="Confidentiality clause"/><w:tag w:val="agreement.confidentiality"/><w:id w:val="2601"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Each party must protect the other party's confidential information and use it only to perform this agreement.</w:t></w:r></w:p></w:sdtContent></w:sdt><w:p><w:r><w:t>These obligations survive termination for three years.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="6480"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

/**
 * Every core property stays empty, including title and description.
 *
 * `scripts/check-docx-privacy.mjs` scans every tracked DOCX in the repo and
 * treats any populated core property as metadata to review, not just author
 * fields — a title travels with the file if someone downloads it. The other
 * docs fixtures are sanitized the same way; what the document is for belongs in
 * `public/fixtures/README.md`, which is not shipped inside the DOCX.
 */
const CORE_PROPERTIES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title></dc:title><dc:subject></dc:subject><dc:creator></dc:creator><cp:keywords></cp:keywords><dc:description></dc:description><cp:lastModifiedBy></cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2025-01-15T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2025-01-15T00:00:00Z</dcterms:modified><cp:category></cp:category></cp:coreProperties>`;

const appProperties = (paragraphCount) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>SuperDoc</Application><Company></Company><Manager></Manager><Template></Template><Paragraphs>${paragraphCount}</Paragraphs></Properties>`;

async function writeDocx(fileName, parts) {
  const zip = new JSZip();
  for (const [name, content] of parts) {
    // A fixed date keeps the archive byte-stable across runs.
    zip.file(name, content, { createFolders: false, date: new Date('2025-01-15T00:00:00Z') });
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const out = path.join(FIXTURES_DIR, fileName);
  await writeFile(out, buffer);
  console.log(`Wrote ${path.relative(process.cwd(), out)} (${buffer.length} bytes).`);
}

for (const fixture of PLAIN_FIXTURES) {
  await writeDocx(fixture.fileName, [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['word/document.xml', documentXml(fixture.paragraphs)],
    ['word/_rels/document.xml.rels', DOCUMENT_RELS],
    ['word/styles.xml', STYLES],
    ['docProps/core.xml', CORE_PROPERTIES],
    ['docProps/app.xml', appProperties(fixture.paragraphs.length)],
  ]);
}

await writeDocx('comments-sample.docx', [
  ['[Content_Types].xml', COMMENT_CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', COMMENTS_DOCUMENT],
  ['word/_rels/document.xml.rels', COMMENT_DOCUMENT_RELS],
  ['word/styles.xml', STYLES],
  ['word/comments.xml', COMMENTS_XML],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(3)],
]);

await writeDocx('tracked-review.docx', [
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', TRACKED_REVIEW_DOCUMENT],
  ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ['word/styles.xml', STYLES],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(3)],
]);

await writeDocx('custom-comments-workflow.docx', [
  ['[Content_Types].xml', COMMENT_CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', CUSTOM_COMMENTS_DOCUMENT],
  ['word/_rels/document.xml.rels', COMMENT_DOCUMENT_RELS],
  ['word/styles.xml', COMPACT_WORKFLOW_STYLES],
  ['word/comments.xml', CUSTOM_COMMENTS_XML],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(11)],
]);

await writeDocx('custom-track-changes-workflow.docx', [
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', CUSTOM_TRACK_CHANGES_DOCUMENT],
  ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ['word/styles.xml', COMPACT_WORKFLOW_STYLES],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(11)],
]);

await writeDocx('custom-content-controls-workflow.docx', [
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', CUSTOM_CONTENT_CONTROLS_DOCUMENT],
  ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ['word/styles.xml', COMPACT_WORKFLOW_STYLES],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(7)],
]);

await writeDocx('custom-selection-workflow.docx', [
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', CUSTOM_SELECTION_DOCUMENT],
  ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ['word/styles.xml', COMPACT_WORKFLOW_STYLES],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(7)],
]);

await writeDocx('search-sample.docx', [
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', SEARCH_DOCUMENT],
  ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ['word/styles.xml', SEARCH_STYLES],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(SEARCH_PARAGRAPHS.length)],
]);

await writeDocx('hyperlinks-sample.docx', [
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', HYPERLINKS_DOCUMENT],
  ['word/_rels/document.xml.rels', HYPERLINKS_DOCUMENT_RELS],
  ['word/styles.xml', STYLES],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(2)],
]);

await writeDocx('content-controls-sample.docx', [
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', CONTENT_CONTROLS_DOCUMENT],
  ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ['word/styles.xml', STYLES],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(4)],
]);

await writeDocx('clause-library-sample.docx', [
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', ROOT_RELS],
  ['word/document.xml', CLAUSE_LIBRARY_DOCUMENT],
  ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ['word/styles.xml', STYLES],
  ['docProps/core.xml', CORE_PROPERTIES],
  ['docProps/app.xml', appProperties(3)],
]);
