import { DOM_CLASS_NAMES } from './constants.js';

/**
 * Fallback font-size applied to child elements inside a line container that
 * carry no explicit fontSize. Matches the browser default so rendering is
 * preserved after the strut-elimination fix (fontSize: '0' on lines).
 */
export const BROWSER_DEFAULT_FONT_SIZE = '16px';

export const CLASS_NAMES = {
  container: 'superdoc-layout',
  page: 'superdoc-page',
  fragment: 'superdoc-fragment',
  line: 'superdoc-line',
  spread: 'superdoc-spread',
  pageHeader: 'superdoc-page-header',
  pageFooter: 'superdoc-page-footer',
  textRun: 'superdoc-text-run',
  positionedRun: 'superdoc-positioned-run',
};

export type PageStyles = {
  background?: string;
  boxShadow?: string;
  border?: string;
  margin?: string;
  color?: string;
};

export const DEFAULT_PAGE_STYLES: Required<PageStyles> = {
  background: 'var(--sd-layout-page-bg, #fff)',
  boxShadow: 'var(--sd-layout-page-shadow, 0 4px 20px rgba(15, 23, 42, 0.08))',
  border: '1px solid rgba(15, 23, 42, 0.08)',
  margin: '0 auto',
  color: 'var(--sd-layout-page-color, #000000)',
};

export const containerStyles: Partial<CSSStyleDeclaration> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  background: 'transparent',
  padding: '0',
  // gap is set dynamically by renderer based on pageGap option (default: 24px)
  overflowY: 'auto',
  // Contain child z-indices (SDT labels, hover states) so they cannot escape
  // above sibling UI surfaces like the toolbar or ruler. (SD-2015)
  isolation: 'isolate',
};

export const containerStylesHorizontal: Partial<CSSStyleDeclaration> = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-start',
  justifyContent: 'safe center',
  background: 'transparent',
  padding: '0',
  // gap is set dynamically by renderer based on pageGap option (default: 20px for horizontal)
  overflowX: 'auto',
  minHeight: '100%',
  isolation: 'isolate',
};

export const spreadStyles: Partial<CSSStyleDeclaration> = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '0px',
};

export const pageStyles = (width: number, height: number, overrides?: PageStyles): Partial<CSSStyleDeclaration> => {
  const merged = { ...DEFAULT_PAGE_STYLES, ...(overrides || {}) };

  return {
    position: 'relative',
    width: `${width}px`,
    height: `${height}px`,
    minWidth: `${width}px`,
    minHeight: `${height}px`,
    flexShrink: '0',
    background: merged.background,
    boxShadow: merged.boxShadow,
    border: merged.border,
    margin: merged.margin,
    color: merged.color,
    overflow: 'hidden',
  };
};

export const fragmentStyles: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  whiteSpace: 'pre',
  overflow: 'visible',
  boxSizing: 'border-box',
  color: 'inherit',
};

/**
 * Line container styles. z-index is intentionally not set on the line so that
 * the resize overlay (and other UI) can stack above content. Only the image
 * element itself gets z-index for layering within the line (e.g. above tab leaders).
 */
export const lineStyles = (lineHeight: number): Partial<CSSStyleDeclaration> => ({
  lineHeight: `${lineHeight}px`,
  height: `${lineHeight}px`,
  // Eliminate the CSS "strut" created by the inherited font-size (typically
  // the browser default 16px). Without this, the strut shifts normal-flow
  // inline children down via baseline alignment, while absolutely-positioned
  // children (used for tab-aligned segments) are unaffected — causing
  // tab-indented first lines to appear shifted up relative to continuation
  // lines. All text-bearing child elements set their own explicit font-size;
  // elements that don't (empty-run, math wrapper, field annotation wrapper)
  // are patched individually in renderer.ts.
  fontSize: '0',
  color: 'inherit',
  position: 'relative',
  display: 'block',
  whiteSpace: 'pre',
  // Allow text to overflow the line container as a safety net.
  // The primary fix uses accurate font metrics from Canvas API, but this
  // provides defense-in-depth against any remaining sub-pixel rendering
  // differences between measurement and display.
  overflow: 'visible',
});

const PRINT_STYLES = `
@media print {
  .${CLASS_NAMES.container} {
    background: transparent;
    padding: 0;
  }

  .${CLASS_NAMES.page} {
    margin: 0;
    border: none;
    box-shadow: none;
    page-break-after: always;
  }
}
`;

const DOCUMENT_SURFACE_STYLES = `
/* Document paint isolation.
 *
 * The rendered page is document content, not host chrome. Establish a page
 * foreground and force painter-owned wrappers/text runs to inherit from that
 * page so common host CSS such as :root/body/span/body * color rules cannot
 * recolor unresolved/auto document text. This deliberately avoids priority flags:
 * real run colors applied as inline styles and painter feature states still win.
 */
.${CLASS_NAMES.container} {
  color: var(--sd-layout-page-color, #000000);
}

.${CLASS_NAMES.container} .${CLASS_NAMES.page},
.${CLASS_NAMES.container} .${CLASS_NAMES.pageHeader},
.${CLASS_NAMES.container} .${CLASS_NAMES.pageFooter},
.${CLASS_NAMES.container} .${CLASS_NAMES.fragment},
.${CLASS_NAMES.container} .${CLASS_NAMES.line},
.${CLASS_NAMES.container} .superdoc-list-content,
.${CLASS_NAMES.container} .${DOM_CLASS_NAMES.LIST_MARKER} {
  color: inherit;
}

.${CLASS_NAMES.container} .${CLASS_NAMES.page} .${CLASS_NAMES.textRun}:not([data-bookmark-marker]) {
  color: inherit;
}
`;

const LINK_AND_TOC_STYLES = `
/* Reset browser default link styling - allow run colors to show through from inline styles
 *
 * Note: !important was removed from these rules to allow inline styles to take precedence.
 * This is necessary because OOXML hyperlink character styles apply colors via inline style
 * attributes on the run elements. The CSS cascade ensures that inline styles (applied via
 * element.style.color in applyRunStyles) override these class-based rules naturally.
 *
 * Implications:
 * - OOXML hyperlink character styles will correctly display their assigned colors
 * - Browser default link colors are still reset by these inherit rules
 * - Inline color styles from run objects override the inherit value as expected
 */
.superdoc-link {
  color: inherit;
  text-decoration: none;
}

.superdoc-link:visited {
  color: inherit;
}

.superdoc-link:hover {
  text-decoration: underline;
}

/* Focus visible for keyboard navigation (WCAG 2.1 SC 2.4.7) */
.superdoc-link:focus-visible {
  outline: 2px solid #0066cc;
  outline-offset: 2px;
  border-radius: 2px;
}

/* Remove outline for mouse users */
.superdoc-link:focus:not(:focus-visible) {
  outline: none;
}

/* Active state */
.superdoc-link:active {
  opacity: 0.8;
}

/* Print mode: show URLs after links */
@media print {
  .superdoc-link::after {
    content: " (" attr(href) ")";
    font-size: 0.9em;
    color: #666;
  }

  /* Don't show URL for anchor-only links */
  .superdoc-link[href^="#"]::after {
    content: "";
  }
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .superdoc-link:focus-visible {
    outline-width: 3px;
    outline-offset: 3px;
  }
}

/* SD-2454: bookmark bracket indicators.
 * When the showBookmarks layout option is enabled, the pm-adapter emits
 * [ and ] marker TextRuns at bookmark start/end positions. Mirror Word's
 * visual treatment: subtle gray, non-selectable so users can't accidentally
 * include the brackets in copied text. The bookmark name is surfaced via
 * the native title tooltip on the opening bracket. */
.${CLASS_NAMES.container} [data-bookmark-marker="start"],
.${CLASS_NAMES.container} [data-bookmark-marker="end"] {
  color: #8b8b8b;
  user-select: none;
  cursor: default;
  font-weight: normal;
}


/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  .superdoc-link {
    transition: none;
  }
}

/* Screen reader only content (WCAG SC 1.3.1) */
.superdoc-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* TOC entry specific styles - prevent wrapping */
.superdoc-toc-entry {
  white-space: nowrap !important;
}

.superdoc-toc-entry .superdoc-link {
  color: inherit !important;
  text-decoration: none !important;
  cursor: default;
  /* Disable native link drag so our pointer loop can run text-selection. */
  -webkit-user-drag: none;
  user-drag: none;
}

.superdoc-toc-entry .superdoc-link:hover {
  text-decoration: none;
}

/* Override focus styles for TOC links (they're not interactive) */
.superdoc-toc-entry .superdoc-link:focus-visible {
  outline: none;
}

/* TOC hover. .toc-group-hover is set by PresentationEditor on every entry
   sharing a data-toc-id so the whole TOC greys out together. The ::after
   stripe (height set via --toc-gap-below) fills the paragraph-spacing gap
   between adjacent entries so the hover reads as one continuous block. */
.superdoc-toc-entry:hover,
.superdoc-toc-entry.toc-group-hover {
  background-color: var(--sd-content-controls-block-hover-bg, #f2f2f2);
}

/* Pointer-events stay on (default) so the stripe extends the parent entry's
   hit-test area through the paragraph-spacing gap. Without this, moving the
   cursor between two adjacent entries fires mouseout on the upper entry with
   relatedTarget = the page (not a TOC entry), the coordinator drops the
   group-hover class, and the grey disappears for a frame before the next
   entry's mouseover restores it — visible as a flicker. */
.superdoc-toc-entry.toc-group-hover::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  height: var(--toc-gap-below, 0px);
  background-color: var(--sd-content-controls-block-hover-bg, #f2f2f2);
}

/* Remove focus outlines from layout engine elements */
.superdoc-layout,
.superdoc-page,
.superdoc-layout:focus,
.superdoc-page:focus {
  outline: none !important;
}
`;

const TRACK_CHANGE_STYLES = `
.superdoc-layout .track-insert-dec.hidden,
.superdoc-layout .track-delete-dec.hidden {
  display: none;
}

.superdoc-layout .track-insert-dec.highlighted {
  border-top: var(--sd-tracked-changes-insert-border-width, 1px) dashed var(--sd-tracked-changes-insert-border, #00853d);
  border-bottom: var(--sd-tracked-changes-insert-border-width, 1px) dashed var(--sd-tracked-changes-insert-border, #00853d);
  background-color: var(--sd-tracked-changes-insert-background, #399c7222);
  color: var(--sd-tracked-changes-insert-text, currentColor);
  text-decoration-line: var(--sd-tracked-changes-insert-decoration-line, none);
  text-decoration-color: var(--sd-tracked-changes-insert-text, currentColor);
  text-decoration-thickness: var(--sd-tracked-changes-insert-decoration-thickness, 1px);
  text-underline-offset: var(--sd-tracked-changes-insert-underline-offset, 0px);
}

.superdoc-layout .track-delete-dec.highlighted {
  border-top: var(--sd-tracked-changes-delete-border-width, 1px) dashed var(--sd-tracked-changes-delete-border, #cb0e47);
  border-bottom: var(--sd-tracked-changes-delete-border-width, 1px) dashed var(--sd-tracked-changes-delete-border, #cb0e47);
  background-color: var(--sd-tracked-changes-delete-background, #cb0e4722);
  color: var(--sd-tracked-changes-delete-text, currentColor);
  text-decoration:
    line-through
    solid
    var(--sd-tracked-changes-delete-text, currentColor)
    var(--sd-tracked-changes-delete-decoration-thickness, 2px) !important;
}

.superdoc-layout .track-format-dec.highlighted {
  border-bottom: 2px solid var(--sd-tracked-changes-format-border, gold);
}

.superdoc-layout .track-insert-dec.highlighted.track-change-focused {
  border-left: none;
  border-right: none;
  border-top-style: solid;
  border-bottom-style: solid;
  background-color: var(--sd-tracked-changes-insert-background-focused, #399c7244);
}

.superdoc-layout .track-delete-dec.highlighted.track-change-focused {
  border-left: none;
  border-right: none;
  border-top-style: solid;
  border-bottom-style: solid;
  background-color: var(--sd-tracked-changes-delete-background-focused, #cb0e4744);
}

.superdoc-layout .track-overlap-insert-delete-dec.track-insert-dec.track-delete-dec.highlighted {
  border-top: var(--sd-tracked-changes-insert-border-width, 1px) dashed var(--sd-tracked-changes-insert-border, #00853d);
  border-bottom: var(--sd-tracked-changes-insert-border-width, 1px) dashed var(--sd-tracked-changes-insert-border, #00853d);
  background-color: var(--sd-tracked-changes-insert-background, #399c7222);
  color: var(--sd-tracked-changes-insert-text, currentColor);
  text-decoration:
    line-through
    solid
    var(--sd-tracked-changes-delete-text, #cb0e47)
    var(--sd-tracked-changes-delete-decoration-thickness, 2px) !important;
}

.superdoc-layout .track-overlap-insert-delete-dec.track-insert-dec.track-delete-dec.highlighted.track-change-focused {
  border-left: none;
  border-right: none;
  border-top-style: solid;
  border-bottom-style: solid;
  background-color: var(--sd-tracked-changes-insert-background-focused, #399c7244);
  color: var(--sd-tracked-changes-insert-text, currentColor);
  text-decoration:
    line-through
    solid
    var(--sd-tracked-changes-delete-text, #cb0e47)
    var(--sd-tracked-changes-delete-decoration-thickness, 2px) !important;
}

.superdoc-layout .track-format-dec.highlighted.track-change-focused {
  background-color: var(--sd-tracked-changes-format-background-focused, #ffd70033);
}

/*
 * Structural row-level tracked changes (inserted/deleted whole rows).
 *
 * The painter renders a row as absolutely-positioned cell <div>s (no <tr>), so
 * each cell of a tracked row carries the same base class (track-insert-dec /
 * track-delete-dec) + modifier (highlighted / hidden) as inline runs, plus the
 * block-context marker class track-row-cell-dec. These rules reuse the same
 * --sd-tracked-changes-insert-* / --sd-tracked-changes-delete-* CSS variables so
 * the per-author color flows through identically to the inline path.
 *
 * 'hidden' mode collapses the cell (and therefore the row) via the existing
 * .track-insert-dec.hidden / .track-delete-dec.hidden { display: none } rule
 * above: an inserted row in 'original' mode and a deleted row in 'final' mode
 * disappear, matching inline behavior.
 */
.superdoc-layout .track-row-cell-dec.track-insert-dec.highlighted {
  background-color: var(--sd-tracked-changes-insert-background, #399c7222);
  border-top: var(--sd-tracked-changes-insert-border-width, 2px) solid
    var(--sd-tracked-changes-insert-border, #00853d);
  border-bottom: var(--sd-tracked-changes-insert-border-width, 2px) solid
    var(--sd-tracked-changes-insert-border, #00853d);
}

.superdoc-layout .track-row-cell-dec.track-delete-dec.highlighted {
  background-color: var(--sd-tracked-changes-delete-background, #cb0e4722);
  border-top: var(--sd-tracked-changes-delete-border-width, 2px) solid
    var(--sd-tracked-changes-delete-border, #cb0e47);
  border-bottom: var(--sd-tracked-changes-delete-border-width, 2px) solid
    var(--sd-tracked-changes-delete-border, #cb0e47);
}

.superdoc-layout .track-row-cell-dec.track-delete-dec.highlighted .superdoc-line {
  text-decoration:
    line-through
    solid
    var(--sd-tracked-changes-delete-text, #cb0e47)
    var(--sd-tracked-changes-delete-decoration-thickness, 2px);
}
`;

const FORMATTING_MARKS_STYLES = `
.superdoc-formatting-space-mark,
.superdoc-marker-suffix-space {
  position: relative;
}

.superdoc-formatting-space-mark {
  white-space: pre;
}

.superdoc-layout.superdoc-show-formatting-marks .superdoc-tab {
  position: relative;
  visibility: visible !important;
}

.superdoc-layout.superdoc-show-formatting-marks .superdoc-tab::after {
  content: "→";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: var(--sd-formatting-mark-color, var(--sd-ui-action, currentColor));
  font-size: 0.75em;
  line-height: 1;
  pointer-events: none;
}

.superdoc-layout.superdoc-show-formatting-marks [dir="rtl"] .superdoc-tab::after {
  content: "←";
}

.superdoc-layout.superdoc-show-formatting-marks .superdoc-formatting-space-mark::after,
.superdoc-layout.superdoc-show-formatting-marks .superdoc-marker-suffix-space::after {
  content: "·";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: var(--sd-formatting-mark-color, var(--sd-ui-action, currentColor));
  font-size: 0.75em;
  line-height: 1;
  pointer-events: none;
}

.superdoc-formatting-paragraph-mark {
  display: none;
  position: absolute;
  top: 0;
  transform: translateX(var(--sd-formatting-paragraph-mark-gap, 0.2em));
  color: var(--sd-formatting-mark-color, var(--sd-ui-action, currentColor));
  pointer-events: none;
  user-select: none;
  white-space: pre;
  z-index: 2;
}

.superdoc-layout.superdoc-show-formatting-marks .superdoc-formatting-paragraph-mark {
  display: inline;
}

.superdoc-layout.superdoc-show-formatting-marks [dir="rtl"] .superdoc-formatting-paragraph-mark {
  transform: translateX(calc(-100% - var(--sd-formatting-paragraph-mark-gap, 0.2em)));
}

@media print {
  .superdoc-layout.superdoc-show-formatting-marks .superdoc-tab::after,
  .superdoc-layout.superdoc-show-formatting-marks .superdoc-formatting-space-mark::after,
  .superdoc-layout.superdoc-show-formatting-marks .superdoc-marker-suffix-space::after {
    content: "";
    display: none;
  }

  .superdoc-layout.superdoc-show-formatting-marks .superdoc-formatting-paragraph-mark {
    display: none;
  }
}
`;

/**
 * SDT Container Styles - Styling for document sections and structured content containers.
 *
 * These CSS rules provide visual styling for Structured Document Tag (SDT) containers,
 * matching the appearance in super-editor. SDTs are Word/OOXML content controls that
 * wrap regions of the document to provide semantic structure and metadata.
 *
 * **Supported SDT Types:**
 * - Document Section (.superdoc-document-section): Gray bordered regions with hover tooltip
 * - Structured Content Block (.superdoc-structured-content-block): Blue bordered regions with label
 * - Structured Content Inline (.superdoc-structured-content-inline): Inline blue border with tooltip
 *
 * **Container Continuation:**
 * When an SDT spans multiple page fragments, visual continuity is maintained via data attributes:
 * - [data-sdt-container-start="true"]: First fragment gets top borders/radius
 * - [data-sdt-container-end="true"]: Last fragment gets bottom borders/radius
 * - Middle fragments: No top border, no border radius (seamless continuation)
 *
 * **Accessibility:**
 * - Labels/tooltips are pointer-events: none to avoid interfering with selection
 * - Print mode hides all visual SDT styling (borders, backgrounds, labels)
 *
 * **Implementation Note:**
 * These styles are injected once per document via ensureSdtContainerStyles() to avoid
 * duplication. The DOM painter applies corresponding classes via applySdtContainerChrome().
 */
const SDT_CONTAINER_STYLES = `
/* Document Section - Block-level container with gray border and hover tooltip */
.superdoc-document-section {
  background-color: #fafafa;
  border: 1px solid #ababab;
  border-radius: 4px;
  position: relative;
  box-sizing: border-box;
}

/* Document section tooltip - positioned above the fragment */
.superdoc-document-section__tooltip {
  position: absolute;
  top: -19px;
  left: -1px;
  max-width: 100px;
  min-width: 0;
  height: 18px;
  border: 1px solid #ababab;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  padding: 0 8px;
  align-items: center;
  font-size: 10px;
  display: none;
  z-index: 100;
  background-color: #fafafa;
  pointer-events: none;
}

.superdoc-document-section__tooltip span {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Show tooltip on hover - adjust border radius to connect with tooltip tab */
.superdoc-document-section:hover {
  border-radius: 0 4px 4px 4px;
}

.superdoc-document-section:hover .superdoc-document-section__tooltip {
  display: flex;
  align-items: center;
}

/* Continuation styling: SDT container boundary handling for multi-fragment document sections */
/* Single fragment (both start and end): full border radius */
.superdoc-document-section[data-sdt-container-start="true"][data-sdt-container-end="true"] {
  border-radius: 4px;
}

/* First fragment of a multi-fragment SDT: top corners, no bottom border */
.superdoc-document-section[data-sdt-container-start="true"]:not([data-sdt-container-end="true"]) {
  border-radius: 4px 4px 0 0;
  border-bottom: none;
}

/* Last fragment of a multi-fragment SDT: bottom corners, no top border */
.superdoc-document-section[data-sdt-container-end="true"]:not([data-sdt-container-start="true"]) {
  border-radius: 0 0 4px 4px;
  border-top: none;
}

.superdoc-document-section[data-sdt-container-start="true"]:hover {
  border-radius: 0 4px 0 0;
}

/* Middle fragments (neither start nor end): no corners, no top/bottom borders */
.superdoc-document-section:not([data-sdt-container-start="true"]):not([data-sdt-container-end="true"]) {
  border-radius: 0;
  border-top: none;
  border-bottom: none;
}

/* Structured Content Block - Blue border container */
.superdoc-structured-content-block {
  box-sizing: border-box;
  border-radius: 4px;
  background-color: transparent;
  position: relative;
  z-index: 0;
  --sd-sdt-chrome-left: 0px;
  --sd-sdt-chrome-width: 100%;
  --sd-sdt-chrome-bottom-extension: 0px;
}

.superdoc-structured-content-block::before {
  content: '';
  position: absolute;
  left: var(--sd-sdt-chrome-left, 0px);
  top: 0;
  bottom: calc(0px - var(--sd-sdt-chrome-bottom-extension, 0px));
  width: var(--sd-sdt-chrome-width, 100%);
  border-radius: inherit;
  background-color: var(--sd-content-controls-block-bg, transparent);
  box-sizing: border-box;
  z-index: -1;
  pointer-events: none;
}

.superdoc-structured-content-block::after {
  content: '';
  position: absolute;
  left: var(--sd-sdt-chrome-left, 0px);
  top: 0;
  bottom: calc(0px - var(--sd-sdt-chrome-bottom-extension, 0px));
  width: var(--sd-sdt-chrome-width, 100%);
  border: 1px solid transparent;
  border-radius: inherit;
  box-sizing: border-box;
  z-index: 1;
  pointer-events: none;
}

.superdoc-structured-content-block:not(.ProseMirror-selectednode):hover::before {
  background-color: var(--sd-content-controls-block-hover-bg, #f2f2f2);
}

.superdoc-structured-content-block:not(.ProseMirror-selectednode):hover::after {
  border-color: var(--sd-content-controls-block-hover-border, transparent);
}

/* Group hover (JavaScript-coordinated via PresentationEditor) */
.superdoc-structured-content-block.sdt-group-hover:not(.ProseMirror-selectednode)::before {
  background-color: var(--sd-content-controls-block-hover-bg, #f2f2f2);
}

.superdoc-structured-content-block.sdt-group-hover:not(.ProseMirror-selectednode)::after {
  border-color: var(--sd-content-controls-block-hover-border, transparent);
}

.superdoc-structured-content-block.ProseMirror-selectednode {
  outline: none;
}

.superdoc-structured-content-block.ProseMirror-selectednode::after {
  border-color: var(--sd-content-controls-block-border, #629be7);
}

.superdoc-structured-content-block.sdt-container-selected::after {
  border-color: var(--sd-content-controls-block-border, #629be7);
}

.superdoc-structured-content-block.sdt-ancestor-selected::after {
  border-color: var(--sd-content-controls-block-border, #629be7);
}

/* Structured content labels - shared box model; positioning differs by scope. */
.superdoc-structured-content__label,
.superdoc-structured-content-inline__label {
  font-size: 11px;
  align-items: center;
  justify-content: center;
  height: 18px;
  padding: 0 4px;
  border: 1px solid var(--sd-content-controls-label-border, #629be7);
  background-color: var(--sd-content-controls-label-bg, #629be7ee);
  color: var(--sd-content-controls-label-text, #ffffff);
  box-sizing: border-box;
  display: none;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
}

.superdoc-structured-content__label::before,
.superdoc-structured-content-inline__label::before {
  content: '';
  width: 2px;
  height: 8px;
  margin-right: 4px;
  background:
    radial-gradient(circle, currentColor 1px, transparent 1px) center 0 / 2px 2px no-repeat,
    radial-gradient(circle, currentColor 1px, transparent 1px) center 3px / 2px 2px no-repeat,
    radial-gradient(circle, currentColor 1px, transparent 1px) center 6px / 2px 2px no-repeat;
  flex: 0 0 auto;
}

/* Structured content drag handle/label - positioned above */
.superdoc-structured-content__label {
  position: absolute;
  left: calc(var(--sd-sdt-chrome-left, 0px) + 2px);
  top: -18px;
  width: max-content;
  max-width: 130px;
  min-width: 0;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  white-space: nowrap;
  z-index: 10;
}

.superdoc-structured-content__label span {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.superdoc-structured-content-block.ProseMirror-selectednode .superdoc-structured-content__label {
  display: inline-flex;
}

.superdoc-structured-content-block.sdt-ancestor-selected .superdoc-structured-content__label {
  display: inline-flex;
}

/* Continuation styling for structured content blocks */
/* Single fragment (both start and end): full border radius */
.superdoc-structured-content-block[data-sdt-container-start="true"][data-sdt-container-end="true"] {
  border-radius: 4px;
}

/* First fragment of a multi-fragment SDT: top corners, no bottom border */
.superdoc-structured-content-block[data-sdt-container-start="true"]:not([data-sdt-container-end="true"]) {
  border-radius: 4px 4px 0 0;
}

.superdoc-structured-content-block[data-sdt-container-start="true"]:not([data-sdt-container-end="true"])::after {
  border-bottom: none;
}

/* Last fragment of a multi-fragment SDT: bottom corners, no top border */
.superdoc-structured-content-block[data-sdt-container-end="true"]:not([data-sdt-container-start="true"]) {
  border-radius: 0 0 4px 4px;
}

.superdoc-structured-content-block[data-sdt-container-end="true"]:not([data-sdt-container-start="true"])::after {
  border-top: none;
}

/* Middle fragment (neither start nor end): no corners, no top/bottom borders */
.superdoc-structured-content-block:not([data-sdt-container-start="true"]):not([data-sdt-container-end="true"]) {
  border-radius: 0;
}

.superdoc-structured-content-block:not([data-sdt-container-start="true"]):not([data-sdt-container-end="true"])::after {
  border-top: none;
  border-bottom: none;
}

.superdoc-structured-content-block[data-sdt-own-container-nested="true"][data-sdt-own-container-start="true"]:not(.ProseMirror-selectednode)::after {
  border-top: none;
}

.superdoc-structured-content-block[data-sdt-next-own-container-starts-nested="true"]::after {
  border-bottom: none;
}

.superdoc-structured-content-block.sdt-ancestor-selected[data-sdt-next-own-container-starts-nested="true"]::after {
  border-bottom: 1px solid var(--sd-content-controls-block-border, #629be7);
}

.superdoc-structured-content-block.sdt-container-selected:not(.ProseMirror-selectednode):not(.sdt-ancestor-selected)::after {
  border-top: none;
}

.superdoc-structured-content-block.ProseMirror-selectednode[data-sdt-container-start="false"]::after {
  border-top: none;
}

.superdoc-structured-content-block.ProseMirror-selectednode[data-sdt-own-container-nested="true"][data-sdt-own-container-end="true"]::after {
  border-bottom: 1px solid var(--sd-content-controls-block-border, #629be7);
}

/* Structured Content Inline - Inline wrapper with blue border */
.superdoc-structured-content-inline {
  padding: 1px;
  box-sizing: border-box;
  border-radius: 4px;
  border: 1px solid transparent;
  background-color: var(--sd-content-controls-inline-bg, transparent);
  position: relative;
  display: inline;
  font-size: initial;
  line-height: normal;
  z-index: 10;
}

.superdoc-structured-content-inline[data-contains-inline-image='true']:not([data-appearance='hidden']) {
  display: inline-block;
  vertical-align: top;
}

/* Hover effect for inline structured content */
.superdoc-structured-content-inline:not(.ProseMirror-selectednode):hover {
  background-color: var(--sd-content-controls-inline-hover-bg, #f2f2f2);
  border-color: var(--sd-content-controls-inline-hover-border, transparent);
}

.superdoc-structured-content-inline.ProseMirror-selectednode {
  border-color: var(--sd-content-controls-inline-border, #629be7);
  outline: none;
  background-color: transparent;
}

.superdoc-structured-content-inline[data-empty='true']:not([data-appearance='hidden']) {
  border-color: var(--sd-content-controls-inline-border, #629be7);
}

.superdoc-empty-sdt-placeholder {
  display: inline-block;
  line-height: normal;
  vertical-align: baseline;
  white-space: nowrap;
}

.superdoc-empty-sdt-placeholder::before {
  content: attr(data-placeholder-text);
  color: var(--sd-content-controls-placeholder-text, #a6a6a6);
}

.superdoc-structured-content-inline.ProseMirror-selectednode .superdoc-empty-sdt-placeholder::before,
.superdoc-structured-content-block.ProseMirror-selectednode .superdoc-empty-sdt-placeholder::before {
  background-color: var(--sd-content-controls-placeholder-selected-bg, Highlight);
}

.superdoc-structured-content-inline[data-appearance='hidden'] .superdoc-empty-inline-sdt-placeholder,
.superdoc-structured-content-block[data-appearance='hidden'] .superdoc-empty-block-sdt-placeholder,
.superdoc-empty-sdt-placeholder[data-appearance='hidden'] {
  width: 0;
  min-width: 0;
  overflow: hidden;
}

.superdoc-structured-content-inline[data-appearance='hidden'] .superdoc-empty-inline-sdt-placeholder::before,
.superdoc-structured-content-block[data-appearance='hidden'] .superdoc-empty-block-sdt-placeholder::before,
.superdoc-empty-sdt-placeholder[data-appearance='hidden']::before {
  content: '';
}

/* Inline structured content label - shown when active */
.superdoc-structured-content-inline__label {
  position: absolute;
  bottom: calc(100% + 1px);
  inset-inline-start: 2px;
  transform: none;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
  z-index: 100;
}

.superdoc-structured-content-inline.ProseMirror-selectednode .superdoc-structured-content-inline__label {
  display: inline-flex;
}

.superdoc-structured-content-inline:not(.ProseMirror-selectednode):hover .superdoc-structured-content-inline__label {
  display: none;
}

/* Hidden appearance per ECMA-376 (w15:appearance val="hidden"). SDT
 * exists in the document for anchoring but is visually transparent: no
 * padding, no border, no hover background, no selected outline. The
 * alias label is not emitted into the DOM at all (see renderer.ts), so
 * there is nothing to hide from copy-paste or screen readers. */
.superdoc-structured-content-inline[data-appearance='hidden'] {
  padding: 0;
  border: none;
  border-radius: 0;
  background-color: transparent;
}
.superdoc-structured-content-inline[data-appearance='hidden']:hover {
  background-color: transparent;
  border: none;
}
.superdoc-structured-content-inline[data-appearance='hidden'].ProseMirror-selectednode {
  border-color: transparent;
  background-color: transparent;
}

/* Global content-control chrome opt-out: preserve SDT wrappers/datasets while
 * suppressing built-in visual chrome on structured-content controls. Their
 * label elements are not emitted by renderer/helpers when this class is
 * present (DOM non-emission). documentSection chrome (e.g. the locked-section
 * tooltip) is intentionally preserved and not in scope.
 *
 * Custom styling surface (SD-3322): instead of fully erasing the look, these
 * rules read --sd-content-controls-custom-* variables whose defaults reproduce
 * the empty look (0-width transparent border, no background, no radius/padding).
 * So chrome:'none' stays visually empty by default, but a consumer can paint
 * their own field/clause look by setting those variables on the painted wrapper
 * (target it via data-sdt-* attributes) - no !important, and no need to fight
 * the .ProseMirror-selectednode / .sdt-group-hover state classes, because the
 * painter reads the variables across rest, hover, and selected. The border is a
 * full shorthand (e.g. "1px solid #1355ff"); its default "0 solid transparent"
 * is identical in layout to no border. It's re-asserted in every state so the
 * box never shifts (no jitter); only the background changes on hover/selected.
 * Block controls add a -border-left override for an accent rail. */
.superdoc-cc-chrome-none .superdoc-structured-content-inline {
  padding: var(--sd-content-controls-custom-inline-padding, 0);
  border: var(--sd-content-controls-custom-inline-border, 0 solid transparent);
  border-radius: var(--sd-content-controls-custom-inline-radius, 0);
  background: var(--sd-content-controls-custom-inline-bg, none);
}
.superdoc-cc-chrome-none .superdoc-structured-content-block {
  padding: var(--sd-content-controls-custom-block-padding, 0);
  border: var(--sd-content-controls-custom-block-border, 0 solid transparent);
  border-left: var(--sd-content-controls-custom-block-border-left, var(--sd-content-controls-custom-block-border, 0 solid transparent));
  border-radius: var(--sd-content-controls-custom-block-radius, 0);
  background: var(--sd-content-controls-custom-block-bg, none);
}

.superdoc-cc-chrome-none .superdoc-structured-content-inline:hover,
.superdoc-cc-chrome-none .superdoc-structured-content-inline[data-lock-mode]:hover {
  border: var(--sd-content-controls-custom-inline-border, 0 solid transparent);
  background: var(--sd-content-controls-custom-inline-hover-bg, var(--sd-content-controls-custom-inline-bg, none));
}
.superdoc-cc-chrome-none .superdoc-structured-content-block:hover,
.superdoc-cc-chrome-none .superdoc-structured-content-block.sdt-group-hover,
.superdoc-cc-chrome-none .superdoc-structured-content-block[data-lock-mode].sdt-group-hover {
  border: var(--sd-content-controls-custom-block-border, 0 solid transparent);
  border-left: var(--sd-content-controls-custom-block-border-left, var(--sd-content-controls-custom-block-border, 0 solid transparent));
  background: var(--sd-content-controls-custom-block-hover-bg, var(--sd-content-controls-custom-block-bg, none));
}

.superdoc-cc-chrome-none .superdoc-structured-content-inline.ProseMirror-selectednode {
  border: var(--sd-content-controls-custom-inline-border, 0 solid transparent);
  background: var(--sd-content-controls-custom-inline-selected-bg, var(--sd-content-controls-custom-inline-hover-bg, var(--sd-content-controls-custom-inline-bg, none)));
}
.superdoc-cc-chrome-none .superdoc-structured-content-block.ProseMirror-selectednode {
  border: var(--sd-content-controls-custom-block-border, 0 solid transparent);
  border-left: var(--sd-content-controls-custom-block-border-left, var(--sd-content-controls-custom-block-border, 0 solid transparent));
  background: var(--sd-content-controls-custom-block-selected-bg, var(--sd-content-controls-custom-block-hover-bg, var(--sd-content-controls-custom-block-bg, none)));
}

/* Hover highlight for SDT containers.
 * Hover adds background highlight and z-index boost.
 * Block SDTs use .sdt-group-hover class (event delegation for multi-fragment coordination).
 * Inline SDTs use :hover (single element, no coordination needed).
 * Hover is suppressed when the node is selected (SD-1584).
 *
 * Inline SDTs with appearance=hidden are excluded via the same :not()
 * that handles selection. Both predicates live in one :not(a, b) so the
 * selector keeps (0,4,0) specificity. A second chained :not() would push
 * it to (0,5,0) and beat the viewing-mode suppression rule below, which
 * also sits at (0,4,0). */
.superdoc-structured-content-block[data-lock-mode].sdt-group-hover:not(.ProseMirror-selectednode),
.superdoc-structured-content-inline[data-lock-mode]:hover:not(.ProseMirror-selectednode, [data-appearance='hidden']) {
  background-color: var(--sd-content-controls-lock-hover-bg, rgba(98, 155, 231, 0.08));
  z-index: 9999999;
}

.superdoc-structured-content-block[data-lock-mode].sdt-group-hover:not(.ProseMirror-selectednode) {
  background-color: transparent;
}

.superdoc-structured-content-block[data-lock-mode].sdt-group-hover:not(.ProseMirror-selectednode)::before {
  background-color: var(--sd-content-controls-lock-hover-bg, rgba(98, 155, 231, 0.08));
}

/* Chrome opt-out for block SDTs. Main paints block chrome through ::before
 * (background) and ::after (border) pseudo-elements, which the element-level
 * .superdoc-cc-chrome-none rules above cannot reach. Suppress the pseudo
 * chrome directly, including the selected-node border and the lock-hover
 * ::before background. Declared after every chrome-showing pseudo rule so
 * source order resolves equal-specificity ties, the same way the
 * viewing-mode rules below do. */
.superdoc-cc-chrome-none .superdoc-structured-content-block::before,
.superdoc-cc-chrome-none .superdoc-structured-content-block:hover::before,
.superdoc-cc-chrome-none .superdoc-structured-content-block.sdt-group-hover::before,
.superdoc-cc-chrome-none .superdoc-structured-content-block[data-lock-mode].sdt-group-hover::before {
  background: none;
}

.superdoc-cc-chrome-none .superdoc-structured-content-block::after,
.superdoc-cc-chrome-none .superdoc-structured-content-block:hover::after,
.superdoc-cc-chrome-none .superdoc-structured-content-block.sdt-group-hover::after,
.superdoc-cc-chrome-none .superdoc-structured-content-block.ProseMirror-selectednode::after,
.superdoc-cc-chrome-none .superdoc-structured-content-block.sdt-container-selected::after,
.superdoc-cc-chrome-none .superdoc-structured-content-block.sdt-ancestor-selected::after {
  border: none;
}

/* Chrome opt-out for the lock-hover affordance. The base lock-hover rules above
 * paint a built-in tint and boost z-index on hovered locked controls; under
 * chrome:'none' that would override the custom hover background and stack above
 * host-attached UI. Re-assert the custom hover background (so a locked control
 * follows --sd-content-controls-custom-*-hover-bg, defaulting to empty - no tint
 * leaks) and reset the z-index. Mirrors the base lock-hover selectors with the
 * chrome-none prefix, so the extra class wins over the base rules. Split inline
 * vs block because each reads its own hover variable. */
.superdoc-cc-chrome-none .superdoc-structured-content-inline[data-lock-mode]:hover:not(.ProseMirror-selectednode, [data-appearance='hidden']) {
  background: var(--sd-content-controls-custom-inline-hover-bg, var(--sd-content-controls-custom-inline-bg, none));
  z-index: auto;
}
.superdoc-cc-chrome-none .superdoc-structured-content-block[data-lock-mode].sdt-group-hover:not(.ProseMirror-selectednode) {
  background: var(--sd-content-controls-custom-block-hover-bg, var(--sd-content-controls-custom-block-bg, none));
  z-index: auto;
}

/* Viewing mode: remove structured content affordances */
.presentation-editor--viewing .superdoc-structured-content-block,
.presentation-editor--viewing .superdoc-structured-content-inline {
  background: none;
  border: none;
  padding: 0;
}

.presentation-editor--viewing .superdoc-structured-content-block:hover {
  background: none;
  border: none;
}

.presentation-editor--viewing .superdoc-structured-content-block::after,
.presentation-editor--viewing .superdoc-structured-content-block:hover::after,
.presentation-editor--viewing .superdoc-structured-content-block.sdt-group-hover::after,
.presentation-editor--viewing .superdoc-structured-content-block[data-lock-mode].sdt-group-hover::after {
  border: none;
}

.presentation-editor--viewing .superdoc-structured-content-block::before,
.presentation-editor--viewing .superdoc-structured-content-block:hover::before,
.presentation-editor--viewing .superdoc-structured-content-block.sdt-group-hover::before,
.presentation-editor--viewing .superdoc-structured-content-block[data-lock-mode].sdt-group-hover::before {
  background: none;
}

.presentation-editor--viewing .superdoc-structured-content-block.sdt-group-hover,
.presentation-editor--viewing .superdoc-structured-content-block[data-lock-mode].sdt-group-hover {
  background: none;
  border: none;
}

.presentation-editor--viewing .superdoc-structured-content-inline:hover {
  background: none;
  border: none;
}

.presentation-editor--viewing .superdoc-structured-content-inline[data-lock-mode]:hover {
  background: none;
  border: none;
}

.presentation-editor--viewing .superdoc-structured-content__label,
.presentation-editor--viewing .superdoc-structured-content-inline__label {
  display: none !important;
}

/* Print mode: hide visual styling for SDT containers */
@media print {
  .superdoc-document-section,
  .superdoc-structured-content-block,
  .superdoc-structured-content-inline {
    background: none;
    border: none;
    padding: 0;
  }

  .superdoc-structured-content-block::after {
    border: none;
  }

  .superdoc-structured-content-block::before {
    background: none;
  }

  .superdoc-document-section__tooltip,
  .superdoc-structured-content__label,
  .superdoc-structured-content-inline__label {
    display: none !important;
  }
}
`;

const FIELD_ANNOTATION_STYLES = `
/* Field annotation visual styles — suppress native selection artifacts.
 * Annotations are atomic inline nodes; native selection and caret look broken. */
.superdoc-layout .annotation::selection,
.superdoc-layout .annotation *::selection {
  background: transparent;
}

.superdoc-layout .annotation::-moz-selection,
.superdoc-layout .annotation *::-moz-selection  {
  background: transparent;
}

.superdoc-layout .annotation,
.superdoc-layout .annotation * {
  caret-color: transparent;
}
`;

const IMAGE_SELECTION_STYLES = `
/* Highlight for selected images (block or inline) */
.superdoc-image-selected {
  outline: 2px solid #4a90e2;
  outline-offset: 2px;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(74, 144, 226, 0.35);
}

/* Ensure inline images can be targeted */
.${DOM_CLASS_NAMES.INLINE_IMAGE}.superdoc-image-selected {
  outline-offset: 2px;
}

/* Selection on clip wrapper so outline matches the visible cropped portion, not the scaled image */
.${DOM_CLASS_NAMES.INLINE_IMAGE_CLIP_WRAPPER}.superdoc-image-selected {
  outline-offset: 2px;
}

.superdoc-textbox-selected {
  outline: 2px solid #4a90e2;
  outline-offset: 2px;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(74, 144, 226, 0.35);
}
`;

const MATH_MENCLOSE_STYLES = `
/* MathML <menclose> polyfill.
 *
 * MathML 3 defined <menclose notation="..."> with borders, strikes, and other
 * enclosure notations. MathML Core (the subset shipped in Chrome 109+, 2023)
 * dropped <menclose> — the WG moved its rendering to CSS/SVG. Firefox and
 * WebKit also do not paint it. Without this polyfill, m:borderBox content
 * imports correctly (the notation attribute is right) but renders invisibly.
 *
 * Each notation token is composable: "box horizontalstrike" draws the box
 * border and a horizontal strike together. Diagonal strikes layer through
 * CSS custom properties so X patterns (both diagonals) stack correctly.
 *
 * @spec MathML 3 §3.3.8 menclose
 */
menclose {
  display: inline-block;
  position: relative;
  padding: 0.15em 0.25em;

  --sd-menclose-stroke: currentColor;
  --sd-menclose-h: none;
  --sd-menclose-v: none;
  --sd-menclose-up: none;
  --sd-menclose-down: none;
}

menclose[notation~="box"] { border: 1px solid var(--sd-menclose-stroke); }
menclose[notation~="roundedbox"] { border: 1px solid var(--sd-menclose-stroke); border-radius: 0.3em; }
menclose[notation~="top"] { border-top: 1px solid var(--sd-menclose-stroke); }
menclose[notation~="bottom"] { border-bottom: 1px solid var(--sd-menclose-stroke); }
menclose[notation~="left"] { border-left: 1px solid var(--sd-menclose-stroke); }
menclose[notation~="right"] { border-right: 1px solid var(--sd-menclose-stroke); }

menclose[notation~="horizontalstrike"] {
  --sd-menclose-h: linear-gradient(var(--sd-menclose-stroke), var(--sd-menclose-stroke)) no-repeat center / 100% 1px;
}
menclose[notation~="verticalstrike"] {
  --sd-menclose-v: linear-gradient(var(--sd-menclose-stroke), var(--sd-menclose-stroke)) no-repeat center / 1px 100%;
}
/* Gradient direction is perpendicular to the stripe it produces.
 * "to bottom right" → stripe runs bottom-left → top-right (visually "/") = updiagonalstrike.
 * "to top right"    → stripe runs top-left → bottom-right (visually "\") = downdiagonalstrike.
 */
menclose[notation~="updiagonalstrike"] {
  --sd-menclose-up: linear-gradient(
    to bottom right,
    transparent calc(50% - 0.5px),
    var(--sd-menclose-stroke) calc(50% - 0.5px),
    var(--sd-menclose-stroke) calc(50% + 0.5px),
    transparent calc(50% + 0.5px)
  );
}
menclose[notation~="downdiagonalstrike"] {
  --sd-menclose-down: linear-gradient(
    to top right,
    transparent calc(50% - 0.5px),
    var(--sd-menclose-stroke) calc(50% - 0.5px),
    var(--sd-menclose-stroke) calc(50% + 0.5px),
    transparent calc(50% + 0.5px)
  );
}

menclose::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--sd-menclose-h), var(--sd-menclose-v), var(--sd-menclose-up), var(--sd-menclose-down);
}
`;

/**
 * SD-3400: footnote/endnote note content uses a text (I-beam) cursor like body
 * text, not the default arrow. Note fragments are painted as generic
 * `.superdoc-fragment` elements distinguished only by their block-id prefix
 * (footnote-/endnote-/__sd_semantic_footnote-/__sd_semantic_endnote-), so the
 * cursor rule keys off `data-block-id`. The renderer marks these fragments
 * contenteditable=false, so without this rule the browser shows a default arrow
 * over editable note text.
 */
const FOOTNOTE_STYLES = `
[data-block-id^="footnote-"],
[data-block-id^="endnote-"],
[data-block-id^="__sd_semantic_footnote-"],
[data-block-id^="__sd_semantic_endnote-"] {
  cursor: text;
}
/* SD-3400: body reference markers are interactive (double-click opens the
 * note). Pointer cursor + a hover pill signal clickability without affecting
 * layout (background/box-shadow are paint-only). */
[data-note-reference] {
  cursor: pointer;
  border-radius: 2px;
  position: relative;
}
/* The painted digit is ~6x11px — far too small to hover or double-click
 * reliably. An invisible pseudo-element halo expands the interactive target
 * (hover, cursor, clicks all hit the marker span) without moving any text. */
[data-note-reference]::after {
  content: '';
  position: absolute;
  inset: -4px -5px;
}
[data-note-reference]:hover {
  background-color: var(--sd-content-controls-block-hover-bg, #d3e3fd);
  box-shadow: 0 0 0 2px var(--sd-content-controls-block-hover-bg, #d3e3fd);
}

/* SD-3400: while a note session is open, highlight the note's fragments at the
 * page bottom so the focus change is visible. Applied by PresentationEditor on
 * activation, re-applied after each paint, removed on session exit. The pulse
 * draws the eye when focus jumps from the body reference to the note. */
.sd-note-session-active {
  background-color: rgba(98, 155, 231, 0.07);
  /* Thin accent bar with breathing room: the first shadow masks a 3px gap with
   * the page background, the second paints a 1px bar beyond it. Box-shadows
   * paint outside the box, so the note line itself is untouched. */
  box-shadow:
    -3px 0 0 0 var(--sd-page-bg, #ffffff),
    -4px 0 0 0 rgba(98, 155, 231, 0.55);
  animation: sd-note-activate-pulse 0.6s ease-out 1;
}
@keyframes sd-note-activate-pulse {
  0% { background-color: rgba(98, 155, 231, 0.22); }
  100% { background-color: rgba(98, 155, 231, 0.07); }
}
`;

const ensureStyleElement = (doc: Document | null | undefined, markerAttribute: string, cssText: string) => {
  if (!doc?.head) return;
  if (doc.head.querySelector(`[${markerAttribute}="true"]`)) return;
  const styleEl = doc.createElement('style');
  styleEl.setAttribute(markerAttribute, 'true');
  styleEl.textContent = cssText;
  doc.head.appendChild(styleEl);
};

export const ensurePrintStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-print-styles', PRINT_STYLES);
};

export const ensureDocumentSurfaceStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-document-surface-styles', DOCUMENT_SURFACE_STYLES);
};

export const ensureLinkStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-link-styles', LINK_AND_TOC_STYLES);
};

export const ensureTrackChangeStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-track-change-styles', TRACK_CHANGE_STYLES);
};

export const ensureFormattingMarksStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-formatting-marks-styles', FORMATTING_MARKS_STYLES);
};

export const ensureSdtContainerStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-sdt-container-styles', SDT_CONTAINER_STYLES);
};

export const ensureFieldAnnotationStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-field-annotation-styles', FIELD_ANNOTATION_STYLES);
};

/**
 * Injects image selection highlight styles into the document head.
 * Ensures styles are only injected once per document lifecycle.
 * @param {Document | null | undefined} doc - The document to inject styles into
 * @returns {void}
 */
export const ensureImageSelectionStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-image-selection-styles', IMAGE_SELECTION_STYLES);
};

/**
 * Injects the MathML <menclose> polyfill into the document head. Required
 * because no browser paints menclose natively (MathML Core dropped it). See
 * MATH_MENCLOSE_STYLES for the full rationale.
 */
export const ensureMathMencloseStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-math-menclose-styles', MATH_MENCLOSE_STYLES);
};

/**
 * Injects footnote/endnote interaction styles (text cursor over note content)
 * into the document head. Injected once per document lifecycle. (SD-3400)
 */
export const ensureFootnoteStyles = (doc: Document | null | undefined) => {
  ensureStyleElement(doc, 'data-superdoc-footnote-styles', FOOTNOTE_STYLES);
};
