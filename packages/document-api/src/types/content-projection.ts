import type { BlockNodeAddress, BlockNodeType } from './base.js';
import type { Range, SelectionTarget, TextTarget } from './address.js';
import type { StoryLocator } from './story.types.js';
import type { SDDiagnostic, SDHtmlMarkdownOutcome } from './sd-contract.js';

export const SD_PROJECTION_FORMATS = ['html', 'markdown'] as const;
export type SDProjectionFormat = (typeof SD_PROJECTION_FORMATS)[number];

export const SD_PROJECTION_REVIEW_MODES = ['final', 'original', 'redline'] as const;
export type SDProjectionReviewMode = (typeof SD_PROJECTION_REVIEW_MODES)[number];

export const SD_PROJECTION_STATUSES = ['success', 'warning', 'failed'] as const;
export type SDProjectionStatus = (typeof SD_PROJECTION_STATUSES)[number];

export const SD_PROJECTION_DIAGNOSTIC_CODES = [
  'projection-normalized-construct',
  'projection-downgraded-construct',
  'projection-unsupported-construct',
  'projection-placeholder-emitted',
  'projection-annotation-omitted',
  'projection-numbering-unresolved',
  'projection-source-coverage-incomplete',
  'projection-scope-unsupported',
  'projection-limit-exceeded',
  'projection-revision-changed',
  'projection-malformed-source',
] as const;
export type SDProjectionDiagnosticCode = (typeof SD_PROJECTION_DIAGNOSTIC_CODES)[number];

export const SD_PROJECTION_CONSTRUCTS = [
  'document',
  'source',
  'text',
  'paragraph',
  'emptyParagraph',
  'softBreak',
  'lineBreak',
  'heading',
  'bold',
  'italic',
  'underline',
  'strike',
  'hyperlink',
  'list',
  'listLabel',
  'table',
  'tableHeader',
  'tableRow',
  'tableCell',
  'colSpan',
  'rowSpan',
  'horizontalRule',
  'inlineCode',
  'codeBlock',
  'image',
  'field',
  'contentControl',
  'math',
  'drawing',
  'embeddedObject',
  'sectionBreak',
  'pageBreak',
  'columnBreak',
  'trackedChange',
  'comment',
  'scope',
  'placeholder',
] as const;
export type SDProjectionConstruct = (typeof SD_PROJECTION_CONSTRUCTS)[number];

export const SD_PROJECTION_DISPOSITIONS = [
  'preserved',
  'normalized',
  'downgraded',
  'placeholder',
  'omitted',
  'rejected',
] as const;
export type SDProjectionDisposition = (typeof SD_PROJECTION_DISPOSITIONS)[number];

export type SDProjectionScope = BlockNodeAddress | SelectionTarget;

export interface SDProjectionReadInput {
  in?: StoryLocator;
  reviewMode?: SDProjectionReviewMode;
  scope?: SDProjectionScope;
}

export interface ProjectHtmlInput extends SDProjectionReadInput {
  styling?: 'inline';
  includeSourceMap?: boolean;
}

export interface ProjectMarkdownInput extends SDProjectionReadInput {
  includeSourceMap?: boolean;
}

export type SDResolvedProjectionScope =
  | { kind: 'story' }
  | { kind: 'block'; target: BlockNodeAddress }
  | { kind: 'range'; target: SelectionTarget & { coordinateSpace: 'tracked' } };

export type SDProjectionBlockMapEntry = {
  nodeType: BlockNodeType;
  output: Range;
  parentBlockId?: string;
  changeIds?: string[];
  commentIds?: string[];
} & (
  | { identity: 'public'; blockId: string }
  | {
      identity: 'unavailable';
      identityUnavailableReason: 'positionDerivedFallback';
      blockId?: never;
    }
);

export type SDProjectionDiagnostic = Omit<SDDiagnostic, 'code' | 'construct' | 'disposition' | 'lossy' | 'source'> & {
  code: SDProjectionDiagnosticCode;
  construct: SDProjectionConstruct;
  disposition: SDProjectionDisposition;
  lossy: boolean;
  source: {
    story: StoryLocator;
    blockId?: string;
    range?: Range;
    coordinateSpace?: 'tracked';
    changeIds?: string[];
    commentIds?: string[];
  };
  output?: {
    format: SDProjectionFormat;
    range?: Range;
  };
};

export interface SDProjectionSourceMap {
  version: 'sd-projection-source-map/1';
  outputCoordinateSpace: 'utf16';
  sourceCoordinateSpace: 'tracked';
  entries: SDProjectionSourceMapEntry[];
}

export type SDProjectionSourceMapEntry =
  | {
      kind: 'text';
      output: Range;
      source: TextTarget & { coordinateSpace: 'tracked' };
      blockId: string;
      changeIds?: string[];
      commentIds?: string[];
    }
  | ({
      kind: 'synthetic';
      output: Range;
      role: 'listLabel' | 'placeholder';
      changeIds?: string[];
      commentIds?: string[];
    } & (
      | { identity: 'public'; blockId: string }
      | {
          identity: 'unavailable';
          identityUnavailableReason: 'positionDerivedFallback';
          blockId?: never;
        }
    ));

export interface SDProjectionAnnotation {
  kind: 'trackedChange' | 'comment';
  id: string;
  blockIds: string[];
  sourceTarget?: TextTarget;
  outputRanges: Range[];
  status: 'emitted' | 'partiallyEmitted' | 'omitted';
  omittedReason?: 'reviewMode' | 'unsupported';
  side?: 'inserted' | 'deleted' | 'source' | 'destination' | 'formatting';
}

export interface SDContentProjectionResult<TFormat extends SDProjectionFormat = SDProjectionFormat> {
  format: TFormat;
  content: string;
  status: SDProjectionStatus;
  /** Fidelity outcome derived from the complete projection diagnostics. */
  outcome: SDHtmlMarkdownOutcome;
  reviewMode: SDProjectionReviewMode;
  evaluatedRevision: string;
  story: StoryLocator;
  scope: SDResolvedProjectionScope;
  lossy: boolean;
  diagnostics: SDProjectionDiagnostic[];
  blocks: SDProjectionBlockMapEntry[];
  annotations: SDProjectionAnnotation[];
  sourceMap?: SDProjectionSourceMap;
}

export function deriveSDHtmlMarkdownOutcome(
  diagnostics: readonly Pick<SDDiagnostic, 'severity' | 'lossy'>[],
): SDHtmlMarkdownOutcome {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'rejected';
  if (diagnostics.some((diagnostic) => diagnostic.lossy)) return 'simplified';
  if (diagnostics.length > 0) return 'preserved-with-warnings';
  return 'preserved';
}

export function deriveSDProjectionStatus(
  diagnostics: readonly Pick<SDProjectionDiagnostic, 'severity' | 'lossy'>[],
): SDProjectionStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'failed';
  if (diagnostics.some((diagnostic) => diagnostic.lossy)) return 'warning';
  return 'success';
}

export function validateSDProjectionSourceMap(sourceMap: SDProjectionSourceMap, contentLength: number): boolean {
  let previousEnd = 0;
  for (const entry of sourceMap.entries) {
    const { start, end } = entry.output;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < previousEnd ||
      end < start ||
      end > contentLength
    ) {
      return false;
    }
    if (entry.kind === 'text') {
      if (entry.source.coordinateSpace !== 'tracked' || entry.source.segments.length === 0) return false;
      if (isForbiddenProjectionIdentity(entry.blockId)) return false;
      if (
        entry.source.segments.some(
          (segment) =>
            !Number.isInteger(segment.range.start) ||
            !Number.isInteger(segment.range.end) ||
            segment.range.start < 0 ||
            segment.range.start > segment.range.end ||
            segment.blockId !== entry.blockId ||
            isForbiddenProjectionIdentity(segment.blockId),
        )
      )
        return false;
    } else {
      if (Object.prototype.hasOwnProperty.call(entry, 'source')) return false;
      if (entry.identity === 'public' && isForbiddenProjectionIdentity(entry.blockId)) return false;
    }
    previousEnd = end;
  }
  return true;
}

function isForbiddenProjectionIdentity(value: string): boolean {
  return /^(?:w:id:|tbl:p@|tr:r\d|tc:o\d+@)/u.test(value);
}
