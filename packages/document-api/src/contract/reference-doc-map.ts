import {
  OPERATION_DEFINITIONS,
  OPERATION_IDS,
  projectFromDefinitions,
  type ReferenceGroupKey,
} from './operation-definitions.js';
import type { OperationId } from './types.js';

export type { ReferenceGroupKey } from './operation-definitions.js';

export interface ReferenceOperationGroupDefinition {
  key: ReferenceGroupKey;
  title: string;
  description: string;
  pagePath: string;
  operations: readonly OperationId[];
}

export const OPERATION_REFERENCE_DOC_PATH_MAP: Record<OperationId, string> = projectFromDefinitions(
  (_id, entry) => entry.referenceDocPath,
);

const GROUP_METADATA: Record<ReferenceGroupKey, { title: string; description: string; pagePath: string }> = {
  core: {
    title: 'Core',
    description: 'Primary read and write operations.',
    pagePath: 'core/index.mdx',
  },
  blocks: {
    title: 'Blocks',
    description: 'Block-level structural operations.',
    pagePath: 'blocks/index.mdx',
  },
  capabilities: {
    title: 'Capabilities',
    description: 'Runtime support discovery for capability-aware branching.',
    pagePath: 'capabilities/index.mdx',
  },
  create: {
    title: 'Create',
    description: 'Structured creation helpers.',
    pagePath: 'create/index.mdx',
  },
  sections: {
    title: 'Sections',
    description: 'Section structure and page-setup operations.',
    pagePath: 'sections/index.mdx',
  },
  format: {
    title: 'Format',
    description: "Canonical formatting mutation with directive semantics ('on', 'off', 'clear').",
    pagePath: 'format/index.mdx',
  },
  styles: {
    title: 'Styles',
    description: 'Document-level stylesheet mutations (docDefaults, style definitions).',
    pagePath: 'styles/index.mdx',
  },
  lists: {
    title: 'Lists',
    description: 'List inspection and list mutations.',
    pagePath: 'lists/index.mdx',
  },
  comments: {
    title: 'Comments',
    description: 'Comment authoring and thread lifecycle operations.',
    pagePath: 'comments/index.mdx',
  },
  trackChanges: {
    title: 'Track Changes',
    description: 'Tracked-change inspection and review operations.',
    pagePath: 'track-changes/index.mdx',
  },
  query: {
    title: 'Query',
    description: 'Deterministic selector-based queries for mutation targeting.',
    pagePath: 'query/index.mdx',
  },
  mutations: {
    title: 'Mutations',
    description: 'Atomic mutation plan preview and execution.',
    pagePath: 'mutations/index.mdx',
  },
  'format.paragraph': {
    title: 'Paragraph Formatting',
    description: 'Paragraph-level direct formatting: alignment, indentation, spacing, borders, shading, and more.',
    pagePath: 'format/paragraph/index.mdx',
  },
  'styles.paragraph': {
    title: 'Paragraph Styles',
    description: 'Paragraph style reference operations (set/clear w:pStyle).',
    pagePath: 'styles/paragraph/index.mdx',
  },
  templates: {
    title: 'Templates',
    description:
      'Apply detected DOCX template/substrate (styles, numbering, settings, theme, font table, web settings, custom XML) from a source package onto the current document while preserving body content.',
    pagePath: 'templates/index.mdx',
  },
  tables: {
    title: 'Tables',
    description: 'Table structure, layout, styling, and cell operations.',
    pagePath: 'tables/index.mdx',
  },
  history: {
    title: 'History',
    description: 'Undo/redo history state and navigation.',
    pagePath: 'history/index.mdx',
  },
  changes: {
    title: 'Changes',
    description: 'Edit attribution: who changed what, when, and through which session.',
    pagePath: 'changes/index.mdx',
  },
  toc: {
    title: 'Table of Contents',
    description: 'Table of contents lifecycle and configuration.',
    pagePath: 'toc/index.mdx',
  },
  images: {
    title: 'Images',
    description: 'Image lifecycle, placement, and wrap configuration.',
    pagePath: 'images/index.mdx',
  },
  hyperlinks: {
    title: 'Hyperlinks',
    description: 'Hyperlink discovery, creation, and metadata management.',
    pagePath: 'hyperlinks/index.mdx',
  },
  headerFooters: {
    title: 'Headers & Footers',
    description: 'Structure, references, and part lifecycle for document headers and footers.',
    pagePath: 'header-footers/index.mdx',
  },
  watermarks: {
    title: 'Watermarks',
    description: 'Word-compatible text and picture watermark lifecycle and placement.',
    pagePath: 'watermarks/index.mdx',
  },
  contentControls: {
    title: 'Content Controls',
    description: 'Content control (SDT) discovery, mutation, typed controls, and Word compatibility.',
    pagePath: 'content-controls/index.mdx',
  },
  bookmarks: {
    title: 'Bookmarks',
    description: 'Named bookmark inspection, insertion, renaming, and removal.',
    pagePath: 'bookmarks/index.mdx',
  },
  footnotes: {
    title: 'Footnotes',
    description: 'Footnote and endnote lifecycle and numbering configuration.',
    pagePath: 'footnotes/index.mdx',
  },
  clipboard: {
    title: 'Clipboard',
    description: 'Clipboard parsing, model insertion, and selection serialization.',
    pagePath: 'clipboard/index.mdx',
  },
  crossRefs: {
    title: 'Cross-References',
    description: 'Cross-reference field inspection, insertion, rebuild, and removal.',
    pagePath: 'cross-refs/index.mdx',
  },
  index: {
    title: 'Index',
    description: 'Index (TABLE OF AUTHORITIES / INDEX field) lifecycle and XE entry operations.',
    pagePath: 'index/index.mdx',
  },
  captions: {
    title: 'Captions',
    description: 'Caption (SEQ field) inspection, insertion, update, removal, and numbering configuration.',
    pagePath: 'captions/index.mdx',
  },
  fields: {
    title: 'Fields',
    description: 'Raw field code inspection, insertion, rebuild, and removal.',
    pagePath: 'fields/index.mdx',
  },
  citations: {
    title: 'Citations',
    description: 'Citation, source, and bibliography lifecycle operations.',
    pagePath: 'citations/index.mdx',
  },
  authorities: {
    title: 'Table of Authorities',
    description: 'Table of authorities lifecycle and TA entry operations.',
    pagePath: 'authorities/index.mdx',
  },
  ranges: {
    title: 'Ranges',
    description: 'Deterministic range construction from explicit document anchors.',
    pagePath: 'ranges/index.mdx',
  },
  selection: {
    title: 'Selection',
    description: "Read the editor's current selection as a portable, addressable target.",
    pagePath: 'selection/index.mdx',
  },
  diff: {
    title: 'Diff',
    description: 'Snapshot-based document comparison and replay.',
    pagePath: 'diff/index.mdx',
  },
  export: {
    title: 'Export',
    description: 'Modeful DOCX export (review-preserving / final / original) with a structured degradation report.',
    pagePath: 'export/index.mdx',
  },
  protection: {
    title: 'Protection',
    description: 'Document-level protection state and editing restriction operations.',
    pagePath: 'protection/index.mdx',
  },
  permissionRanges: {
    title: 'Permission Ranges',
    description: 'Permission range exception operations for protected documents.',
    pagePath: 'permission-ranges/index.mdx',
  },
  customXml: {
    title: 'Custom XML',
    description:
      'Custom XML Data Storage Part operations (ECMA-376 §15.2.5, §15.2.6). Raw read and write of custom XML parts in the OOXML package.',
    pagePath: 'custom-xml/index.mdx',
  },
  metadata: {
    title: 'Anchored Metadata',
    description:
      'Attach a JSON payload to a span of text and read it back across DOCX round-trips. Backed by hidden inline content controls and namespaced Custom XML Data Storage Parts; consumers see one operation set.',
    pagePath: 'metadata/index.mdx',
  },
};

export const REFERENCE_OPERATION_GROUPS: readonly ReferenceOperationGroupDefinition[] = (
  Object.keys(GROUP_METADATA) as ReferenceGroupKey[]
).map((key) => ({
  key,
  ...GROUP_METADATA[key],
  operations: OPERATION_IDS.filter((id) => OPERATION_DEFINITIONS[id].referenceGroup === key),
}));
