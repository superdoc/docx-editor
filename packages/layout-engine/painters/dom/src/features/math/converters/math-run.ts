import type { OmmlJsonNode, MathObjectConverter } from '../types.js';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/** Characters that should be treated as MathML operators. */
const OPERATOR_CHARS = new Set([
  '+',
  '-',
  '=',
  '<',
  '>',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '|',
  '/',
  '\\',
  ',',
  '.',
  ';',
  ':',
  '!',
  '~',
  '^',
  '_',
  '\u00B1',
  '\u00D7',
  '\u00F7', // ±, ×, ÷
  '\u2190',
  '\u2191',
  '\u2192',
  '\u2193',
  '\u2194', // arrows
  '\u2200',
  '\u2201',
  '\u2202',
  '\u2203',
  '\u2204',
  '\u2205', // ∀, ∁, ∂, ∃, ∄, ∅
  '\u2208',
  '\u2209',
  '\u220B',
  '\u220C', // ∈, ∉, ∋, ∌
  '\u2211',
  '\u220F', // ∑, ∏
  '\u221A', // √ (radical sign — prefix operator)
  '\u2227',
  '\u2228',
  '\u2229',
  '\u222A', // ∧, ∨, ∩, ∪
  '\u222B',
  '\u222C',
  '\u222D', // ∫, ∬, ∭
  '\u2260',
  '\u2261',
  '\u2264',
  '\u2265', // ≠, ≡, ≤, ≥
  '\u2282',
  '\u2283',
  '\u2286',
  '\u2287', // ⊂, ⊃, ⊆, ⊇
]);

type MathAtomTag = 'mi' | 'mo' | 'mn';

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Length in UTF-16 code units of the code point starting at `text[i]`.
 * Handles surrogate pairs so astral-plane characters (e.g. mathematical
 * italic U+1D465) don't get split into two bogus <mi> atoms.
 */
function codePointUnitLength(text: string, i: number): number {
  const hi = text.charCodeAt(i);
  if (hi >= 0xd800 && hi <= 0xdbff && i + 1 < text.length) {
    const lo = text.charCodeAt(i + 1);
    if (lo >= 0xdc00 && lo <= 0xdfff) return 2;
  }
  return 1;
}

/**
 * Split a math run's text into MathML atoms, matching Word's OMML2MML.XSL.
 *
 * Rules (ECMA-376 §22.1.2.116 example + Annex L.6.1.13):
 * - Consecutive digits — optionally containing one decimal point between digits —
 *   group into a single `<mn>`.
 * - Each recognized operator character becomes its own `<mo>`.
 * - Every other character becomes its own `<mi>`.
 *
 * Example: `"n+1"` → `[<mi>n</mi>, <mo>+</mo>, <mn>1</mn>]`.
 */
export function tokenizeMathText(text: string): Array<{ tag: MathAtomTag; content: string }> {
  const atoms: Array<{ tag: MathAtomTag; content: string }> = [];
  let i = 0;
  while (i < text.length) {
    const step = codePointUnitLength(text, i);
    const ch = text.slice(i, i + step);
    if (step === 1 && isDigit(ch)) {
      let end = i + 1;
      let sawDot = false;
      while (end < text.length) {
        const c = text[end]!;
        if (isDigit(c)) {
          end++;
          continue;
        }
        if (c === '.' && !sawDot && end + 1 < text.length && isDigit(text[end + 1]!)) {
          sawDot = true;
          end++;
          continue;
        }
        break;
      }
      atoms.push({ tag: 'mn', content: text.slice(i, end) });
      i = end;
    } else if (step === 1 && OPERATOR_CHARS.has(ch)) {
      atoms.push({ tag: 'mo', content: ch });
      i++;
    } else {
      atoms.push({ tag: 'mi', content: ch });
      i += step;
    }
  }
  return atoms;
}

/** ECMA-376 m:sty → MathML mathvariant (§22.1.2 math run properties). */
const STY_TO_VARIANT: Record<string, string> = {
  p: 'normal',
  b: 'bold',
  i: 'italic',
  bi: 'bold-italic',
};

/** ECMA-376 m:scr → MathML mathvariant (§22.1.2 math run properties). */
const SCR_TO_VARIANT: Record<string, string> = {
  roman: 'normal',
  script: 'script',
  fraktur: 'fraktur',
  'double-struck': 'double-struck',
  'sans-serif': 'sans-serif',
  monospace: 'monospace',
};

/**
 * Resolve the effective MathML mathvariant from OMML m:rPr.
 *
 * Precedence (highest first): m:sty > m:scr > m:nor.
 * m:nor is the legacy "normal text" flag (ECMA-376 §22.1.2); it is treated as
 * equivalent to m:sty="p" when neither m:sty nor m:scr is present.
 */
function resolveMathVariant(rPr: OmmlJsonNode | undefined): string | null {
  const elements = rPr?.elements ?? [];
  const sty = elements.find((el) => el.name === 'm:sty')?.attributes?.['m:val'];
  if (sty && STY_TO_VARIANT[sty]) return STY_TO_VARIANT[sty]!;

  const scr = elements.find((el) => el.name === 'm:scr')?.attributes?.['m:val'];
  if (scr && SCR_TO_VARIANT[scr]) return SCR_TO_VARIANT[scr]!;

  if (elements.some((el) => el.name === 'm:nor')) return 'normal';

  return null;
}

type MathRunSegment = { text: string; revision?: OmmlJsonNode };

function extractTextSegments(node: OmmlJsonNode): MathRunSegment[] {
  const segments: MathRunSegment[] = [];
  const textOf = (element: OmmlJsonNode): string =>
    (element.elements ?? [])
      .filter((child) => child.type === 'text' && typeof child.text === 'string')
      .map((child) => child.text)
      .join('');
  for (const child of node.elements ?? []) {
    if (child.name === 'm:t') {
      const text = textOf(child);
      const previous = segments[segments.length - 1];
      if (previous && !previous.revision) previous.text += text;
      else if (text) segments.push({ text });
    } else if (child.name === 'w:ins' || child.name === 'w:del') {
      const text = (child.elements ?? [])
        .filter((element) => element.name === 'm:t')
        .map(textOf)
        .join('');
      if (text) segments.push({ text, revision: child });
    }
  }
  return segments;
}

function convertRunSegments(
  node: OmmlJsonNode,
  doc: Document,
  tokenize: (text: string) => Array<{ tag: MathAtomTag; content: string }>,
): Node | null {
  const rPr = (node.elements ?? []).find((element) => element.name === 'm:rPr');
  const variant = resolveMathVariant(rPr);
  const fragment = doc.createDocumentFragment();
  for (const segment of extractTextSegments(node)) {
    let parent: Node = fragment;
    if (segment.revision) {
      const wrapper = doc.createElementNS(MATHML_NS, 'mrow');
      const kind = segment.revision.name === 'w:ins' ? 'insert' : 'delete';
      wrapper.setAttribute('class', `track-${kind}-dec highlighted`);
      wrapper.setAttribute('data-track-change-kind', kind);
      for (const attribute of ['id', 'author', 'date']) {
        const value = segment.revision.attributes?.[`w:${attribute}`];
        if (value) wrapper.setAttribute(`data-track-change-${attribute}`, value);
      }
      fragment.appendChild(wrapper);
      parent = wrapper;
    }
    for (const atom of tokenize(segment.text)) {
      const element = doc.createElementNS(MATHML_NS, atom.tag);
      element.textContent = atom.content;
      if (variant) element.setAttribute('mathvariant', variant);
      parent.appendChild(element);
    }
  }
  if (!fragment.firstChild) return null;
  return fragment.childNodes.length === 1 ? fragment.firstChild : fragment;
}

/**
 * Convert an m:r (math run) element to MathML atoms.
 *
 * m:r contains:
 * - m:rPr (math run properties: script, style, normal text flag)
 * - m:t (text content)
 * - Optionally w:rPr (WordprocessingML run properties for formatting)
 *
 * The run's text is split per-character into `<mi>` / `<mo>` / `<mn>` atoms
 * per Word's OMML2MML.XSL. For a single-atom run (common case — a one-letter
 * variable, single operator, or an all-digit number) the converter returns a
 * single Element. For a multi-atom run (e.g. "→∞", "x+1") it returns a
 * DocumentFragment whose children become siblings of the parent mrow.
 *
 * @spec ECMA-376 §22.1.2.116 (t) — example shows multi-char mixed runs as the
 *   normal authored shape; §22.1.2.58 (lit) implies operators are classified
 *   per-character by default.
 */
export const convertMathRun: MathObjectConverter = (node, doc) => convertRunSegments(node, doc, tokenizeMathText);

/**
 * Tokenize a math run's text for the m:fName context: consecutive non-digit,
 * non-operator characters stay grouped in one `<mi>` (so "log" in "log_2"
 * remains a single identifier), while digits still group into `<mn>` and
 * each operator character is its own `<mo>`.
 *
 * Matches Word's OMML2MML.XSL run-internal classification for m:fName
 * content: `log_2` → `<mi>log</mi><mo>_</mo><mn>2</mn>`.
 */
function tokenizeFunctionNameText(text: string): Array<{ tag: MathAtomTag; content: string }> {
  const atoms: Array<{ tag: MathAtomTag; content: string }> = [];
  let i = 0;
  while (i < text.length) {
    const step = codePointUnitLength(text, i);
    const ch = text.slice(i, i + step);
    if (step === 1 && isDigit(ch)) {
      let end = i + 1;
      let sawDot = false;
      while (end < text.length) {
        const c = text[end]!;
        if (isDigit(c)) {
          end++;
          continue;
        }
        if (c === '.' && !sawDot && end + 1 < text.length && isDigit(text[end + 1]!)) {
          sawDot = true;
          end++;
          continue;
        }
        break;
      }
      atoms.push({ tag: 'mn', content: text.slice(i, end) });
      i = end;
    } else if (step === 1 && OPERATOR_CHARS.has(ch)) {
      atoms.push({ tag: 'mo', content: ch });
      i++;
    } else {
      // Group consecutive non-digit, non-operator code points into one <mi>.
      let end = i + step;
      while (end < text.length) {
        const s = codePointUnitLength(text, end);
        const c = text.slice(end, end + s);
        if (s === 1 && (isDigit(c) || OPERATOR_CHARS.has(c))) break;
        end += s;
      }
      atoms.push({ tag: 'mi', content: text.slice(i, end) });
      i = end;
    }
  }
  return atoms;
}

/**
 * Convert an m:r inside m:fName (m:func's function-name slot). Word's
 * OMML2MML.XSL keeps each letter-sequence whole while still splitting out
 * digits and operators — so `sin` stays `<mi>sin</mi>`, but `log_2` becomes
 * `<mi>log</mi><mo>_</mo><mn>2</mn>`.
 *
 * Returns a single Element for single-atom runs or a DocumentFragment when
 * the run emits multiple atoms. Returns null for empty text.
 */
export function convertMathRunAsFunctionName(node: OmmlJsonNode, doc: Document): Node | null {
  return convertRunSegments(node, doc, tokenizeFunctionNameText);
}
