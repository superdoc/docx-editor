import { describe, it, expect } from 'vite-plus/test';
// Fresh isolated documents from the happy-dom test environment (see
// vitest.config.mjs) - the painter package deliberately has no jsdom
// dependency, so a direct `import "jsdom"` fails vite's transform here
// (persistent-page rendering preflight plan, workstream 8).
const createTestDocument = (): Document => document.implementation.createHTMLDocument('painter-test');

import { convertOmmlToMathml, MATHML_NS } from './omml-to-mathml.js';
import { tokenizeMathText } from './converters/math-run.js';

const doc = createTestDocument();

describe('convertOmmlToMathml', () => {
  it('returns null for null/undefined input', () => {
    expect(convertOmmlToMathml(null, doc)).toBeNull();
    expect(convertOmmlToMathml(undefined, doc)).toBeNull();
  });

  it('returns null for empty object', () => {
    expect(convertOmmlToMathml({}, doc)).toBeNull();
  });

  it('converts a simple m:oMath with text run to <math>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:r',
          elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.namespaceURI).toBe(MATHML_NS);
    expect(result!.localName).toBe('math');
    expect(result!.getAttribute('displaystyle')).toBeNull();
    expect(result!.getAttribute('display')).toBeNull();

    // Should contain an <mi> for the identifier 'x'
    const mi = result!.querySelector('mi');
    expect(mi).not.toBeNull();
    expect(mi!.textContent).toBe('x');
  });

  it('classifies numbers as <mn>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:r',
          elements: [{ name: 'm:t', elements: [{ type: 'text', text: '42' }] }],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    const mn = result!.querySelector('mn');
    expect(mn).not.toBeNull();
    expect(mn!.textContent).toBe('42');
  });

  it('classifies operators as <mo>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:r',
          elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    const mo = result!.querySelector('mo');
    expect(mo).not.toBeNull();
    expect(mo!.textContent).toBe('+');
  });

  it('handles m:oMathPara by iterating child m:oMath elements', () => {
    const omml = {
      name: 'm:oMathPara',
      elements: [
        {
          name: 'm:oMathParaPr',
          elements: [{ name: 'm:jc', attributes: { 'm:val': 'center' } }],
        },
        {
          name: 'm:oMath',
          elements: [
            {
              name: 'm:r',
              elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.localName).toBe('math');
    expect(result!.getAttribute('displaystyle')).toBe('true');
    expect(result!.getAttribute('display')).toBe('block');
    // The m:oMathParaPr should be skipped (it ends with 'Pr')
    // The m:oMath child should produce content
    expect(result!.textContent).toBe('y');
  });

  it('skips property elements (names ending in Pr)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        { name: 'm:rPr', elements: [{ name: 'm:sty', attributes: { 'm:val': 'bi' } }] },
        {
          name: 'm:r',
          elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'z' }] }],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result!.textContent).toBe('z');
  });

  it('converts m:f (fraction) to <mfrac> with numerator and denominator', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:f',
          elements: [
            { name: 'm:fPr', elements: [] },
            {
              name: 'm:num',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
            {
              name: 'm:den',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    // Should produce a <mfrac> with numerator and denominator
    const mfrac = result!.querySelector('mfrac');
    expect(mfrac).not.toBeNull();
    expect(mfrac!.children.length).toBe(2);
    expect(mfrac!.children[0]!.textContent).toBe('a');
    expect(mfrac!.children[1]!.textContent).toBe('b');
  });

  it('wraps multi-part fraction operands in <mrow> for valid arity', () => {
    // (a+b)/(c+d) — both numerator and denominator have multiple runs
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:f',
          elements: [
            {
              name: 'm:num',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] },
              ],
            },
            {
              name: 'm:den',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'c' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'd' }] }] },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mfrac = result!.querySelector('mfrac');
    expect(mfrac).not.toBeNull();
    // <mfrac> must have exactly 2 children (num + den), each wrapped in <mrow>
    expect(mfrac!.children.length).toBe(2);
    expect(mfrac!.children[0]!.textContent).toBe('a+b');
    expect(mfrac!.children[1]!.textContent).toBe('c+d');
  });

  it('sets mathvariant=normal for m:nor (normal text) flag', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:r',
          elements: [
            { name: 'm:rPr', elements: [{ name: 'm:nor' }] },
            { name: 'm:t', elements: [{ type: 'text', text: 'sin' }] },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    const mi = result!.querySelector('mi');
    expect(mi).not.toBeNull();
    expect(mi!.getAttribute('mathvariant')).toBe('normal');
  });

  // ── m:sty (ECMA-376 §22.1.2 math style) → mathvariant ────────────────────
  // Word-native documents use m:sty, not m:nor, to signal upright function
  // names like "lim" / "sin" / "max" — so these values must be honored.

  const runWithRPr = (text: string, rPrElements: Array<unknown>) => ({
    name: 'm:oMath',
    elements: [
      {
        name: 'm:r',
        elements: [
          { name: 'm:rPr', elements: rPrElements },
          { name: 'm:t', elements: [{ type: 'text', text }] },
        ],
      },
    ],
  });

  it('sets mathvariant=normal for m:sty val=p', () => {
    const result = convertOmmlToMathml(runWithRPr('lim', [{ name: 'm:sty', attributes: { 'm:val': 'p' } }]), doc);
    const mi = result!.querySelector('mi');
    expect(mi!.getAttribute('mathvariant')).toBe('normal');
  });

  it('sets mathvariant=bold for m:sty val=b', () => {
    const result = convertOmmlToMathml(runWithRPr('x', [{ name: 'm:sty', attributes: { 'm:val': 'b' } }]), doc);
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('bold');
  });

  it('sets mathvariant=italic for m:sty val=i', () => {
    const result = convertOmmlToMathml(runWithRPr('abc', [{ name: 'm:sty', attributes: { 'm:val': 'i' } }]), doc);
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('italic');
  });

  it('sets mathvariant=bold-italic for m:sty val=bi', () => {
    const result = convertOmmlToMathml(runWithRPr('x', [{ name: 'm:sty', attributes: { 'm:val': 'bi' } }]), doc);
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('bold-italic');
  });

  // ── m:scr (ECMA-376 §22.1.2 math script) → mathvariant ───────────────────

  it('sets mathvariant=normal for m:scr val=roman', () => {
    const result = convertOmmlToMathml(runWithRPr('lim', [{ name: 'm:scr', attributes: { 'm:val': 'roman' } }]), doc);
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('normal');
  });

  it('sets mathvariant=script for m:scr val=script', () => {
    const result = convertOmmlToMathml(runWithRPr('L', [{ name: 'm:scr', attributes: { 'm:val': 'script' } }]), doc);
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('script');
  });

  it('sets mathvariant=fraktur for m:scr val=fraktur', () => {
    const result = convertOmmlToMathml(runWithRPr('g', [{ name: 'm:scr', attributes: { 'm:val': 'fraktur' } }]), doc);
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('fraktur');
  });

  it('sets mathvariant=double-struck for m:scr val=double-struck', () => {
    const result = convertOmmlToMathml(
      runWithRPr('R', [{ name: 'm:scr', attributes: { 'm:val': 'double-struck' } }]),
      doc,
    );
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('double-struck');
  });

  it('sets mathvariant=sans-serif for m:scr val=sans-serif', () => {
    const result = convertOmmlToMathml(
      runWithRPr('x', [{ name: 'm:scr', attributes: { 'm:val': 'sans-serif' } }]),
      doc,
    );
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('sans-serif');
  });

  it('sets mathvariant=monospace for m:scr val=monospace', () => {
    const result = convertOmmlToMathml(runWithRPr('x', [{ name: 'm:scr', attributes: { 'm:val': 'monospace' } }]), doc);
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('monospace');
  });

  // ── Precedence: m:sty wins over m:scr ────────────────────────────────────

  it('gives m:sty precedence over m:scr when both are present', () => {
    // Spec doesn't explicitly rank them, but m:sty is the more specific
    // rendering intent (upright/bold/italic) so we honor it first.
    const result = convertOmmlToMathml(
      runWithRPr('x', [
        { name: 'm:sty', attributes: { 'm:val': 'b' } },
        { name: 'm:scr', attributes: { 'm:val': 'fraktur' } },
      ]),
      doc,
    );
    expect(result!.querySelector('mi')!.getAttribute('mathvariant')).toBe('bold');
  });

  it('omits mathvariant when rPr has no recognized style properties', () => {
    const result = convertOmmlToMathml(
      runWithRPr('x', [{ name: 'w:rFonts', attributes: { 'w:ascii': 'Cambria Math' } }]),
      doc,
    );
    expect(result!.querySelector('mi')!.hasAttribute('mathvariant')).toBe(false);
  });

  it('handles empty m:r (no m:t children)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:r',
          elements: [{ name: 'm:rPr', elements: [] }],
        },
      ],
    };

    // Should not crash; may return empty math or null
    const result = convertOmmlToMathml(omml, doc);
    // Result could be null (no content) or an empty <math>
    // Either is acceptable
  });

  it('handles multiple runs producing different element types', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] },
        { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
        { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('x+1');

    const children = Array.from(result!.children);
    expect(children.some((c) => c.localName === 'mi')).toBe(true); // x
    expect(children.some((c) => c.localName === 'mo')).toBe(true); // +
    expect(children.some((c) => c.localName === 'mn')).toBe(true); // 1
  });

  // ─── tokenizeMathText direct coverage (SD-2632) ────────────────────────────

  it('tokenizes leading-decimal content with . as an operator followed by digits', () => {
    // ".5" has no leading digit, so the "." is not part of a number.
    expect(tokenizeMathText('.5')).toEqual([
      { tag: 'mo', content: '.' },
      { tag: 'mn', content: '5' },
    ]);
  });

  it('tokenizes a trailing decimal point as a separate operator', () => {
    // "5." — the digit run ends at "5" because a lookahead digit is required.
    expect(tokenizeMathText('5.')).toEqual([
      { tag: 'mn', content: '5' },
      { tag: 'mo', content: '.' },
    ]);
  });

  it('tokenizes "1.2.3" as number, operator, number — only first dot is inline', () => {
    expect(tokenizeMathText('1.2.3')).toEqual([
      { tag: 'mn', content: '1.2' },
      { tag: 'mo', content: '.' },
      { tag: 'mn', content: '3' },
    ]);
  });

  it('tokenizes "2x+1" — number-identifier-operator-number', () => {
    expect(tokenizeMathText('2x+1')).toEqual([
      { tag: 'mn', content: '2' },
      { tag: 'mi', content: 'x' },
      { tag: 'mo', content: '+' },
      { tag: 'mn', content: '1' },
    ]);
  });

  it('tokenizes consecutive operator characters as separate <mo> atoms', () => {
    expect(tokenizeMathText('\u2264\u2265')).toEqual([
      { tag: 'mo', content: '\u2264' },
      { tag: 'mo', content: '\u2265' },
    ]);
  });

  it('tokenizes empty text as an empty list', () => {
    expect(tokenizeMathText('')).toEqual([]);
  });

  it('tokenizes standalone ∞ as identifier, not operator (SD-2632)', () => {
    // U+221E was removed from OPERATOR_CHARS; Word classifies it as <mi>.
    expect(tokenizeMathText('\u221E')).toEqual([{ tag: 'mi', content: '\u221E' }]);
  });

  it('keeps astral-plane characters whole (does not split surrogate pairs)', () => {
    // 𝑥 (U+1D465, mathematical italic small x) is a UTF-16 surrogate pair.
    // Splitting by code unit would emit two bogus half-pair <mi>s.
    const text = '\u{1D465}+1';
    expect(tokenizeMathText(text)).toEqual([
      { tag: 'mi', content: '\u{1D465}' },
      { tag: 'mo', content: '+' },
      { tag: 'mn', content: '1' },
    ]);
  });

  // ─── SD-2632: per-character split of multi-char m:r text ──────────────────

  it('splits a single m:r containing operator + identifier into <mo> + <mi> (SD-2632)', () => {
    // Fixture case 1 of math-limit-tests.docx has m:r "→∞" as one run inside
    // m:limLow's m:lim. Word's OMML2MML.XSL splits it to <mo>→</mo><mi>∞</mi>.
    const omml = {
      name: 'm:oMath',
      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '\u2192\u221E' }] }] }],
    };
    const result = convertOmmlToMathml(omml, doc);
    const children = Array.from(result!.children);
    expect(children.map((c) => `${c.localName}:${c.textContent}`)).toEqual(['mo:\u2192', 'mi:\u221E']);
  });

  it('splits "x+1=2" per character with digits grouped (SD-2632)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x+1=2' }] }] }],
    };
    const result = convertOmmlToMathml(omml, doc);
    const children = Array.from(result!.children);
    expect(children.map((c) => `${c.localName}:${c.textContent}`)).toEqual(['mi:x', 'mo:+', 'mn:1', 'mo:=', 'mn:2']);
  });

  it('groups consecutive digits with an interior decimal point into one <mn> (SD-2632)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '123.45+67' }] }] }],
    };
    const result = convertOmmlToMathml(omml, doc);
    const children = Array.from(result!.children);
    expect(children.map((c) => `${c.localName}:${c.textContent}`)).toEqual(['mn:123.45', 'mo:+', 'mn:67']);
  });

  it('splits m:r content inside m:sub of an m:sSub (SD-2632 F3)', () => {
    // Word's built-up "b_(n+1)" has "n+1" as a single m:r inside m:sub.
    // The subscript should contain separate <mi>n</mi><mo>+</mo><mn>1</mn>.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSub',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n+1' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const subMrow = result!.querySelector('msub > mrow:nth-child(2)');
    expect(subMrow).not.toBeNull();
    const children = Array.from(subMrow!.children);
    expect(children.map((c) => `${c.localName}:${c.textContent}`)).toEqual(['mi:n', 'mo:+', 'mn:1']);
  });

  it('preserves m:rPr mathvariant across every atom of a split run (SD-2632)', () => {
    // When m:sty="b" (bold) applies to the whole run, every atom emitted
    // from the split inherits it.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:r',
          elements: [
            { name: 'm:rPr', elements: [{ name: 'm:sty', attributes: { 'm:val': 'b' } }] },
            { name: 'm:t', elements: [{ type: 'text', text: 'x+1' }] },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const variants = Array.from(result!.children).map((c) => c.getAttribute('mathvariant'));
    expect(variants).toEqual(['bold', 'bold', 'bold']);
  });

  it('keeps "log" whole but splits operators and digits for m:fName with mixed content (SD-2632)', () => {
    // Word's OMML2MML.XSL for <m:fName><m:r>log_2</m:r></m:fName>: letters group
    // into one <mi>, operators and digits still split.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'log_2' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const fnameRow = result!.querySelector('mrow > mrow:first-child');
    const children = Array.from(fnameRow!.children);
    expect(children.map((c) => `${c.localName}:${c.textContent}`)).toEqual(['mi:log', 'mo:_', 'mn:2']);
  });

  it('collapses a multi-char base inside nested m:sSub wrapped by m:fName (SD-2632)', () => {
    // Ensures the msub/msup entries of BASE_BEARING_ELEMENTS are actually pinned.
    // <m:fName><m:sSub><m:e>f</m:e><m:sub>i</m:sub></m:sSub></m:fName> should
    // keep "f" as a single <mi> inside the subscript wrapper's base slot.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [
                {
                  name: 'm:sSub',
                  elements: [
                    {
                      name: 'm:e',
                      elements: [
                        {
                          name: 'm:r',
                          elements: [
                            { name: 'm:rPr', elements: [{ name: 'm:sty', attributes: { 'm:val': 'p' } }] },
                            { name: 'm:t', elements: [{ type: 'text', text: 'log' }] },
                          ],
                        },
                      ],
                    },
                    {
                      name: 'm:sub',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '2' }] }] }],
                    },
                  ],
                },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const msub = result!.querySelector('msub');
    expect(msub).not.toBeNull();
    const baseMi = msub!.children[0]!.querySelector('mi');
    expect(baseMi!.textContent).toBe('log');
    expect(baseMi!.getAttribute('mathvariant')).toBe('normal');
  });

  it('collapses multi-char base inside nested m:sPre (mmultiscripts) wrapped by m:fName (SD-2632)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [
                {
                  name: 'm:sPre',
                  elements: [
                    {
                      name: 'm:sub',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '2' }] }] }],
                    },
                    {
                      name: 'm:sup',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
                    },
                    {
                      name: 'm:e',
                      elements: [
                        {
                          name: 'm:r',
                          elements: [
                            { name: 'm:rPr', elements: [{ name: 'm:sty', attributes: { 'm:val': 'p' } }] },
                            { name: 'm:t', elements: [{ type: 'text', text: 'log' }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mms = result!.querySelector('mmultiscripts');
    expect(mms).not.toBeNull();
    const baseMi = mms!.children[0]!.querySelector('mi');
    expect(baseMi!.textContent).toBe('log');
    expect(baseMi!.getAttribute('mathvariant')).toBe('normal');
  });

  it('keeps multi-letter function names whole inside m:func > m:fName (SD-2632 exception)', () => {
    // Word's OMML2MML.XSL keeps "sin" as one <mi> when nested in m:fName,
    // even though it would otherwise per-char split a bare m:r. Exception is
    // applied by convertFunction.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const functionName = result!.querySelector('mrow > mrow:first-child > mi');
    expect(functionName!.textContent).toBe('sin');
    expect(functionName!.getAttribute('mathvariant')).toBe('normal');
  });
});

describe('m:bar converter', () => {
  it('renders overbar (top) as <mover> with U+203E', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:bar',
          elements: [
            { name: 'm:barPr', elements: [{ name: 'm:pos', attributes: { 'm:val': 'top' } }] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.firstElementChild!.textContent).toBe('x');
    const mo = mover!.querySelector('mo');
    expect(mo?.textContent).toBe('\u203E');
  });

  it('renders underbar (bot) as <munder> with U+203E', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:bar',
          elements: [
            { name: 'm:barPr', elements: [{ name: 'm:pos', attributes: { 'm:val': 'bot' } }] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    expect(munder!.firstElementChild!.textContent).toBe('y');
    const mo = munder!.querySelector('mo');
    expect(mo?.textContent).toBe('\u203E');
  });

  it('defaults to underbar when m:barPr is missing (matches Word behavior)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:bar',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'z' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    expect(munder!.firstElementChild!.textContent).toBe('z');
    const mo = munder!.querySelector('mo');
    expect(mo?.textContent).toBe('\u203E');
  });
});

describe('m:d converter', () => {
  it('converts m:d to delimiters around the expression', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:d',
          elements: [
            {
              name: 'm:dPr',
              elements: [
                { name: 'm:begChr', attributes: { 'm:val': '(' } },
                { name: 'm:endChr', attributes: { 'm:val': ')' } },
              ],
            },
            {
              name: 'm:e',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] },
              ],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('(x+y)');

    const outerRow = result!.querySelector('mrow');
    expect(outerRow).not.toBeNull();
    expect(outerRow!.children[0]!.textContent).toBe('(');
    expect(outerRow!.children[1]!.textContent).toBe('x+y');
    expect(outerRow!.children[2]!.textContent).toBe(')');
  });

  it('defaults to parentheses and U+2502 separators when dPr is missing', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:d',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('(x\u2502y)');
  });

  it('uses custom delimiter and separator characters for multiple expressions', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:d',
          elements: [
            {
              name: 'm:dPr',
              elements: [
                { name: 'm:begChr', attributes: { 'm:val': '[' } },
                { name: 'm:endChr', attributes: { 'm:val': ']' } },
                { name: 'm:sepChr', attributes: { 'm:val': ';' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('[a;b]');

    const outerRow = result!.querySelector('mrow');
    expect(outerRow).not.toBeNull();
    expect(outerRow!.children.length).toBe(5);
    expect(outerRow!.children[0]!.textContent).toBe('[');
    expect(outerRow!.children[2]!.textContent).toBe(';');
    expect(outerRow!.children[4]!.textContent).toBe(']');
  });

  it('does not render stray separators for empty expressions', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:d',
          elements: [
            { name: 'm:e', elements: [] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('(x)');
  });

  it('preserves explicit empty delimiter characters', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:d',
          elements: [
            {
              name: 'm:dPr',
              elements: [
                { name: 'm:begChr', attributes: { 'm:val': '' } },
                { name: 'm:endChr', attributes: { 'm:val': '' } },
                { name: 'm:sepChr', attributes: { 'm:val': '' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('xy');

    const outerRow = result!.querySelector('mrow');
    expect(outerRow).not.toBeNull();
    expect(outerRow!.children.length).toBe(5);
    expect(outerRow!.children[0]!.textContent).toBe('');
    expect(outerRow!.children[2]!.textContent).toBe('');
    expect(outerRow!.children[4]!.textContent).toBe('');
  });

  it('suppresses delimiter characters when chr elements are present without m:val', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:d',
          elements: [
            {
              name: 'm:dPr',
              elements: [{ name: 'm:begChr' }, { name: 'm:endChr' }, { name: 'm:sepChr' }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('xy');

    const outerRow = result!.querySelector('mrow');
    expect(outerRow).not.toBeNull();
    expect(outerRow!.children.length).toBe(5);
    expect(outerRow!.children[0]!.textContent).toBe('');
    expect(outerRow!.children[2]!.textContent).toBe('');
    expect(outerRow!.children[4]!.textContent).toBe('');
  });
});

describe('m:func converter', () => {
  it('converts m:func to function name + apply operator + argument', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe(`sin${'\u2061'}x`);

    const mrow = result!.querySelector('mrow');
    expect(mrow).not.toBeNull();

    const functionIdentifier = mrow!.querySelector('mi');
    expect(functionIdentifier).not.toBeNull();
    expect(functionIdentifier!.textContent).toBe('sin');
    expect(functionIdentifier!.getAttribute('mathvariant')).toBe('normal');

    const applyOperator = mrow!.querySelector('mo');
    expect(applyOperator).not.toBeNull();
    expect(applyOperator!.textContent).toBe('\u2061');
  });

  it('ignores m:funcPr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            { name: 'm:funcPr', elements: [{ name: 'm:ctrlPr' }] },
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'log' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '10' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe(`log${'\u2061'}10`);
  });

  it('renders single-character function names upright', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'f' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    const firstMi = result!.querySelector('mi');
    expect(firstMi).not.toBeNull();
    expect(firstMi!.textContent).toBe('f');
    expect(firstMi!.getAttribute('mathvariant')).toBe('normal');
  });

  it('wraps multi-part arguments in <mrow>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] }],
            },
            {
              name: 'm:e',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();

    const outerRow = result!.querySelector('math > mrow');
    expect(outerRow).not.toBeNull();
    expect(outerRow!.children.length).toBe(3);
    expect(outerRow!.children[0]!.textContent).toBe('sin');
    expect(outerRow!.children[1]!.textContent).toBe('\u2061');
    expect(outerRow!.children[2]!.textContent).toBe('x+1');
  });

  it('renders only the argument when m:fName is missing', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('x');

    const mo = result!.querySelector('mo');
    expect(mo).toBeNull();
  });

  it('renders only the function name when m:e is missing', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('sin');

    const mo = result!.querySelector('mo');
    expect(mo).toBeNull();

    const mi = result!.querySelector('mi');
    expect(mi!.getAttribute('mathvariant')).toBe('normal');
  });

  it('returns null for empty m:func', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).toBeNull();
  });

  it('handles nested m:func (sin of cos x)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] }],
            },
            {
              name: 'm:e',
              elements: [
                {
                  name: 'm:func',
                  elements: [
                    {
                      name: 'm:fName',
                      elements: [
                        { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'cos' }] }] },
                      ],
                    },
                    {
                      name: 'm:e',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe(`sin${'\u2061'}cos${'\u2061'}x`);

    const mis = result!.querySelectorAll('mi[mathvariant="normal"]');
    expect(mis.length).toBe(2);
    expect(mis[0]!.textContent).toBe('sin');
    expect(mis[1]!.textContent).toBe('cos');
  });

  it('preserves explicit m:sty=i on function-name runs', () => {
    // SD-2538 preserve branch: forceNormalMathVariant must NOT overwrite
    // an existing mathvariant. When Word marks a function-name run with
    // m:sty="i", convertMathRun already set mathvariant="italic" — the
    // function-apply pass must leave it alone.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [
                {
                  name: 'm:r',
                  elements: [
                    { name: 'm:rPr', elements: [{ name: 'm:sty', attributes: { 'm:val': 'i' } }] },
                    { name: 'm:t', elements: [{ type: 'text', text: 'L' }] },
                  ],
                },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const nameMi = result!.querySelectorAll('mi')[0];
    expect(nameMi!.textContent).toBe('L');
    expect(nameMi!.getAttribute('mathvariant')).toBe('italic');
  });
});

describe('m:rad converter', () => {
  it('converts m:rad with degHide to <msqrt>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            {
              name: 'm:radPr',
              elements: [{ name: 'm:degHide' }],
            },
            { name: 'm:deg', elements: [] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msqrt = result!.querySelector('msqrt');
    expect(msqrt).not.toBeNull();
    expect(msqrt!.textContent).toBe('x');
    expect(result!.querySelector('mroot')).toBeNull();
  });

  it('converts m:rad without degHide to <mroot> with radicand first, degree second', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            {
              name: 'm:deg',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '3' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mroot = result!.querySelector('mroot');
    expect(mroot).not.toBeNull();
    expect(mroot!.children[0]!.textContent).toBe('x');
    expect(mroot!.children[1]!.textContent).toBe('3');
    expect(result!.querySelector('msqrt')).toBeNull();
  });

  it('converts m:rad with degHide m:val="0" to <mroot> (degree explicitly visible)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            {
              name: 'm:radPr',
              elements: [{ name: 'm:degHide', attributes: { 'm:val': '0' } }],
            },
            {
              name: 'm:deg',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '3' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('mroot')).not.toBeNull();
    expect(result!.querySelector('msqrt')).toBeNull();
  });

  it('produces <msqrt> when m:deg is missing entirely', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msqrt')).not.toBeNull();
    expect(result!.querySelector('mroot')).toBeNull();
  });

  it('handles missing m:e gracefully', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            {
              name: 'm:radPr',
              elements: [{ name: 'm:degHide' }],
            },
            { name: 'm:deg', elements: [] },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msqrt = result!.querySelector('msqrt');
    expect(msqrt).not.toBeNull();
    expect(msqrt!.textContent).toBe('');
  });

  it('treats m:degHide m:val="1" as hidden (canonical Word output)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            {
              name: 'm:radPr',
              elements: [{ name: 'm:degHide', attributes: { 'm:val': '1' } }],
            },
            { name: 'm:deg', elements: [] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msqrt')).not.toBeNull();
    expect(result!.querySelector('mroot')).toBeNull();
  });

  it('treats m:degHide m:val="true" as hidden (ST_OnOff true alias)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            {
              name: 'm:radPr',
              elements: [{ name: 'm:degHide', attributes: { 'm:val': 'true' } }],
            },
            {
              name: 'm:deg',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '3' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msqrt')).not.toBeNull();
    expect(result!.querySelector('mroot')).toBeNull();
  });

  // Word's round-trip canonical form for "no explicit degree": Word adds an empty
  // <m:deg/> on save even when there is no <m:degHide>. Without the empty-deg
  // check this falls into the <mroot> branch and produces an invalid
  // <mroot><mrow>x</mrow><mrow></mrow></mroot> with an empty index.
  it('produces <msqrt> when m:deg is present but empty and no m:degHide', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            { name: 'm:deg', elements: [] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msqrt = result!.querySelector('msqrt');
    expect(msqrt).not.toBeNull();
    expect(msqrt!.textContent).toBe('x');
    expect(result!.querySelector('mroot')).toBeNull();
  });

  // ST_OnOff (ECMA-376 §22.9.2.7) accepts "1"/"true"/"on" as true and
  // "0"/"false"/"off" as false. Word normalizes "on"/"off" away on save but
  // other DOCX producers (Google Docs, LibreOffice, Pages) may emit them.
  it('treats m:degHide m:val="on" as hidden (ST_OnOff true alias)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            {
              name: 'm:radPr',
              elements: [{ name: 'm:degHide', attributes: { 'm:val': 'on' } }],
            },
            {
              name: 'm:deg',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '3' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msqrt')).not.toBeNull();
    expect(result!.querySelector('mroot')).toBeNull();
  });

  it('treats m:degHide m:val="off" as not hidden (ST_OnOff false alias)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:rad',
          elements: [
            {
              name: 'm:radPr',
              elements: [{ name: 'm:degHide', attributes: { 'm:val': 'off' } }],
            },
            {
              name: 'm:deg',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '3' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mroot = result!.querySelector('mroot');
    expect(mroot).not.toBeNull();
    expect(mroot!.children[0]!.textContent).toBe('x');
    expect(mroot!.children[1]!.textContent).toBe('3');
    expect(result!.querySelector('msqrt')).toBeNull();
  });
});

describe('m:sSub converter', () => {
  it('converts m:sSub to <msub> with base and subscript', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSub',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msub = result!.querySelector('msub');
    expect(msub).not.toBeNull();
    expect(msub!.children.length).toBe(2);
    expect(msub!.children[0]!.textContent).toBe('a');
    expect(msub!.children[1]!.textContent).toBe('1');
  });

  it('ignores m:sSubPr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSub',
          elements: [
            { name: 'm:sSubPr', elements: [{ name: 'm:ctrlPr' }] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msub = result!.querySelector('msub');
    expect(msub).not.toBeNull();
    expect(msub!.children.length).toBe(2);
    expect(msub!.children[0]!.textContent).toBe('x');
    expect(msub!.children[1]!.textContent).toBe('n');
  });

  it('wraps multi-part base and subscript in <mrow> for valid arity', () => {
    // x_{n+1} — subscript has 3 runs that must be grouped
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSub',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
            {
              name: 'm:sub',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msub = result!.querySelector('msub');
    expect(msub).not.toBeNull();
    // <msub> must have exactly 2 children (base + subscript), each wrapped in <mrow>
    expect(msub!.children.length).toBe(2);
    expect(msub!.children[0]!.textContent).toBe('x');
    expect(msub!.children[1]!.textContent).toBe('n+1');
  });

  it('handles missing m:sub gracefully', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSub',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msub = result!.querySelector('msub');
    expect(msub).not.toBeNull();
    expect(msub!.children[0]!.textContent).toBe('a');
  });
});

describe('m:sSup converter', () => {
  it('converts m:sSup to <msup> with base and superscript', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSup',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '2' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msup = result!.querySelector('msup');
    expect(msup).not.toBeNull();
    expect(msup!.children.length).toBe(2);
    expect(msup!.children[0]!.textContent).toBe('x');
    expect(msup!.children[1]!.textContent).toBe('2');
  });

  it('ignores m:sSupPr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSup',
          elements: [
            { name: 'm:sSupPr', elements: [{ name: 'm:ctrlPr' }] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msup = result!.querySelector('msup');
    expect(msup).not.toBeNull();
    expect(msup!.children.length).toBe(2);
    expect(msup!.children[0]!.textContent).toBe('a');
    expect(msup!.children[1]!.textContent).toBe('b');
  });

  it('wraps multi-part base and superscript in <mrow> for valid arity', () => {
    // (x+1)^2 — base has 3 runs that must be grouped
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSup',
          elements: [
            {
              name: 'm:e',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '2' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msup = result!.querySelector('msup');
    expect(msup).not.toBeNull();
    // <msup> must have exactly 2 children (base + superscript), each wrapped in <mrow>
    expect(msup!.children.length).toBe(2);
    expect(msup!.children[0]!.textContent).toBe('x+1');
    expect(msup!.children[1]!.textContent).toBe('2');
  });

  it('handles missing m:sup gracefully', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSup',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msup = result!.querySelector('msup');
    expect(msup).not.toBeNull();
    expect(msup!.children[0]!.textContent).toBe('x');
  });
});

describe('m:sSubSup converter', () => {
  it('converts m:sSubSup to <msubsup> with base, subscript, and superscript', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSubSup',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '2' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msubsup = result!.querySelector('msubsup');
    expect(msubsup).not.toBeNull();
    expect(msubsup!.children.length).toBe(3);
    expect(msubsup!.children[0]!.textContent).toBe('x');
    expect(msubsup!.children[1]!.textContent).toBe('i');
    expect(msubsup!.children[2]!.textContent).toBe('2');
  });

  it('ignores m:sSubSupPr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSubSup',
          elements: [
            { name: 'm:sSubSupPr', elements: [{ name: 'm:alnScr' }] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'k' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msubsup = result!.querySelector('msubsup');
    expect(msubsup).not.toBeNull();
    expect(msubsup!.children.length).toBe(3);
    expect(msubsup!.children[0]!.textContent).toBe('a');
    expect(msubsup!.children[1]!.textContent).toBe('n');
    expect(msubsup!.children[2]!.textContent).toBe('k');
  });

  it('wraps multi-part operands in <mrow> for valid arity', () => {
    // x_{n+1}^{k-1} — both sub and sup have multiple runs
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSubSup',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
            {
              name: 'm:sub',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
            {
              name: 'm:sup',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'k' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '-' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msubsup = result!.querySelector('msubsup');
    expect(msubsup).not.toBeNull();
    expect(msubsup!.children.length).toBe(3);
    expect(msubsup!.children[0]!.textContent).toBe('x');
    expect(msubsup!.children[1]!.textContent).toBe('n+1');
    expect(msubsup!.children[2]!.textContent).toBe('k-1');
  });

  it('handles missing m:sub and m:sup gracefully', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sSubSup',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msubsup = result!.querySelector('msubsup');
    expect(msubsup).not.toBeNull();
    expect(msubsup!.children[0]!.textContent).toBe('x');
  });
});

describe('m:sPre converter', () => {
  // Per ECMA-376 §22.1.2.99, m:sPre children appear in the order
  // (m:sPrePr?, m:sub, m:sup, m:e) — base is last, not first.
  it('converts pre-sub-superscript to <mmultiscripts> with <mprescripts/>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sPre',
          elements: [
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'X' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mmulti = result!.querySelector('mmultiscripts');
    expect(mmulti).not.toBeNull();
    // mmultiscripts children order: base, <mprescripts/>, sub, sup
    expect(mmulti!.children.length).toBe(4);
    expect(mmulti!.children[0]!.textContent).toBe('X');
    expect(mmulti!.children[1]!.localName).toBe('mprescripts');
    expect(mmulti!.children[2]!.textContent).toBe('a');
    expect(mmulti!.children[3]!.textContent).toBe('b');
  });

  it('ignores m:sPrePr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sPre',
          elements: [
            { name: 'm:sPrePr', elements: [{ name: 'm:ctrlPr' }] },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'X' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mmulti = result!.querySelector('mmultiscripts');
    expect(mmulti).not.toBeNull();
    expect(mmulti!.children.length).toBe(4);
    expect(mmulti!.children[0]!.textContent).toBe('X');
    expect(mmulti!.children[1]!.localName).toBe('mprescripts');
    expect(mmulti!.children[2]!.textContent).toBe('a');
    expect(mmulti!.children[3]!.textContent).toBe('b');
  });

  it('wraps multi-run sub and sup in <mrow> for valid arity', () => {
    // {}_{n+1}^{k-1}X — both pre-scripts have multiple runs
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sPre',
          elements: [
            {
              name: 'm:sub',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
            {
              name: 'm:sup',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'k' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '-' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'X' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mmulti = result!.querySelector('mmultiscripts');
    expect(mmulti).not.toBeNull();
    // <mmultiscripts> must keep exactly 4 children — the mrow wrapping preserves arity
    expect(mmulti!.children.length).toBe(4);
    expect(mmulti!.children[0]!.textContent).toBe('X');
    expect(mmulti!.children[1]!.localName).toBe('mprescripts');
    expect(mmulti!.children[2]!.textContent).toBe('n+1');
    expect(mmulti!.children[3]!.textContent).toBe('k-1');
  });

  it('handles missing m:sub and m:sup gracefully', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:sPre',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'Y' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mmulti = result!.querySelector('mmultiscripts');
    expect(mmulti).not.toBeNull();
    // Empty sub/sup mrows preserved to keep valid <mmultiscripts> arity of 4.
    expect(mmulti!.children.length).toBe(4);
    expect(mmulti!.children[0]!.textContent).toBe('Y');
    expect(mmulti!.children[1]!.localName).toBe('mprescripts');
  });
});

describe('m:func converter', () => {
  it('converts m:func to function name + apply operator + argument', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe(`sin${'\u2061'}x`);

    const mrow = result!.querySelector('mrow');
    expect(mrow).not.toBeNull();

    const functionIdentifier = mrow!.querySelector('mi');
    expect(functionIdentifier).not.toBeNull();
    expect(functionIdentifier!.textContent).toBe('sin');
    expect(functionIdentifier!.getAttribute('mathvariant')).toBe('normal');

    const applyOperator = mrow!.querySelector('mo');
    expect(applyOperator).not.toBeNull();
    expect(applyOperator!.textContent).toBe('\u2061');
  });

  it('ignores m:funcPr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            { name: 'm:funcPr', elements: [{ name: 'm:ctrlPr' }] },
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'log' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '10' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe(`log${'\u2061'}10`);
  });

  it('renders single-character function names upright', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'f' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    const firstMi = result!.querySelector('mi');
    expect(firstMi).not.toBeNull();
    expect(firstMi!.textContent).toBe('f');
    expect(firstMi!.getAttribute('mathvariant')).toBe('normal');
  });

  it('wraps multi-part arguments in <mrow>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] }],
            },
            {
              name: 'm:e',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();

    const outerRow = result!.querySelector('math > mrow');
    expect(outerRow).not.toBeNull();
    expect(outerRow!.children.length).toBe(3);
    expect(outerRow!.children[0]!.textContent).toBe('sin');
    expect(outerRow!.children[1]!.textContent).toBe('\u2061');
    expect(outerRow!.children[2]!.textContent).toBe('x+1');
  });

  it('renders only the argument when m:fName is missing', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('x');

    // No apply operator when function name is missing
    const mo = result!.querySelector('mo');
    expect(mo).toBeNull();
  });

  it('renders only the function name when m:e is missing', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('sin');

    // No apply operator when argument is missing
    const mo = result!.querySelector('mo');
    expect(mo).toBeNull();

    // Function name should still be upright
    const mi = result!.querySelector('mi');
    expect(mi!.getAttribute('mathvariant')).toBe('normal');
  });

  it('returns null for empty m:func', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).toBeNull();
  });

  it('handles nested m:func (sin of cos x)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] }],
            },
            {
              name: 'm:e',
              elements: [
                {
                  name: 'm:func',
                  elements: [
                    {
                      name: 'm:fName',
                      elements: [
                        { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'cos' }] }] },
                      ],
                    },
                    {
                      name: 'm:e',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe(`sin${'\u2061'}cos${'\u2061'}x`);

    // Both function names should be upright
    const mis = result!.querySelectorAll('mi[mathvariant="normal"]');
    expect(mis.length).toBe(2);
    expect(mis[0]!.textContent).toBe('sin');
    expect(mis[1]!.textContent).toBe('cos');
  });
});

describe('m:acc converter', () => {
  // Helper: build an m:acc node with an optional accPr and a base string.
  const buildAcc = (accPrElements: unknown[] | null, baseText: string | null, extraBaseRuns: string[] = []) => {
    const elements: unknown[] = [];
    if (accPrElements !== null) {
      elements.push({ name: 'm:accPr', elements: accPrElements });
    }
    if (baseText !== null) {
      const runs = [baseText, ...extraBaseRuns].map((t) => ({
        name: 'm:r',
        elements: [{ name: 'm:t', elements: [{ type: 'text', text: t }] }],
      }));
      elements.push({ name: 'm:e', elements: runs });
    }
    return { name: 'm:oMath', elements: [{ name: 'm:acc', elements }] };
  };

  it('converts accent with tilde to <mover accent="true">', () => {
    const result = convertOmmlToMathml(buildAcc([{ name: 'm:chr', attributes: { 'm:val': '\u0303' } }], 'x'), doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.getAttribute('accent')).toBe('true');
    expect(mover!.children[0]!.textContent).toBe('x');
    // Combining tilde (U+0303) is mapped to ASCII tilde (U+007E, "~") which
    // MathML Core's operator dictionary marks as a stretchy accent.
    const mo = mover!.querySelector('mo');
    expect(mo!.textContent).toBe('\u007E');
  });

  it('defaults to circumflex when m:accPr is absent (spec §22.1.2.1)', () => {
    const result = convertOmmlToMathml(buildAcc(null, 'a'), doc);
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.getAttribute('accent')).toBe('true');
    // Combining circumflex (U+0302) maps to ASCII circumflex (U+005E, "^").
    expect(mover!.querySelector('mo')!.textContent).toBe('\u005E');
  });

  it('defaults to circumflex when m:accPr is present but m:chr is absent (spec §22.1.2.20)', () => {
    const result = convertOmmlToMathml(buildAcc([{ name: 'm:ctrlPr' }], 'a'), doc);
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.getAttribute('accent')).toBe('true');
    expect(mover!.querySelector('mo')!.textContent).toBe('\u005E');
  });

  it('renders dot accent', () => {
    const result = convertOmmlToMathml(buildAcc([{ name: 'm:chr', attributes: { 'm:val': '\u0307' } }], 'y'), doc);
    const mover = result!.querySelector('mover');
    expect(mover!.getAttribute('accent')).toBe('true');
    // U+0307 → U+02D9 (spacing dot above) — no ASCII-range equivalent.
    expect(mover!.querySelector('mo')!.textContent).toBe('\u02D9');
  });

  it('maps combining right-arrow (U+20D7) to stretchy right arrow (U+2192)', () => {
    const result = convertOmmlToMathml(buildAcc([{ name: 'm:chr', attributes: { 'm:val': '\u20D7' } }], 'v'), doc);
    expect(result!.querySelector('mover mo')!.textContent).toBe('\u2192');
  });

  it('passes unmapped accent characters through unchanged', () => {
    // A character outside the combining→spacing table should pass through as-is.
    const result = convertOmmlToMathml(buildAcc([{ name: 'm:chr', attributes: { 'm:val': '*' } }], 'x'), doc);
    expect(result!.querySelector('mover mo')!.textContent).toBe('*');
  });

  // ── Spec §22.1.2.20: m:chr present with missing/empty m:val means the
  //    character is absent (not "use the default"). Render the base alone.
  it('renders the base alone when m:chr is present with no m:val attribute', () => {
    const result = convertOmmlToMathml(buildAcc([{ name: 'm:chr' }], 'x'), doc);
    expect(result).not.toBeNull();
    // No <mover> wrapper — just the base inside an <mrow>.
    expect(result!.querySelector('mover')).toBeNull();
    expect(result!.textContent).toBe('x');
  });

  it('renders the base alone when m:chr has an explicitly empty m:val', () => {
    const result = convertOmmlToMathml(buildAcc([{ name: 'm:chr', attributes: { 'm:val': '' } }], 'x'), doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('mover')).toBeNull();
    expect(result!.textContent).toBe('x');
  });

  it('wraps multi-run base in <mrow> so a wide base like x+1 renders as a group', () => {
    const result = convertOmmlToMathml(
      buildAcc([{ name: 'm:chr', attributes: { 'm:val': '\u0303' } }], 'x', ['+', '1']),
      doc,
    );
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    const baseRow = mover!.children[0]!;
    expect(baseRow.tagName.toLowerCase()).toBe('mrow');
    expect(baseRow.children.length).toBe(3);
    expect(baseRow.textContent).toBe('x+1');
  });

  it('ignores non-chr siblings in m:accPr (e.g. m:ctrlPr)', () => {
    const result = convertOmmlToMathml(
      buildAcc([{ name: 'm:ctrlPr' }, { name: 'm:chr', attributes: { 'm:val': '\u0303' } }], 'x'),
      doc,
    );
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.children.length).toBe(2);
    expect(mover!.querySelector('mo')!.textContent).toBe('\u007E');
  });

  it('returns null when m:e is absent (invalid per CT_Acc)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:acc',
          elements: [{ name: 'm:accPr', elements: [{ name: 'm:chr', attributes: { 'm:val': '\u0303' } }] }],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    // The outer <math> is produced only if it has children. With m:acc dropped,
    // there are no math children, so convertOmmlToMathml returns null.
    expect(result).toBeNull();
  });
});

describe('m:limLow converter', () => {
  it('converts m:limLow to <munder> with base and lower limit', () => {
    // lim_{n→∞}
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limLow',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'lim' }] }] }],
            },
            {
              name: 'm:lim',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '\u2192' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '\u221E' }] }] },
              ],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    expect(munder!.children.length).toBe(2);
    expect(munder!.children[0]!.textContent).toBe('lim');
    expect(munder!.children[1]!.textContent).toBe('n\u2192\u221E');
  });

  it('ignores m:limLowPr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limLow',
          elements: [
            { name: 'm:limLowPr', elements: [{ name: 'm:ctrlPr' }] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'inf' }] }] }],
            },
            {
              name: 'm:lim',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    expect(munder!.children.length).toBe(2);
    expect(munder!.children[0]!.textContent).toBe('inf');
    expect(munder!.children[1]!.textContent).toBe('x');
  });

  it('wraps multi-part base and limit in <mrow> for valid arity', () => {
    // lim_{n→∞} — limit has 3 runs that must be grouped
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limLow',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'lim' }] }] }],
            },
            {
              name: 'm:lim',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '\u2192' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '\u221E' }] }] },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    // <munder> must have exactly 2 children (base + limit), each wrapped in <mrow>
    expect(munder!.children.length).toBe(2);
    expect(munder!.children[0]!.textContent).toBe('lim');
    expect(munder!.children[1]!.textContent).toBe('n\u2192\u221E');
  });

  it('handles missing m:lim gracefully', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limLow',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'lim' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    // <munder> is arity-2: preserve an empty <mrow> on the missing side.
    expect(munder!.children.length).toBe(2);
    expect(munder!.children[0]!.textContent).toBe('lim');
    expect(munder!.children[1]!.textContent).toBe('');
  });

  it('handles missing m:e gracefully', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limLow',
          elements: [
            {
              name: 'm:lim',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'k' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    expect(munder!.children.length).toBe(2);
    expect(munder!.children[0]!.textContent).toBe('');
    expect(munder!.children[1]!.textContent).toBe('k');
  });

  it('wraps multi-run base (m:e) in <mrow>', () => {
    // lim inf with a two-run base: exercises the base-wrapping code path.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limLow',
          elements: [
            {
              name: 'm:e',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'lim' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: ' inf' }] }] },
              ],
            },
            {
              name: 'm:lim',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    expect(munder!.children.length).toBe(2);
    expect(munder!.children[0]!.textContent).toBe('lim inf');
    expect(munder!.children[1]!.textContent).toBe('x');
  });

  it('preserves nested math object inside m:lim (fraction)', () => {
    // lim_(x/y → 0) — limit expression contains a fraction.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limLow',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'lim' }] }] }],
            },
            {
              name: 'm:lim',
              elements: [
                {
                  name: 'm:f',
                  elements: [
                    {
                      name: 'm:num',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
                    },
                    {
                      name: 'm:den',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    // The limit side must contain the recursively converted <mfrac>.
    const mfrac = munder!.querySelector('mfrac');
    expect(mfrac).not.toBeNull();
    expect(mfrac!.children.length).toBe(2);
    expect(mfrac!.children[0]!.textContent).toBe('x');
    expect(mfrac!.children[1]!.textContent).toBe('y');
  });

  it('converts m:limLow nested inside m:func > m:fName (real Word output)', () => {
    // Word wraps "lim_(n→∞)" as m:func > m:fName > m:limLow when the
    // equation is recognized as a function operator.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [
                {
                  name: 'm:limLow',
                  elements: [
                    {
                      name: 'm:e',
                      elements: [
                        {
                          name: 'm:r',
                          elements: [
                            { name: 'm:rPr', elements: [{ name: 'm:sty', attributes: { 'm:val': 'p' } }] },
                            { name: 'm:t', elements: [{ type: 'text', text: 'lim' }] },
                          ],
                        },
                      ],
                    },
                    {
                      name: 'm:lim',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
                    },
                  ],
                },
              ],
            },
            { name: 'm:e', elements: [] },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    expect(munder!.children.length).toBe(2);

    // Base: "lim" — upright via m:sty=p on the run.
    const limMi = munder!.children[0]!.querySelector('mi');
    expect(limMi!.textContent).toBe('lim');
    expect(limMi!.getAttribute('mathvariant')).toBe('normal');

    // Limit expression: "n" — must stay italic (no mathvariant attribute set).
    // SD-2538 regression: convertFunction used to recurse into the <munder>
    // and force mathvariant="normal" on every <mi>, including this one.
    const nMi = munder!.children[1]!.querySelector('mi');
    expect(nMi!.textContent).toBe('n');
    expect(nMi!.getAttribute('mathvariant')).toBeNull();
  });
});

describe('m:limUpp converter', () => {
  it('converts m:limUpp to <mover> with base and upper limit', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limUpp',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'max' }] }] }],
            },
            {
              name: 'm:lim',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.children.length).toBe(2);
    expect(mover!.children[0]!.textContent).toBe('max');
    expect(mover!.children[1]!.textContent).toBe('x');
  });

  it('ignores m:limUppPr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limUpp',
          elements: [
            { name: 'm:limUppPr', elements: [{ name: 'm:ctrlPr' }] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '=' }] }] }],
            },
            {
              name: 'm:lim',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'def' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.children.length).toBe(2);
    expect(mover!.children[0]!.textContent).toBe('=');
    expect(mover!.children[1]!.textContent).toBe('def');
  });

  it('wraps multi-part base and limit in <mrow> for valid arity', () => {
    // A^{i+1} — limit has 3 runs that must be grouped
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limUpp',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'A' }] }] }],
            },
            {
              name: 'm:lim',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    // <mover> must have exactly 2 children (base + limit), each wrapped in <mrow>
    expect(mover!.children.length).toBe(2);
    expect(mover!.children[0]!.textContent).toBe('A');
    expect(mover!.children[1]!.textContent).toBe('i+1');
  });

  it('handles missing m:lim gracefully', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limUpp',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sup' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    // <mover> is arity-2: preserve an empty <mrow> on the missing side.
    expect(mover!.children.length).toBe(2);
    expect(mover!.children[0]!.textContent).toBe('sup');
    expect(mover!.children[1]!.textContent).toBe('');
  });

  it('handles missing m:e gracefully', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limUpp',
          elements: [
            {
              name: 'm:lim',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
          ],
        },
      ],
    };

    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.children.length).toBe(2);
    expect(mover!.children[0]!.textContent).toBe('');
    expect(mover!.children[1]!.textContent).toBe('n');
  });

  it('wraps multi-run base (m:e) in <mrow>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limUpp',
          elements: [
            {
              name: 'm:e',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] },
              ],
            },
            {
              name: 'm:lim',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'def' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.children.length).toBe(2);
    expect(mover!.children[0]!.textContent).toBe('a+b');
    expect(mover!.children[1]!.textContent).toBe('def');
  });

  it('preserves nested math object inside m:lim (fraction)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:limUpp',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '=' }] }] }],
            },
            {
              name: 'm:lim',
              elements: [
                {
                  name: 'm:f',
                  elements: [
                    {
                      name: 'm:num',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'p' }] }] }],
                    },
                    {
                      name: 'm:den',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'q' }] }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    const mfrac = mover!.querySelector('mfrac');
    expect(mfrac).not.toBeNull();
    expect(mfrac!.children[0]!.textContent).toBe('p');
    expect(mfrac!.children[1]!.textContent).toBe('q');
  });

  it('converts m:limUpp nested inside m:func > m:fName (real Word output)', () => {
    // Word emits this shape when typing "lim┴x".
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [
                {
                  name: 'm:limUpp',
                  elements: [
                    {
                      name: 'm:e',
                      elements: [
                        {
                          name: 'm:r',
                          elements: [
                            { name: 'm:rPr', elements: [{ name: 'm:sty', attributes: { 'm:val': 'p' } }] },
                            { name: 'm:t', elements: [{ type: 'text', text: 'lim' }] },
                          ],
                        },
                      ],
                    },
                    {
                      name: 'm:lim',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
                    },
                  ],
                },
              ],
            },
            { name: 'm:e', elements: [] },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.children.length).toBe(2);

    // Base: "lim" — upright via m:sty=p. Limit variable "x" — italic default.
    // Symmetric to the m:limLow-in-m:func case; pins the 'mover' entry of
    // MATH_VARIANT_BOUNDARY_ELEMENTS.
    const limMi = mover!.children[0]!.querySelector('mi');
    expect(limMi!.textContent).toBe('lim');
    expect(limMi!.getAttribute('mathvariant')).toBe('normal');

    const xMi = mover!.children[1]!.querySelector('mi');
    expect(xMi!.textContent).toBe('x');
    expect(xMi!.getAttribute('mathvariant')).toBeNull();
  });
});

describe('m:eqArr converter', () => {
  it('converts equation array to left-aligned <mtable>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:eqArr',
          elements: [
            {
              name: 'm:e',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '=' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
            {
              name: 'm:e',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '=' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '2' }] }] },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mtable = result!.querySelector('mtable');
    expect(mtable).not.toBeNull();
    expect(mtable!.getAttribute('columnalign')).toBe('left');
    const rows = mtable!.querySelectorAll('mtr');
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toBe('x=1');
    expect(rows[1]!.textContent).toBe('y=2');
  });

  it('returns null for empty equation array', () => {
    const omml = {
      name: 'm:oMath',
      elements: [{ name: 'm:eqArr', elements: [] }],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).toBeNull();
  });

  it('strips & alignment markers from row content', () => {
    // ECMA-376 §22.1.2.34: `&` inside m:t is an alignment marker, not literal text.
    // The converter doesn't yet map these to MathML alignment elements, so they
    // should be stripped rather than rendered.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:eqArr',
          elements: [
            {
              name: 'm:e',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '&=' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const rows = result!.querySelectorAll('mtr');
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toBe('x=1');
    expect(rows[0]!.textContent).not.toContain('&');
  });

  it('ignores m:eqArrPr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:eqArr',
          elements: [
            { name: 'm:eqArrPr', elements: [{ name: 'm:ctrlPr' }] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const rows = result!.querySelectorAll('mtr');
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toBe('x');
    expect(rows[1]!.textContent).toBe('y');
  });

  it('preserves nested math (fraction) inside rows', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:eqArr',
          elements: [
            {
              name: 'm:e',
              elements: [
                {
                  name: 'm:f',
                  elements: [
                    {
                      name: 'm:num',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
                    },
                    {
                      name: 'm:den',
                      elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mfrac = result!.querySelector('mtable mtr mtd mfrac');
    expect(mfrac).not.toBeNull();
  });
});

describe('m:nary converter', () => {
  it('converts integral with sub/sup limits (subSup) to <msubsup>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '0' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'f(x)' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msubsup = result!.querySelector('msubsup');
    expect(msubsup).not.toBeNull();
    const mo = msubsup!.querySelector('mo');
    expect(mo!.textContent).toBe('\u222B');
    expect(msubsup!.children[1]!.textContent).toBe('0');
    expect(msubsup!.children[2]!.textContent).toBe('1');
  });

  it('converts summation (undOvr) to <munderover>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [
                { name: 'm:chr', attributes: { 'm:val': '\u2211' } },
                { name: 'm:limLoc', attributes: { 'm:val': 'undOvr' } },
              ],
            },
            {
              name: 'm:sub',
              elements: [
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '=' }] }] },
                { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] },
              ],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munderover = result!.querySelector('munderover');
    expect(munderover).not.toBeNull();
    const mo = munderover!.querySelector('mo');
    expect(mo!.textContent).toBe('\u2211');
    expect(munderover!.children[1]!.textContent).toBe('i=1');
    expect(munderover!.children[2]!.textContent).toBe('n');
  });

  it('hides sub/sup when flagged', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [
                { name: 'm:chr', attributes: { 'm:val': '\u222B' } },
                { name: 'm:subHide', attributes: { 'm:val': '1' } },
                { name: 'm:supHide', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'f' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
    expect(result!.querySelector('munderover')).toBeNull();
    const mo = result!.querySelector('mo');
    expect(mo!.textContent).toBe('\u222B');
  });

  it('renders only subscript when supHide is set', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:supHide', attributes: { 'm:val': '1' } }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'C' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'ds' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const msub = result!.querySelector('msub');
    expect(msub).not.toBeNull();
  });

  it('subHide with non-empty m:sub promotes sub content into the sup slot (matches Word)', () => {
    // Word's observed behavior: when subHide is ON but m:sub has content, the
    // content is prepended to the sup slot so nothing is silently dropped.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:subHide', attributes: { 'm:val': '1' } }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '0' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
    const msup = result!.querySelector('msup');
    expect(msup).not.toBeNull();
    // Sup slot contains sub content ("0") followed by sup content ("n")
    expect(msup!.children[1]!.textContent).toBe('0n');
  });

  it('supHide with non-empty m:sup promotes sup content into the sub slot (symmetric)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [
                { name: 'm:chr', attributes: { 'm:val': '\u222B' } },
                { name: 'm:supHide', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
    const msub = result!.querySelector('msub');
    expect(msub).not.toBeNull();
    // Sub slot contains sub content ("a") followed by promoted sup content ("b")
    expect(msub!.children[1]!.textContent).toBe('ab');
  });

  it('subHide hides empty m:sub (suppresses placeholder) → <msup>', () => {
    // Empty m:sub + subHide=ON → no sub slot (spec-correct usage of the hide flag).
    // This mirrors how Word emits indefinite integrals: empty m:sub/m:sup with hide flags.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:subHide', attributes: { 'm:val': '1' } }],
            },
            { name: 'm:sub', elements: [] },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const msup = result!.querySelector('msup');
    expect(msup).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
    expect(msup!.children[1]!.textContent).toBe('n');
  });

  it('treats m:subHide m:val="true" as ON for empty-limit suppression (§22.9.2.7)', () => {
    // Empty m:sub + subHide m:val="true" → hidden (regression anchor for commit 2bd58d3).
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:subHide', attributes: { 'm:val': 'true' } }],
            },
            { name: 'm:sub', elements: [] },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'f' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
    expect(result!.querySelector('msup')).not.toBeNull();
  });

  it('treats bare <m:subHide/> as ON for empty-limit suppression (§22.9.2.7)', () => {
    // Empty m:sub + bare <m:subHide/> (no attrs) → hidden.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:subHide' }],
            },
            { name: 'm:sub', elements: [] },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'f' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
    expect(result!.querySelector('msup')).not.toBeNull();
  });

  it('ignores m:ctrlPr when checking for meaningful sub/sup content (Word emits empty-with-ctrlPr)', () => {
    // Word emits <m:sub><m:ctrlPr>...</m:ctrlPr></m:sub> for empty limits — treat as empty.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [
                { name: 'm:subHide', attributes: { 'm:val': '1' } },
                { name: 'm:supHide', attributes: { 'm:val': '1' } },
              ],
            },
            { name: 'm:sub', elements: [{ name: 'm:ctrlPr', elements: [] }] },
            { name: 'm:sup', elements: [{ name: 'm:ctrlPr', elements: [] }] },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'f' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
    expect(result!.querySelector('msup')).toBeNull();
    expect(result!.querySelector('msub')).toBeNull();
    // Bare <mo> only
    expect(result!.querySelector('mo')!.textContent).toBe('\u222B');
  });

  it('indefinite integral (no m:sub/m:sup, no hide flags) → bare <mo>', () => {
    // §22.1.2.70: m:sub/m:sup are optional. When absent, no subscript/superscript should be rendered.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:chr', attributes: { 'm:val': '\u222B' } }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'f(x)dx' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
    expect(result!.querySelector('msub')).toBeNull();
    expect(result!.querySelector('msup')).toBeNull();
    const mo = result!.querySelector('mo');
    expect(mo).not.toBeNull();
    expect(mo!.textContent).toBe('\u222B');
    expect(result!.textContent).toContain('f(x)dx');
  });

  it('summation without m:limLoc defaults to <munderover> (§22.1.2.53 + operator heuristic)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:chr', attributes: { 'm:val': '\u2211' } }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i=1' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('munderover')).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
  });

  it('<m:limLoc/> with no val attribute defaults to undOvr (§22.1.2.53)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:chr', attributes: { 'm:val': '\u2211' } }, { name: 'm:limLoc' }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i=1' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('munderover')).not.toBeNull();
    expect(result!.querySelector('msubsup')).toBeNull();
  });

  it('integral without m:limLoc keeps subSup (operator heuristic)', () => {
    // Integrals default to side-limits; only non-integrals default to under/over when limLoc is absent.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:chr', attributes: { 'm:val': '\u222B' } }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '0' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'f' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('msubsup')).not.toBeNull();
    expect(result!.querySelector('munderover')).toBeNull();
  });

  it('suppresses operator growth when m:grow m:val="0" (§22.1.2.72)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [
                { name: 'm:chr', attributes: { 'm:val': '\u2211' } },
                { name: 'm:grow', attributes: { 'm:val': '0' } },
              ],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i=1' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mo = result!.querySelector('mo');
    expect(mo).not.toBeNull();
    expect(mo!.getAttribute('largeop')).toBe('false');
    expect(mo!.getAttribute('stretchy')).toBe('false');
  });

  it('leaves operator growth to MathML defaults when m:grow is absent or ON', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:chr', attributes: { 'm:val': '\u2211' } }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i=1' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'n' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'i' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mo = result!.querySelector('mo');
    expect(mo).not.toBeNull();
    // No explicit largeop/stretchy — rely on operator dictionary defaults
    expect(mo!.hasAttribute('largeop')).toBe(false);
    expect(mo!.hasAttribute('stretchy')).toBe(false);
  });

  it('<m:chr/> with no val means "no character" (§22.1.2.20)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:nary',
          elements: [
            {
              name: 'm:naryPr',
              elements: [{ name: 'm:chr' }, { name: 'm:limLoc', attributes: { 'm:val': 'undOvr' } }],
            },
            {
              name: 'm:sub',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
            {
              name: 'm:sup',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mo = result!.querySelector('mo');
    expect(mo).not.toBeNull();
    expect(mo!.textContent).toBe('');
  });
});

describe('m:phant converter', () => {
  it('renders phantom with no properties as visible (m:show default)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:phant',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('mphantom')).toBeNull();
    expect(result!.textContent).toBe('x');
  });

  it('hides content when m:show has m:val="0"', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:phant',
          elements: [
            {
              name: 'm:phantPr',
              elements: [{ name: 'm:show', attributes: { 'm:val': '0' } }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mphantom = result!.querySelector('mphantom');
    expect(mphantom).not.toBeNull();
    expect(mphantom!.textContent).toBe('x');
  });

  it('converts visible phantom with zeroed width to <mpadded width="0">', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:phant',
          elements: [
            {
              name: 'm:phantPr',
              elements: [
                { name: 'm:show', attributes: { 'm:val': '1' } },
                { name: 'm:zeroWid', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mpadded = result!.querySelector('mpadded');
    expect(mpadded).not.toBeNull();
    expect(mpadded!.getAttribute('width')).toBe('0');
    expect(mpadded!.textContent).toBe('y');
  });

  it('treats bare <m:show/> (no attributes) as visible', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:phant',
          elements: [
            {
              name: 'm:phantPr',
              elements: [{ name: 'm:show' }, { name: 'm:zeroWid', attributes: { 'm:val': '1' } }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'v' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mpadded = result!.querySelector('mpadded');
    expect(mpadded).not.toBeNull();
    expect(mpadded!.getAttribute('width')).toBe('0');
    const mphantom = mpadded!.querySelector('mphantom');
    expect(mphantom).toBeNull();
    expect(mpadded!.textContent).toBe('v');
  });

  it('renders visible phantom with zeroed ascent as <mpadded height="0"> without hiding', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:phant',
          elements: [
            {
              name: 'm:phantPr',
              elements: [{ name: 'm:zeroAsc', attributes: { 'm:val': '1' } }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'z' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mpadded = result!.querySelector('mpadded');
    expect(mpadded).not.toBeNull();
    expect(mpadded!.getAttribute('height')).toBe('0');
    expect(mpadded!.querySelector('mphantom')).toBeNull();
    expect(mpadded!.textContent).toBe('z');
  });

  it('renders invisible phantom with m:show="0" and zeroed height as <mpadded> wrapping <mphantom>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:phant',
          elements: [
            {
              name: 'm:phantPr',
              elements: [
                { name: 'm:show', attributes: { 'm:val': '0' } },
                { name: 'm:zeroAsc', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'z' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mpadded = result!.querySelector('mpadded');
    expect(mpadded).not.toBeNull();
    expect(mpadded!.getAttribute('height')).toBe('0');
    expect(mpadded!.querySelector('mphantom')).not.toBeNull();
  });
});

describe('m:groupChr converter', () => {
  it('converts bottom underbrace to <munder> with default character', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:groupChr',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    expect(munder!.children[0]!.textContent).toBe('x');
    const groupMo = munder!.children[1] as Element;
    expect(groupMo.localName).toBe('mo');
    expect(groupMo.textContent).toBe('\u23DF');
  });

  it('hides the group character when m:chr is present without m:val', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:groupChr',
          elements: [
            {
              name: 'm:groupChrPr',
              elements: [{ name: 'm:chr' }],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const munder = result!.querySelector('munder');
    expect(munder).not.toBeNull();
    const mo = munder!.querySelector('mo');
    expect(mo!.textContent).toBe('');
  });

  it('converts top overbrace to <mover>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:groupChr',
          elements: [
            {
              name: 'm:groupChrPr',
              elements: [
                { name: 'm:chr', attributes: { 'm:val': '\u23DE' } },
                { name: 'm:pos', attributes: { 'm:val': 'top' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mover = result!.querySelector('mover');
    expect(mover).not.toBeNull();
    expect(mover!.children[0]!.textContent).toBe('y');
    const mo = mover!.querySelector('mo');
    expect(mo!.textContent).toBe('\u23DE');
  });

  describe('m:vertJc baseline alignment', () => {
    const buildGroupChr = (props: Array<{ name: string; attributes?: Record<string, string> }>) => ({
      name: 'm:oMath',
      elements: [
        {
          name: 'm:groupChr',
          elements: [
            { name: 'm:groupChrPr', elements: props },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    });

    it('applies no shift when m:vertJc is absent (natural layout)', () => {
      const omml = buildGroupChr([
        { name: 'm:chr', attributes: { 'm:val': '\u23DE' } },
        { name: 'm:pos', attributes: { 'm:val': 'top' } },
      ]);
      const mover = convertOmmlToMathml(omml, doc)!.querySelector('mover')!;
      expect(mover.getAttribute('style')).toBeNull();
      expect(mover.getAttribute('data-vert-jc')).toBeNull();
    });

    it('pos=top, vertJc=bot renders natural mover without shift', () => {
      const omml = buildGroupChr([
        { name: 'm:chr', attributes: { 'm:val': '\u23DE' } },
        { name: 'm:pos', attributes: { 'm:val': 'top' } },
        { name: 'm:vertJc', attributes: { 'm:val': 'bot' } },
      ]);
      const mover = convertOmmlToMathml(omml, doc)!.querySelector('mover')!;
      expect(mover.getAttribute('data-vert-jc')).toBe('bot');
      expect(mover.getAttribute('style')).toBeNull();
    });

    it('pos=bot, vertJc=top renders natural munder without shift', () => {
      const omml = buildGroupChr([
        { name: 'm:chr', attributes: { 'm:val': '\u23DF' } },
        { name: 'm:pos', attributes: { 'm:val': 'bot' } },
        { name: 'm:vertJc', attributes: { 'm:val': 'top' } },
      ]);
      const munder = convertOmmlToMathml(omml, doc)!.querySelector('munder')!;
      expect(munder.getAttribute('data-vert-jc')).toBe('top');
      expect(munder.getAttribute('style')).toBeNull();
    });

    it('pos=top, vertJc=top shifts the construct down', () => {
      const omml = buildGroupChr([
        { name: 'm:chr', attributes: { 'm:val': '\u23DE' } },
        { name: 'm:pos', attributes: { 'm:val': 'top' } },
        { name: 'm:vertJc', attributes: { 'm:val': 'top' } },
      ]);
      const mover = convertOmmlToMathml(omml, doc)!.querySelector('mover')!;
      expect(mover.getAttribute('data-vert-jc')).toBe('top');
      expect(mover.getAttribute('style')).toContain('top: 1em');
    });

    it('pos=bot, vertJc=bot shifts the construct up', () => {
      const omml = buildGroupChr([
        { name: 'm:chr', attributes: { 'm:val': '\u23DF' } },
        { name: 'm:pos', attributes: { 'm:val': 'bot' } },
        { name: 'm:vertJc', attributes: { 'm:val': 'bot' } },
      ]);
      const munder = convertOmmlToMathml(omml, doc)!.querySelector('munder')!;
      expect(munder.getAttribute('data-vert-jc')).toBe('bot');
      expect(munder.getAttribute('style')).toContain('top: -1em');
    });

    it('vertJc present without m:val defaults to "bot"', () => {
      const omml = buildGroupChr([
        { name: 'm:chr', attributes: { 'm:val': '\u23DE' } },
        { name: 'm:pos', attributes: { 'm:val': 'top' } },
        { name: 'm:vertJc' },
      ]);
      const mover = convertOmmlToMathml(omml, doc)!.querySelector('mover')!;
      expect(mover.getAttribute('data-vert-jc')).toBe('bot');
      expect(mover.getAttribute('style')).toBeNull();
    });
  });
});

describe('m:m converter', () => {
  it('converts 2x2 matrix to <mtable> with <mtr> and <mtd>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:m',
          elements: [
            {
              name: 'm:mr',
              elements: [
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
                },
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
                },
              ],
            },
            {
              name: 'm:mr',
              elements: [
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'c' }] }] }],
                },
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'd' }] }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const mtable = result!.querySelector('mtable');
    expect(mtable).not.toBeNull();
    const rows = mtable!.querySelectorAll('mtr');
    expect(rows.length).toBe(2);
    const cells = mtable!.querySelectorAll('mtd');
    expect(cells.length).toBe(4);
    expect(cells[0]!.textContent).toBe('a');
    expect(cells[1]!.textContent).toBe('b');
    expect(cells[2]!.textContent).toBe('c');
    expect(cells[3]!.textContent).toBe('d');
  });

  it('returns null for empty matrix', () => {
    const omml = {
      name: 'm:oMath',
      elements: [{ name: 'm:m', elements: [] }],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).toBeNull();
  });

  it('converts 1x3 row vector', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:m',
          elements: [
            {
              name: 'm:mr',
              elements: [
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '1' }] }] }],
                },
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '2' }] }] }],
                },
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '3' }] }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mtable = result!.querySelector('mtable');
    expect(mtable).not.toBeNull();
    const rows = mtable!.querySelectorAll('mtr');
    expect(rows.length).toBe(1);
    const cells = mtable!.querySelectorAll('mtd');
    expect(cells.length).toBe(3);
  });

  it('wraps each cell content in <mrow> inside <mtd>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:m',
          elements: [
            {
              name: 'm:mr',
              elements: [
                {
                  name: 'm:e',
                  elements: [
                    { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] },
                    { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '+' }] }] },
                    { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mtd = result!.querySelector('mtd');
    expect(mtd).not.toBeNull();
    // Cell content sits under an <mrow>, not as direct <mtd> siblings.
    expect(mtd!.children.length).toBe(1);
    expect(mtd!.firstElementChild!.localName).toBe('mrow');
    expect(mtd!.textContent).toBe('x+y');
  });

  it('preserves nested math objects in cells (fraction, superscript)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:m',
          elements: [
            {
              name: 'm:mr',
              elements: [
                {
                  name: 'm:e',
                  elements: [
                    {
                      name: 'm:f',
                      elements: [
                        {
                          name: 'm:num',
                          elements: [
                            { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] },
                          ],
                        },
                        {
                          name: 'm:den',
                          elements: [
                            { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  name: 'm:e',
                  elements: [
                    {
                      name: 'm:sSup',
                      elements: [
                        {
                          name: 'm:e',
                          elements: [
                            { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'z' }] }] },
                          ],
                        },
                        {
                          name: 'm:sup',
                          elements: [
                            { name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '2' }] }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mtable = result!.querySelector('mtable');
    expect(mtable!.querySelector('mtd mfrac')).not.toBeNull();
    expect(mtable!.querySelector('mtd msup')).not.toBeNull();
  });

  it('renders a placeholder in empty <m:e> cells by default (§22.1.2.83 plcHide="0")', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:m',
          elements: [
            {
              name: 'm:mr',
              elements: [
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
                },
                { name: 'm:e' },
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'c' }] }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const cells = result!.querySelectorAll('mtd');
    expect(cells.length).toBe(3);
    expect(cells[0]!.textContent).toBe('a');
    expect(cells[1]!.textContent).toBe('\u25A1');
    expect(cells[2]!.textContent).toBe('c');
  });

  it('hides empty-cell placeholders when m:plcHide is set (§22.1.2.83)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:m',
          elements: [
            { name: 'm:mPr', elements: [{ name: 'm:plcHide', attributes: { 'm:val': '1' } }] },
            {
              name: 'm:mr',
              elements: [
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
                },
                { name: 'm:e' },
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'c' }] }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const cells = result!.querySelectorAll('mtd');
    expect(cells.length).toBe(3);
    expect(cells[1]!.textContent).toBe('');
  });

  it('ignores m:mPr properties element', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:m',
          elements: [
            {
              name: 'm:mPr',
              elements: [
                {
                  name: 'm:mcs',
                  elements: [
                    {
                      name: 'm:mc',
                      elements: [{ name: 'm:mcPr', elements: [{ name: 'm:count', attributes: { 'm:val': '2' } }] }],
                    },
                  ],
                },
              ],
            },
            {
              name: 'm:mr',
              elements: [
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
                },
                {
                  name: 'm:e',
                  elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'b' }] }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const mtable = result!.querySelector('mtable');
    expect(mtable).not.toBeNull();
    const cells = mtable!.querySelectorAll('mtd');
    expect(cells.length).toBe(2);
    expect(mtable!.textContent).toBe('ab');
  });
});
describe('m:box converter', () => {
  it('converts m:box to <mrow>', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:box',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('mrow')).not.toBeNull();
    expect(result!.textContent).toBe('x');
  });

  it('returns null for empty m:box', () => {
    const omml = {
      name: 'm:oMath',
      elements: [{ name: 'm:box', elements: [] }],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).toBeNull();
  });

  it('drops m:boxPr children (opEmu / noBreak / aln / diff are not yet mapped)', () => {
    // Pins current scope: we render <mrow> and silently ignore boxPr semantics.
    // When opEmu or noBreak grow real MathML mappings, this test should fail
    // and be updated — that failure is the point.
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:box',
          elements: [
            {
              name: 'm:boxPr',
              elements: [
                { name: 'm:opEmu', attributes: { 'm:val': '1' } },
                { name: 'm:noBreak', attributes: { 'm:val': '1' } },
                { name: 'm:aln' },
                { name: 'm:diff', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: '==' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    expect(result!.querySelector('mrow')).not.toBeNull();
    expect(result!.querySelector('menclose')).toBeNull();
    expect(result!.textContent).toBe('==');
  });
});

describe('m:borderBox converter', () => {
  it('converts m:borderBox to <menclose notation="box"> by default', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:borderBox',
          elements: [
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'E' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result).not.toBeNull();
    const menclose = result!.querySelector('menclose');
    expect(menclose).not.toBeNull();
    expect(menclose!.getAttribute('notation')).toBe('box');
    expect(menclose!.textContent).toBe('E');
  });

  it('hides top and bottom sides (notation="left right")', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:borderBox',
          elements: [
            {
              name: 'm:borderBoxPr',
              elements: [
                { name: 'm:hideTop', attributes: { 'm:val': '1' } },
                { name: 'm:hideBot', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const menclose = result!.querySelector('menclose');
    expect(menclose).not.toBeNull();
    // Exact string — production order is top/bottom/left/right, so a side-swap regression fails here.
    expect(menclose!.getAttribute('notation')).toBe('left right');
  });

  it('adds strike notations', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:borderBox',
          elements: [
            {
              name: 'm:borderBoxPr',
              elements: [
                { name: 'm:hideTop', attributes: { 'm:val': '1' } },
                { name: 'm:hideBot', attributes: { 'm:val': '1' } },
                { name: 'm:hideLeft', attributes: { 'm:val': '1' } },
                { name: 'm:hideRight', attributes: { 'm:val': '1' } },
                { name: 'm:strikeH', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const menclose = result!.querySelector('menclose');
    expect(menclose).not.toBeNull();
    expect(menclose!.getAttribute('notation')).toBe('horizontalstrike');
  });

  it('falls back to <mrow> when all borders hidden and no strikes', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:borderBox',
          elements: [
            {
              name: 'm:borderBoxPr',
              elements: [
                { name: 'm:hideTop', attributes: { 'm:val': '1' } },
                { name: 'm:hideBot', attributes: { 'm:val': '1' } },
                { name: 'm:hideLeft', attributes: { 'm:val': '1' } },
                { name: 'm:hideRight', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'q' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    const menclose = result!.querySelector('menclose');
    expect(menclose).toBeNull();
    expect(result!.textContent).toBe('q');
  });

  // ── ST_OnOff variants (ECMA-376 §22.9.2.7) ────────────────────────────────
  // isOn accepts "1", "true", "on", and bare tags; rejects "0" / "false" / "off".
  // Annex L.6.1.3 itself uses m:val="on" even though the normative enum is {0,1,true,false}.

  const makeBorderBox = (hideTopFlag: Record<string, unknown>) => ({
    name: 'm:oMath',
    elements: [
      {
        name: 'm:borderBox',
        elements: [
          { name: 'm:borderBoxPr', elements: [{ name: 'm:hideTop', ...hideTopFlag }] },
          {
            name: 'm:e',
            elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
          },
        ],
      },
    ],
  });

  it('treats m:val="true" as on (ST_OnOff)', () => {
    const result = convertOmmlToMathml(makeBorderBox({ attributes: { 'm:val': 'true' } }), doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe('bottom left right');
  });

  it('treats m:val="on" as on (Annex L.6.1.3 form)', () => {
    const result = convertOmmlToMathml(makeBorderBox({ attributes: { 'm:val': 'on' } }), doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe('bottom left right');
  });

  it('treats bare <m:hideTop/> as on (spec default val=1)', () => {
    const result = convertOmmlToMathml(makeBorderBox({}), doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe('bottom left right');
  });

  it('treats m:val="0" as off (top remains visible)', () => {
    const result = convertOmmlToMathml(makeBorderBox({ attributes: { 'm:val': '0' } }), doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe('box');
  });

  it('treats m:val="false" as off', () => {
    const result = convertOmmlToMathml(makeBorderBox({ attributes: { 'm:val': 'false' } }), doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe('box');
  });

  // ── Strike directions ─────────────────────────────────────────────────────
  // BLTR (bottom-left → top-right = "/") maps to updiagonalstrike.
  // TLBR (top-left → bottom-right = "\") maps to downdiagonalstrike.
  // The directional naming is counter-intuitive — these tests pin it.

  const makeStrike = (strikeName: string) => ({
    name: 'm:oMath',
    elements: [
      {
        name: 'm:borderBox',
        elements: [
          {
            name: 'm:borderBoxPr',
            elements: [
              { name: 'm:hideTop', attributes: { 'm:val': '1' } },
              { name: 'm:hideBot', attributes: { 'm:val': '1' } },
              { name: 'm:hideLeft', attributes: { 'm:val': '1' } },
              { name: 'm:hideRight', attributes: { 'm:val': '1' } },
              { name: strikeName, attributes: { 'm:val': '1' } },
            ],
          },
          {
            name: 'm:e',
            elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
          },
        ],
      },
    ],
  });

  it('maps m:strikeBLTR to notation="updiagonalstrike" (/ direction)', () => {
    const result = convertOmmlToMathml(makeStrike('m:strikeBLTR'), doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe('updiagonalstrike');
  });

  it('maps m:strikeTLBR to notation="downdiagonalstrike" (\\ direction)', () => {
    const result = convertOmmlToMathml(makeStrike('m:strikeTLBR'), doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe('downdiagonalstrike');
  });

  it('maps m:strikeV to notation="verticalstrike"', () => {
    const result = convertOmmlToMathml(makeStrike('m:strikeV'), doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe('verticalstrike');
  });

  it('combines multiple strikes in a fixed order', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:borderBox',
          elements: [
            {
              name: 'm:borderBoxPr',
              elements: [
                { name: 'm:strikeBLTR', attributes: { 'm:val': '1' } },
                { name: 'm:strikeH', attributes: { 'm:val': '1' } },
                { name: 'm:strikeTLBR', attributes: { 'm:val': '1' } },
                { name: 'm:strikeV', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe(
      'box updiagonalstrike horizontalstrike downdiagonalstrike verticalstrike',
    );
  });

  it('combines partial hide flags with a strike (hideTop + strikeH)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:borderBox',
          elements: [
            {
              name: 'm:borderBoxPr',
              elements: [
                { name: 'm:hideTop', attributes: { 'm:val': '1' } },
                { name: 'm:strikeH', attributes: { 'm:val': '1' } },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'a' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    expect(result!.querySelector('menclose')!.getAttribute('notation')).toBe('bottom left right horizontalstrike');
  });

  it('returns null when m:e is empty (no bordered-but-empty <menclose>)', () => {
    const omml = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:borderBox',
          elements: [{ name: 'm:borderBoxPr', elements: [{ name: 'm:strikeH', attributes: { 'm:val': '1' } }] }],
        },
      ],
    };
    const result = convertOmmlToMathml(omml, doc);
    // oMath still renders but has no children because borderBox dropped itself.
    expect(result).toBeNull();
  });
});

describe('SD-6495 pending Word math run revisions', () => {
  it('paints both pending branches with their insertion/deletion meaning', () => {
    const revision = (kind: string, text: string, id: string) => ({
      name: 'm:r',
      elements: [
        {
          name: `w:${kind}`,
          attributes: { 'w:id': id, 'w:author': 'Editor' },
          elements: [{ name: 'm:t', elements: [{ type: 'text', text }] }],
        },
      ],
    });
    const input = { name: 'm:oMath', elements: [revision('del', 'x+1', '1'), revision('ins', 'y=2', '2')] };
    const result = convertOmmlToMathml(input, createTestDocument());
    expect(result?.textContent).toBe('x+1y=2');
    expect(result?.querySelector('.track-delete-dec')?.textContent).toBe('x+1');
    expect(result?.querySelector('.track-insert-dec')?.textContent).toBe('y=2');
  });
  it('preserves ordinary segments, revision attribution, run styling and input JSON', () => {
    const input = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:r',
          elements: [
            { name: 'm:rPr', elements: [{ name: 'm:sty', attributes: { 'm:val': 'b' } }] },
            { name: 'm:t', elements: [{ type: 'text', text: 'a' }] },
            {
              name: 'w:del',
              attributes: { 'w:id': '7', 'w:author': 'Reviewer', 'w:date': '2026-10-28T00:00:00Z' },
              elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x+1' }] }],
            },
            { name: 'm:t', elements: [{ type: 'text', text: '=' }] },
            {
              name: 'w:ins',
              attributes: { 'w:id': '8' },
              elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'y' }] }],
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(input);
    const result = convertOmmlToMathml(input, createTestDocument())!;
    expect(result.textContent).toBe('ax+1=y');
    const deleted = result.querySelector('.track-delete-dec')!;
    expect(deleted.classList.contains('highlighted')).toBe(true);
    expect(deleted.getAttribute('data-track-change-id')).toBe('7');
    expect(deleted.getAttribute('data-track-change-kind')).toBe('delete');
    expect(deleted.getAttribute('data-track-change-author')).toBe('Reviewer');
    expect(deleted.getAttribute('data-track-change-date')).toBe('2026-10-28T00:00:00Z');
    expect(
      Array.from(result.querySelectorAll('mi,mo,mn')).every((atom) => atom.getAttribute('mathvariant') === 'bold'),
    ).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps function identifiers grouped inside selected revision segments', () => {
    const input = {
      name: 'm:oMath',
      elements: [
        {
          name: 'm:func',
          elements: [
            {
              name: 'm:fName',
              elements: [
                {
                  name: 'm:r',
                  elements: [
                    { name: 'w:del', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'sin' }] }] },
                    { name: 'w:ins', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'cos' }] }] },
                  ],
                },
              ],
            },
            {
              name: 'm:e',
              elements: [{ name: 'm:r', elements: [{ name: 'm:t', elements: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ],
    };
    const result = convertOmmlToMathml(input, createTestDocument())!;
    expect(result.querySelector('.track-delete-dec mi')?.textContent).toBe('sin');
    expect(result.querySelector('.track-insert-dec mi')?.textContent).toBe('cos');
    expect(result.querySelector('.track-insert-dec mi')?.getAttribute('mathvariant')).toBe('normal');
  });
});
