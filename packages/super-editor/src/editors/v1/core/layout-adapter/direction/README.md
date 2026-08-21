# Direction Model

This module computes typed direction contexts during pm-adapter conversion.

Consumers read the resolved context from layout attrs. They do not re-derive
direction from raw OOXML attributes.

## Core Rule: Keep Direction Axes Separate

OOXML has several direction-related properties. They are not interchangeable.

- Section `w:bidi` (§17.6.1) affects section chrome: page numbers, columns,
  and gutters. It does not make paragraphs RTL.
- Paragraph `w:bidi` (§17.3.1.6) affects paragraph-level properties: indent,
  justification, tab stops, and text direction. It does not reorder text
  inside the paragraph.
- Table `w:bidiVisual` (§17.4.1) affects table visual order and table-level
  properties. It does not make cell paragraphs RTL.
- Writing mode `w:textDirection` (§17.3.1.41, §17.4.72) controls text flow.
  It can inherit across containers. A paragraph inherits its cell writing mode,
  then its section writing mode, then the `horizontal-tb` default.

The resolver chain keeps those axes separate. A paragraph direction consumer
should not infer inline direction from section RTL or table visual RTL.

## Public API

```ts
import {
  resolveSectionDirection,
  resolveTableDirection,
  resolveCellDirection,
  resolveParagraphDirection,
  resolveLogicalAlignment,
  resolveLogicalIndent,
  isRtl,
} from '@core/layout-adapter/direction';
```

Each resolver consumes its parent context and returns its own:

```ts
const sectionContext = resolveSectionDirection(sectPr);
const tableContext = resolveTableDirection(tblPr, sectionContext);
const cellContext = resolveCellDirection(tcPr, tableContext);
const paragraphContext = resolveParagraphDirection(
  resolvedParagraphProperties,
  sectionContext,
  cellContext,
);
```

The resolved `paragraphContext` carries:

- `inlineDirection: 'ltr' | 'rtl' | undefined`

  Paragraph inline base direction. It is undefined when no explicit `w:bidi`
  is set in the paragraph or its style cascade. When undefined, consumers
  render `dir="auto"` so the browser resolves base direction from the first
  strong character (UAX #9 P2/P3). Note: an *absent* `dir` would inherit the
  container's direction instead — only `dir="auto"` auto-detects. Explicit
  `rtl`/`ltr` are emitted as `dir="rtl"`/`dir="ltr"` (hard overrides).

- `writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr'`

  Text flow direction. It inherits from the cell, then the section, then the
  default.

## Reading the Context

pm-adapter writes the resolved context to `ParagraphAttrs.directionContext`.
Downstream code reads that value from attrs. It should not import pm-adapter
direction resolvers directly.

```ts
// in layout-bridge or DomPainter
const inline = block.attrs.directionContext?.inlineDirection;
const writingMode = block.attrs.directionContext?.writingMode;
```

Consumers that only need the inline-direction scalar should call
`getParagraphInlineDirection(attrs)` from `@superdoc/contracts`. The helper
prefers `directionContext.inlineDirection` and falls back to
`paragraphProperties.rightToLeft` for PM-node / editor paths.

## Logical-to-Physical Helpers

OOXML uses logical sides such as `start` and `end`. CSS uses physical sides
such as `left` and `right`.

Use the helpers instead of mapping sides inline:

```ts
import { resolveLogicalAlignment, resolveLogicalIndent } from
  '@core/layout-adapter/direction';

const physicalAlignment = resolveLogicalAlignment(
  resolvedJustification, // 'start' | 'end' | 'left' | ...
  paragraphContext,
);
const physicalIndent = resolveLogicalIndent(
  resolvedIndent, // may have .start / .end
  paragraphContext,
);
```

## Out of Scope

This module does not *infer* paragraph base direction from run content in the
layout data. Instead, paragraphs with no explicit `w:bidi` (resolved
`inlineDirection`/`rightToLeft` undefined) are rendered with `dir="auto"` — by
both the editing node view (`ParagraphNodeView`) and the viewing painter
(`inline-direction/rtl-styles`). The browser then resolves base direction from
the first strong character per UAX #9 P2/P3 and places the caret accordingly.

Note: an *absent* `dir` attribute inherits the container's base direction and
does **not** auto-detect — only `dir="auto"` does. Explicit `rightToLeft`
true/false (a user's toolbar choice or a document `w:bidi`) is a hard override
emitted as `dir="rtl"` / `dir="ltr"`.

This module also does not resolve:

- Complex-script formatting selection (`bCs`, `iCs`, `szCs`, `rFonts/@cs`).
  That belongs to `RunScriptContext`.
- Bidi controls (`w:bdo` §17.3.2.3 and `w:dir` §17.3.2.8).
- Vertical text layout. The writing-mode enum carries the data; layout support
  is separate work.

## Table Visual Mirror

`w:bidiVisual` is separate from paragraph direction. It controls how table
geometry and table-scoped sides appear visually.

For `w:bidiVisual`, upstream layers keep logical sides in LTR-default form:

- `start -> left`
- `end -> right`

DomPainter applies the visual RTL mirror once at paint time.

Do not pre-mirror these values in the importer, style-engine, or pm-adapter.
If an upstream layer chooses `left` or `right` based on table RTL, DomPainter
will mirror the value again.

The rule applies when all three are true:

1. The OOXML property is table-scoped or cell-scoped. Examples: `w:tbl`,
   `w:tblPr`, `w:tblPrEx`, `w:tr`, `w:trPr`, `w:tc`, or `w:tcPr`.
2. The property uses logical side language: `start`, `end`,
   leading/trailing, or table cell order.
3. DomPainter already applies the `w:bidiVisual` visual mirror for that
   property.

### Covered

- `w:tblBorders/start`, `w:tblBorders/end` (§17.4.38, §17.4.36/13)
- `w:tcBorders/start`, `w:tcBorders/end` (§17.4.66, §17.4.33/12)
- `w:tblCellMar/start`, `w:tblCellMar/end` (§17.4.42, §17.4.41;
  start/end children at §17.4.34/11 and §17.4.35/10)
- `w:tcMar/start`, `w:tcMar/end` (§17.4.68, §17.4.35/10)
- Table cell visual order under `w:bidiVisual` (§17.4.1)
- `w:gridBefore` and `w:gridAfter` placement (§17.4.15, §17.4.14)

### Not Covered

- Paragraph `w:bidi` (§17.3.1.6). Paragraph alignment and indent follow
  paragraph inline direction, not table direction.
- Run `w:rtl` (§17.3.2.30), `w:dir` (§17.3.2.8), and `w:bdo` (§17.3.2.3).
  These are inline bidi controls, not table visual mirroring.
- `w:textDirection` (§17.3.1.41, §17.4.72). This is writing mode, not a
  mirror.
- Numeric `w:start` values in numbering (§17.9.25) or page numbering
  (§17.6.12). These are starting values, not sides.
- Editing-side visual-to-logical mapping: table resize, cursor navigation, and
  hit testing. Those paths need RTL awareness as an inverse mapping from visual
  coordinates to logical structure.

## Why This Exists

Several older paths computed direction from raw attributes independently. They
did not always agree.

- `pm-adapter/src/attributes/paragraph.ts` used section direction as a fallback
  for paragraph direction. That violates §17.6.1.
- `layout-bridge/src/position-hit.ts` conflated writing mode with inline
  direction.
- Table border and margin paths pre-mirrored `w:bidiVisual` sides before
  DomPainter mirrored them again.

Centralizing the direction model keeps consumers on one set of rules. It also
gives future RTL work a clear place to plug in without adding another local
direction heuristic.

## Quick Checks

Use these searches before adding a new direction-aware path:

```bash
# Suspicious: upstream table-side pre-mirroring.
rg "rightToLeft.*\\?.*'(left|right)'|rightToLeft.*\\?.*\\\"(left|right)\\\"" \
  packages/super-editor/src/editors/v1/core/layout-adapter packages/super-editor/src/editors/v1/core/super-converter

# Review: downstream consumers reading raw direction fields.
rg "sectionDirection|rightToLeft" \
  packages/layout-engine/layout-bridge/src packages/layout-engine/painters/dom/src

# Suspicious: painter importing direction logic from upstream packages.
rg "@superdoc/(super-editor|style-engine)" packages/layout-engine/painters/dom/src
```

Resolver files under `super-editor/src/editors/v1/core/layout-adapter/direction/` are expected to read raw
direction fields. The checks above are for new local direction decisions
outside the resolver.
