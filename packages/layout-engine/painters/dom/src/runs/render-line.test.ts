import { describe, expect, it } from 'vite-plus/test';
import type { Line, ParagraphAttrs, ParagraphBlock, Run, TextRun } from '@superdoc/contracts';
import { resolvePhysicalFamily } from '@superdoc/font-system';
import { renderLine } from './render-line.js';
import type { RunRenderContext } from './types.js';

const makeRunContext = (overrides: Partial<RunRenderContext> = {}): RunRenderContext => ({
  doc: document,
  layoutEpoch: 0,
  showFormattingMarks: false,
  contentControlsChrome: 'default',
  resolvePhysical: (family) => family,
  pendingTooltips: new WeakMap<HTMLElement, string>(),
  getNextLinkId: () => 'link-1',
  applySdtDataset: () => {},
  buildImageHyperlinkAnchor: (child) => child,
  resolveTrackedChangesConfig: () => ({ mode: 'final', enabled: false }),
  applyTrackedChangeDecorations: () => {},
  resolveRunSdtId: () => null,
  createInlineSdtWrapper: () => document.createElement('span'),
  syncInlineSdtWrapperTypography: () => {},
  expandSdtWrapperPmRange: () => {},
  ...overrides,
});

describe('renderLine native text baselines beside expanding images', () => {
  const text = (value: string, overrides: Partial<TextRun> = {}): TextRun => ({
    kind: 'text',
    text: value,
    fontFamily: 'Arial',
    fontSize: 16,
    ...overrides,
  });
  const image: Run = { kind: 'image', src: 'image.png', width: 31, height: 100, pmStart: 5, pmEnd: 6 };
  const paint = (
    runs: Run[],
    lineOverrides: Partial<Line> = {},
    context = makeRunContext(),
    attrs?: ParagraphAttrs,
  ) => {
    const last = runs[runs.length - 1]!;
    return renderLine({
      block: { kind: 'paragraph', id: 'script-image', runs, attrs },
      line: {
        fromRun: 0,
        fromChar: 0,
        toRun: runs.length - 1,
        toChar: 'text' in last ? (last.text?.length ?? 0) : 0,
        width: 120,
        maxWidth: 200,
        ascent: 100,
        descent: 0,
        lineHeight: 100,
        ...lineOverrides,
      },
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: context,
    });
  };

  it.each(['subscript', 'superscript'] as const)(
    'keeps %s leaves and native base typography in one group',
    (vertAlign) => {
      const line = paint([
        text('Base', { pmStart: 1, pmEnd: 5 }),
        image,
        text('C', { pmStart: 6, pmEnd: 7 }),
        text('123', { vertAlign, fontSize: 10.4, pmStart: 7, pmEnd: 10 }),
        text('D', { pmStart: 10, pmEnd: 11 }),
      ]);
      const groups = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-inline-text-group'));
      expect(groups.map((group) => group.textContent)).toEqual(['Base', 'C123D']);
      for (const group of groups) {
        expect(group.style.display).toBe('inline-block');
        expect(group.style.verticalAlign).toBe('bottom');
        expect(group.style.fontSize).toBe('0px');
        expect(group.style.lineHeight).toBe('normal');
        expect(group.hasAttribute('data-pm-start')).toBe(false);
        expect(group.hasAttribute('data-layout-epoch')).toBe(false);
      }
      const leaves = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run'));
      expect(leaves[1]?.style.verticalAlign).toBe('');
      for (const leaf of leaves) expect(leaf.style.lineHeight).toBe('0');
      expect(leaves[2]?.style.verticalAlign).toBe('baseline');
      expect(leaves[2]?.style.top).toBe(vertAlign === 'subscript' ? '2.24px' : '-5.28px');
      expect(leaves[2]?.dataset.pmStart).toBe('7');
      expect(leaves[2]?.dataset.pmEnd).toBe('10');
    },
  );

  it('lets only the base-font strut set group extents when glyph fonts fall back', () => {
    const line = paint([text('Base'), image, text('𝒜'), text('C'), text('D')]);
    const groups = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-inline-text-group'));
    expect(groups.map((group) => group.textContent)).toEqual(['Base', '𝒜CD']);
    for (const group of groups) {
      expect(group.style.getPropertyValue('--sd-inline-text-base-size')).toBe('16px');
      for (const leaf of group.querySelectorAll<HTMLElement>('.superdoc-text-run')) {
        expect(leaf.style.lineHeight).toBe('0');
        expect(leaf.style.fontSize).toBe('16px');
        expect(leaf.style.verticalAlign).toBe('');
      }
    }
  });

  it('preserves native leaf extents for authored reflections beside an expanding image', () => {
    const line = paint([
      text('Base'),
      image,
      text('ACME', {
        pmStart: 6,
        pmEnd: 10,
        textEffects: {
          reflection: {
            blurRadius: 0,
            distance: 0,
            direction: 90,
            startAlpha: 1,
            startPosition: 0,
            endAlpha: 1,
            endPosition: 1,
            scaleX: 1,
            scaleY: -1,
          },
        },
      }),
      text('C'),
      text('D'),
    ]);
    expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
    const leaves = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run'));
    for (const leaf of leaves) {
      expect(leaf.parentElement).toBe(line);
      expect(leaf.style.lineHeight).toBe('normal');
      expect(leaf.style.verticalAlign).toBe('bottom');
    }
    expect(leaves[1].dataset.pmStart).toBe('6');
    expect(leaves[1].dataset.pmEnd).toBe('10');
  });

  it('gives a script-only region a base-font strut in its uniform authored face', () => {
    const line = paint([
      image,
      text('1', { vertAlign: 'superscript', fontSize: 10.4, bold: true, italic: true, color: '#123456' }),
      text('base', { bold: true, italic: true }),
    ]);
    const group = line.querySelector<HTMLElement>('.superdoc-inline-text-group')!;
    expect(group.style.getPropertyValue('--sd-inline-text-base-size')).toBe('16px');
    expect(group.style.fontFamily).toBeTruthy();
    expect(group.style.fontWeight).toBe('bold');
    expect(group.style.fontStyle).toBe('italic');
    expect(group.style.color).toBe('');
    expect(group.textContent).toBe('1base');
    expect(group.children).toHaveLength(2);
    const leaves = group.querySelectorAll<HTMLElement>('.superdoc-text-run');
    expect(leaves[0].style.fontWeight).toBe('bold');
    expect(leaves[1].style.fontWeight).toBe('bold');
    expect(leaves[1].style.fontStyle).toBe('italic');
  });

  it('preserves authored script face and color when mixed faces retain the native path', () => {
    const line = paint([
      image,
      text('1', { vertAlign: 'superscript', fontSize: 10.4, bold: true, italic: true, color: '#123456' }),
      text('base'),
    ]);
    expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
    const leaves = line.querySelectorAll<HTMLElement>('.superdoc-text-run');
    expect(leaves[0].style.fontWeight).toBe('bold');
    expect(leaves[0].style.fontStyle).toBe('italic');
    expect(leaves[0].style.color).toBe('#123456');
    expect(leaves[0].style.verticalAlign).toBe('5.28px');
    expect(leaves[1].style.fontWeight).toBe('');
    expect(leaves[1].style.fontStyle).toBe('');
  });

  it.each([
    { firstScript: false, scriptSize: (44 * 4 * 0.65) / 3 },
    { firstScript: true, scriptSize: 18 * (4 / 3) * 0.65 },
  ])(
    'retains native ordinary baselines for mixed authored sizes, first script=$firstScript',
    ({ firstScript, scriptSize }) => {
      const base = text('C', { fontSize: (11 * 4) / 3 });
      const script = text('123', { vertAlign: 'subscript', fontSize: scriptSize });
      const line = paint([
        text('Base', { fontSize: (11 * 4) / 3 }),
        image,
        ...(firstScript ? [script, base] : [base, script]),
        text('D', { fontSize: (11 * 4) / 3 }),
      ]);
      expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
      const leaves = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run'));
      for (const leaf of leaves) expect(leaf.parentElement).toBe(line);
      expect(leaves.find((leaf) => leaf.textContent === 'C')?.style.verticalAlign).toBe('bottom');
      expect(leaves.find((leaf) => leaf.textContent === '123')?.style.top).toBe('');
    },
  );

  it.each([false, true])(
    'retains native ordinary baselines for mixed resolved families, first script=%s',
    (firstScript) => {
      const base = text('C');
      const script = text('123', { vertAlign: 'subscript', fontSize: 10.4, fontFamily: 'Calibri' });
      const line = paint([text('Base'), image, ...(firstScript ? [script, base] : [base, script]), text('D')]);
      expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
      const leaves = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run'));
      expect(leaves.find((leaf) => leaf.textContent === 'C')?.style.verticalAlign).toBe('bottom');
      expect(leaves.find((leaf) => leaf.textContent === '123')?.style.top).toBe('');
    },
  );

  it('keeps logical and physical aliases eligible when they resolve to the same font stack', () => {
    const line = paint(
      [
        text('Base', { fontFamily: 'Cambria, serif' }),
        image,
        text('1', { vertAlign: 'subscript', fontSize: 10.4, fontFamily: 'Caladea, serif' }),
        text('C', { fontFamily: 'Cambria, serif' }),
      ],
      {},
      makeRunContext({ resolvePhysical: resolvePhysicalFamily }),
    );
    expect(line.querySelectorAll('.superdoc-inline-text-group')).toHaveLength(2);
  });

  it.each([{ bold: true }, { italic: true }, { bold: true, italic: true }])(
    'retains native ordinary baselines for different faces in the same resolved family: %j',
    (face) => {
      const resolvedFaces: unknown[] = [];
      const line = paint(
        [text('Base'), image, text('123', face), text('C'), text('D')],
        {},
        makeRunContext({
          resolvePhysical: (_family, options) => {
            resolvedFaces.push(options);
            return 'TeX Gyre Bonum, sans-serif';
          },
        }),
      );
      expect(resolvedFaces).toContainEqual({
        weight: face.bold ? '700' : '400',
        style: face.italic ? 'italic' : 'normal',
      });
      expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
      const leaves = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run'));
      expect(leaves.find((leaf) => leaf.textContent === 'C')?.style.verticalAlign).toBe('bottom');
      expect(leaves.find((leaf) => leaf.textContent === '123')?.style.fontWeight).toBe(face.bold ? 'bold' : '');
      expect(leaves.find((leaf) => leaf.textContent === '123')?.style.fontStyle).toBe(face.italic ? 'italic' : '');
    },
  );

  it('uses the document face resolver when comparing group font families', () => {
    const line = paint(
      [text('Base'), image, text('1', { vertAlign: 'subscript', fontSize: 10.4, italic: true }), text('C')],
      {},
      makeRunContext({ resolvePhysical: (family, face) => (face.style === 'italic' ? 'Other face' : family) }),
    );
    expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
  });

  it('ignores vanished, empty, and zero-size carriers when comparing native base typography', () => {
    const line = paint([
      text('Base', { fontSize: 14.6666667 }),
      image,
      text('hidden', { vanish: true, fontSize: 80, fontFamily: 'Calibri', bold: true, italic: true }),
      text('', { fontSize: 80, fontFamily: 'Calibri', bold: true, italic: true }),
      text('marker', { fontSize: 0, fontFamily: 'Calibri', bold: true, italic: true }),
      text('1', { vertAlign: 'subscript', fontSize: 14.6666667 * 0.65 }),
      text('D', { fontSize: (11 * 4) / 3 }),
    ]);
    expect(line.querySelectorAll('.superdoc-inline-text-group')).toHaveLength(2);
    const script = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run')).find(
      (leaf) => leaf.textContent === '1',
    );
    expect(script?.style.verticalAlign).toBe('baseline');
  });

  it.each([{ fontSize: 40 }, { fontFamily: 'Calibri' }, { bold: true }, { italic: true }])(
    'includes a visible tracked paragraph mark when comparing native base typography: %j',
    (typography) => {
      const line = paint(
        [
          text('Base'),
          image,
          text('\u200B', {
            vanish: true,
            ...typography,
            dataAttrs: { 'data-paragraph-mark-deletion-anchor': 'true' },
            trackedChange: { id: 'mark', kind: 'delete' },
          }),
          text('C'),
          text('1', { vertAlign: 'subscript', fontSize: 10.4 }),
        ],
        {},
        makeRunContext({
          showFormattingMarks: true,
          resolveTrackedChangesConfig: () => ({ enabled: true, mode: 'final' }),
        }),
      );
      expect(line.querySelector('.superdoc-tracked-paragraph-mark')?.textContent).toBe('¶');
      expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
    },
  );

  it.each([
    { name: 'RTL paragraph', attrs: { directionContext: { inlineDirection: 'rtl' as const } }, run: text('C') },
    { name: 'explicit RTL run', attrs: undefined, run: text('C', { bidi: { rtl: true } }) },
    { name: 'strong RTL text without a direction flag', attrs: undefined, run: text('ג') },
    { name: 'Adlam text without a direction flag', attrs: undefined, run: text('\u{1E900}') },
    { name: 'Phoenician text without a direction flag', attrs: undefined, run: text('\u{10900}') },
    { name: 'Garay text without a direction flag', attrs: undefined, run: text('\u{10D50}') },
    { name: 'Mende Kikakui text without a direction flag', attrs: undefined, run: text('\u{1E800}') },
    ...[
      '\u061C',
      '\u200E',
      '\u200F',
      '\u202A',
      '\u202B',
      '\u202C',
      '\u202D',
      '\u202E',
      '\u2066',
      '\u2067',
      '\u2068',
      '\u2069',
    ].map((control) => ({
      name: `Unicode bidi control U+${control.codePointAt(0)!.toString(16).toUpperCase()}`,
      attrs: undefined,
      run: text(`${control}C`),
    })),
  ])('preserves native inline bidi flow for $name', ({ attrs, run }) => {
    const line = paint(
      [text('Base'), image, run, text('1', { vertAlign: 'subscript', fontSize: 10.4 })],
      {},
      makeRunContext(),
      attrs,
    );
    expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
    const leaves = line.querySelectorAll<HTMLElement>('.superdoc-text-run');
    expect(leaves[0].parentElement).toBe(line);
    expect(leaves[1].style.verticalAlign).toBe('bottom');
    expect(leaves[2].style.verticalAlign).toBe('baseline');
    expect(leaves[2].style.top).toBe('calc(-1 * -2.24px)');
    expect(leaves[2].parentElement?.className).toBe('superdoc-inline-script-baseline');
  });

  it.each(
    [false, true].flatMap((positioned) =>
      (['subscript', 'superscript'] as const).map((vertAlign) => ({ positioned, vertAlign })),
    ),
  )(
    'aligns explicit ordinary baseline resets beside $vertAlign (positioned=$positioned)',
    ({ positioned, vertAlign }) => {
      const runs = [
        text('Base'),
        image,
        text('C', { vertAlign: 'baseline', pmStart: 6, pmEnd: 7 }),
        text('123', { vertAlign, fontSize: 10.4, pmStart: 7, pmEnd: 10 }),
        text('D', { vertAlign: 'baseline', baselineShift: 0, pmStart: 10, pmEnd: 11 }),
        text('offset', { vertAlign: 'baseline', baselineShift: 3 }),
        text('hidden', { vertAlign: 'baseline', vanish: true, fontSize: 80 }),
      ];
      const line = paint(
        runs,
        positioned
          ? {
              segments: runs.map((run, runIndex) => ({
                runIndex,
                fromChar: 0,
                toChar: 'text' in run ? run.text.length : 1,
                width: runIndex === 6 ? 0 : 8,
                x: runIndex * 8,
              })),
            }
          : {},
        makeRunContext(),
        positioned ? undefined : { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' } },
      );
      const leaves = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run'));
      for (const leaf of leaves.filter((leaf) => leaf.textContent === 'C' || leaf.textContent === 'D')) {
        expect(leaf.style.verticalAlign).toBe('bottom');
        expect(leaf.style.lineHeight).toBe('normal');
        expect(leaf.parentElement).toBe(line);
        expect(leaf.style.bottom).toBe(positioned ? '0px' : '');
        expect(leaf.style.top).toBe(positioned ? 'auto' : '');
      }
      expect(leaves.find((leaf) => leaf.textContent === 'C')?.dataset.pmStart).toBe('6');
      const script = leaves.find((leaf) => leaf.textContent === '123')!;
      expect(script.style.verticalAlign).toBe('baseline');
      expect(script.style.top).toBe(vertAlign === 'subscript' ? 'calc(-1 * -2.24px)' : 'calc(-1 * 5.28px)');
      expect(script.dataset.pmStart).toBe('7');
      expect(leaves.find((leaf) => leaf.textContent === 'offset')?.style.top).toBe('calc(-1 * 3pt)');
      const hidden = leaves.find((leaf) => leaf.getAttribute('aria-hidden') === 'true')!;
      expect(hidden.textContent).toBe('');
      expect(hidden.style.fontSize).toBe('0px');
      expect(hidden.style.lineHeight).toBe('0');
      expect(hidden.parentElement).toBe(line);
    },
  );

  it('preserves explicit shifts, zero-shift script fallback, and vanished carriers', () => {
    const line = paint([
      image,
      text('base', { baselineShift: 0 }),
      text('raise', { baselineShift: 3, vertAlign: 'subscript' }),
      text('lower', { baselineShift: -2 }),
      text('script', { baselineShift: 0, vertAlign: 'superscript', fontSize: 10.4 }),
      text('hidden', { vanish: true, pmStart: 30, pmEnd: 36 }),
    ]);
    const leaves = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run'));
    expect(leaves.map((leaf) => leaf.style.verticalAlign)).toEqual(['', 'baseline', 'baseline', 'baseline', '']);
    expect(leaves.map((leaf) => leaf.style.top)).toEqual(['', '-3pt', '2pt', '-5.28px', '']);
    expect(leaves[4]?.style.lineHeight).toBe('0');
    expect(leaves[4]?.style.fontSize).toBe('0px');
    expect(leaves[4]?.style.width).toBe('0px');
    expect(leaves[4]?.dataset.pmEnd).toBe('36');
  });

  const baselineResetGuards: { name: string; script: Partial<TextRun>; inlineBoxes?: Line['inlineBoxes'] }[] = [
    { name: 'size', script: { fontSize: 40 } },
    { name: 'physical family', script: { fontFamily: 'Calibri' } },
    { name: 'bold face', script: { bold: true } },
    { name: 'italic face', script: { italic: true } },
    {
      name: 'reflection',
      script: {
        textEffects: {
          reflection: {
            blurRadius: 0,
            distance: 0,
            direction: 90,
            startAlpha: 1,
            startPosition: 0,
            endAlpha: 1,
            endPosition: 1,
            scaleX: 1,
            scaleY: -1,
          },
        },
      },
    },
    {
      name: 'inline box',
      script: {},
      inlineBoxes: [
        {
          id: 'guard',
          from: 0,
          to: 1,
          x: 0,
          width: 8,
          top: 0,
          height: 100,
          startsRange: true,
          endsRange: true,
          style: {},
        },
      ],
    },
  ];
  it.each([false, true].flatMap((positioned) => baselineResetGuards.map((guard) => ({ ...guard, positioned }))))(
    'retains native explicit baseline resets with the $name guard (positioned=$positioned)',
    ({ script, inlineBoxes, positioned }) => {
      const runs = [
        text('Base'),
        image,
        text('C', { vertAlign: 'baseline', pmStart: 6, pmEnd: 7 }),
        text('123', { vertAlign: 'subscript', fontSize: 10.4, ...script, pmStart: 7, pmEnd: 10 }),
        text('D', { vertAlign: 'baseline', baselineShift: 0, pmStart: 10, pmEnd: 11 }),
      ];
      const line = paint(
        runs,
        {
          inlineBoxes,
          ...(positioned
            ? {
                segments: runs.map((run, runIndex) => ({
                  runIndex,
                  fromChar: 0,
                  toChar: 'text' in run ? run.text.length : 1,
                  width: 8,
                  x: runIndex * 8,
                })),
              }
            : {}),
        },
        makeRunContext(),
        { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' } },
      );
      expect(line.querySelector('.superdoc-inline-script-baseline')).toBeNull();
      expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
      const leaves = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run'));
      for (const leaf of leaves.filter((leaf) => leaf.textContent === 'C' || leaf.textContent === 'D')) {
        expect(leaf.style.verticalAlign).toBe('baseline');
        expect(leaf.style.lineHeight).toBe('');
        expect(leaf.style.bottom).toBe('');
        expect(leaf.style.top).toBe('');
        expect(leaf.dataset.pmEnd).toBe(leaf.textContent === 'C' ? '7' : '11');
      }
      expect(leaves.find((leaf) => leaf.textContent === '123')?.dataset.pmStart).toBe('7');
      const unset = leaves.find((leaf) => leaf.textContent === 'Base')!;
      expect(unset.style.verticalAlign).toBe('bottom');
      expect(unset.style.lineHeight).toBe('normal');
    },
  );

  it('preserves hyperlink, comment, review and custom metadata on grouped leaves', () => {
    const line = paint(
      [
        image,
        text('linked', {
          link: { version: 2, href: 'https://example.com', tooltip: 'Link title', rId: 'rId7' },
          underline: { style: 'single', color: '#123456' },
          comments: [{ commentId: 'comment-1' }],
          dataAttrs: { 'data-superdoc-ext-token': 'token' },
          pmStart: 6,
          pmEnd: 12,
        }),
      ],
      {},
      makeRunContext({
        applyTrackedChangeDecorations: (element) => {
          element.dataset.trackChangeId = 'change-1';
        },
      }),
    );
    const leaf = line.querySelector<HTMLAnchorElement>('a.superdoc-text-run')!;
    expect(leaf.href).toBe('https://example.com/');
    expect(leaf.dataset.linkRid).toBe('rId7');
    expect(leaf.dataset.commentIds).toBe('comment-1');
    expect(leaf.dataset.trackChangeId).toBe('change-1');
    expect(leaf.getAttribute('data-superdoc-ext-token')).toBe('token');
    expect(leaf.style.textDecorationLine).toBe('underline');
    expect(leaf.dataset.pmStart).toBe('6');
    expect(leaf.parentElement?.className).toBe('superdoc-inline-text-group');
  });

  it('keeps a shifted bidi leaf and its source/review/link metadata inside an unstamped baseline wrapper', () => {
    const line = paint(
      [
        image,
        text('1', {
          vertAlign: 'superscript',
          fontSize: 10.4,
          bidi: { rtl: true },
          bold: true,
          italic: true,
          pmStart: 6,
          pmEnd: 7,
          link: { version: 2, href: 'https://example.com', rId: 'rId7' },
          comments: [{ commentId: 'comment-1' }],
          dataAttrs: { 'data-superdoc-ext-token': 'token' },
        }),
      ],
      {},
      makeRunContext({
        resolvePhysical: () => 'Physical Face',
        applyTrackedChangeDecorations: (element) => {
          element.dataset.trackChangeId = 'change-1';
        },
      }),
    );
    const wrapper = line.querySelector<HTMLElement>('.superdoc-inline-script-baseline')!;
    const leaf = line.querySelector<HTMLAnchorElement>('a.superdoc-text-run')!;
    expect(wrapper.style.display).toBe('inline');
    expect(wrapper.style.verticalAlign).toBe('bottom');
    expect(wrapper.style.fontSize).toBe('16px');
    expect(wrapper.style.fontFamily).toBe(leaf.style.fontFamily);
    expect(wrapper.style.fontFamily).toContain('Physical Face');
    expect(wrapper.style.fontWeight).toBe('bold');
    expect(wrapper.style.fontStyle).toBe('italic');
    expect(wrapper.textContent).toBe('1');
    expect(wrapper.children).toHaveLength(1);
    expect(wrapper.hasAttribute('data-pm-start')).toBe(false);
    expect(wrapper.hasAttribute('data-layout-epoch')).toBe(false);
    expect(leaf.parentElement).toBe(wrapper);
    expect(leaf.href).toBe('https://example.com/');
    expect(leaf.dataset.linkRid).toBe('rId7');
    expect(leaf.dataset.commentIds).toBe('comment-1');
    expect(leaf.dataset.trackChangeId).toBe('change-1');
    expect(leaf.dataset.superdocExtToken).toBe('token');
    expect(leaf.dataset.pmStart).toBe('6');
    expect(leaf.dataset.pmEnd).toBe('7');
    expect(leaf.style.verticalAlign).toBe('baseline');
    expect(leaf.style.position).toBe('relative');
    expect(leaf.style.top).toBe('calc(-1 * 5.28px)');
  });

  it.each(
    [0.5, 1.5].flatMap((scale) =>
      [false, true].flatMap((rtl) =>
        (['subscript', 'superscript'] as const).map((vertAlign) => ({ scale, rtl, vertAlign })),
      ),
    ),
  )(
    'anchors scaled $vertAlign glyphs at the right edge in an RTL line ($scale, run RTL $rtl)',
    ({ scale, rtl, vertAlign }) => {
      const script = text('123', {
        vertAlign,
        fontSize: 10.4,
        horizontalScale: scale,
        ...(rtl ? { bidi: { rtl: true } } : {}),
        pmStart: 7,
        pmEnd: 10,
      });
      const line = paint(
        [text('Base'), image, text('C'), script, text('D')],
        {
          segments: [
            { runIndex: 0, fromChar: 0, toChar: 4, width: 32 },
            { runIndex: 1, fromChar: 0, toChar: 1, width: 31 },
            { runIndex: 2, fromChar: 0, toChar: 1, width: 8 },
            { runIndex: 3, fromChar: 0, toChar: 3, width: 24 * scale },
            { runIndex: 4, fromChar: 0, toChar: 1, width: 8 },
          ],
        },
        makeRunContext(),
        { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' } },
      );
      const advance = line.querySelector<HTMLElement>('.superdoc-scaled-inline-advance')!;
      const baseline = advance.querySelector<HTMLElement>('.superdoc-inline-script-baseline')!;
      const leaf = baseline.querySelector<HTMLElement>('.superdoc-text-run')!;

      expect(advance.style.width).toBe(`${24 * scale}px`);
      expect(advance.style.verticalAlign).toBe('bottom');
      expect(leaf.style.transform).toBe(`scaleX(${scale})`);
      expect(leaf.style.transformOrigin).toBe('right center');
      expect(leaf.dataset.pmStart).toBe('7');
      expect(leaf.dataset.pmEnd).toBe('10');
      expect(baseline.hasAttribute('data-pm-start')).toBe(false);
      expect(advance.hasAttribute('data-pm-start')).toBe(false);
    },
  );

  it('leaves vanished bidi scripts empty and zero-height without a baseline strut', () => {
    const line = paint([
      image,
      text('hidden', {
        vanish: true,
        vertAlign: 'subscript',
        fontSize: 80,
        bidi: { rtl: true },
        pmStart: 6,
        pmEnd: 12,
      }),
      text('C'),
    ]);
    const hidden = line.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    expect(hidden.parentElement).toBe(line);
    expect(hidden.textContent).toBe('');
    expect(hidden.style.fontSize).toBe('0px');
    expect(hidden.style.lineHeight).toBe('0');
    expect(line.querySelector('.superdoc-inline-script-baseline')).toBeNull();
  });

  it('keeps text groups inside their inline SDT and ends them at an image', () => {
    const sdt = { type: 'structuredContent' as const, scope: 'inline' as const, id: 'control' };
    const line = paint(
      [
        text('C', { pmStart: 1, pmEnd: 2 }),
        text('1', {
          vertAlign: 'subscript',
          fontSize: 10.4,
          pmStart: 2,
          pmEnd: 3,
        }),
        { ...image, pmStart: 3, pmEnd: 4 },
        text('D', { pmStart: 4, pmEnd: 5 }),
      ],
      {},
      makeRunContext({
        resolveRunSdtId: () => ({ sdtId: 'control', sdt }),
        createInlineSdtWrapper: () => {
          const wrapper = document.createElement('span');
          wrapper.className = 'superdoc-structured-content-inline';
          return wrapper;
        },
        expandSdtWrapperPmRange: (wrapper, start, end) => {
          wrapper.dataset.pmStart ??= String(start);
          wrapper.dataset.pmEnd = String(end);
        },
      }),
    );
    const wrapper = line.querySelector<HTMLElement>('.superdoc-structured-content-inline')!;
    expect(line.children).toHaveLength(1);
    expect(Array.from(wrapper.children, (child) => child.textContent)).toEqual(['C1', '', 'D']);
    expect(wrapper.querySelectorAll('.superdoc-inline-text-group')).toHaveLength(2);
    expect(wrapper.dataset.containsInlineImage).toBe('true');
    expect(wrapper.dataset.pmStart).toBe('1');
    expect(wrapper.dataset.pmEnd).toBe('5');
  });

  it.each([{ fontSize: 40 }, { fontFamily: 'Calibri' }, { bold: true }, { italic: true }])(
    'keeps guarded positioned scripts and bases on their native anchors: %j',
    (typography) => {
      const line = paint(
        [image, text('C'), text('1', { vertAlign: 'subscript', fontSize: 10.4, ...typography }), text('D')],
        {
          segments: [
            { runIndex: 0, fromChar: 0, toChar: 1, width: 31, x: 0 },
            { runIndex: 1, fromChar: 0, toChar: 1, width: 8, x: 31 },
            { runIndex: 2, fromChar: 0, toChar: 1, width: 5, x: 39 },
            { runIndex: 3, fromChar: 0, toChar: 1, width: 8, x: 44 },
          ],
        },
      );
      expect(line.querySelector('.superdoc-inline-script-baseline')).toBeNull();
      const leaves = line.querySelectorAll<HTMLElement>('.superdoc-text-run');
      for (const leaf of leaves) {
        expect(leaf.style.position).toBe('absolute');
        expect(leaf.style.bottom).toBe('');
        expect(leaf.style.top).toBe('');
      }
    },
  );

  it.each([false, true])('bottom-anchors positioned text while retaining X and leaf offsets (SDT=%s)', (inSdt) => {
    const sdt = { type: 'structuredContent' as const, scope: 'inline' as const, id: 'control' };
    const line = paint(
      [
        image,
        text('C', { pmStart: 6, pmEnd: 7, horizontalScale: 0.8 }),
        text('1', { vertAlign: 'subscript', fontSize: 10.4, pmStart: 7, pmEnd: 8 }),
      ],
      {
        segments: [
          { runIndex: 0, fromChar: 0, toChar: 1, width: 31, x: 0 },
          { runIndex: 1, fromChar: 0, toChar: 1, width: 8, x: 31 },
          { runIndex: 2, fromChar: 0, toChar: 1, width: 5, x: 39 },
        ],
      },
      makeRunContext(
        inSdt
          ? {
              resolveRunSdtId: () => ({ sdtId: 'control', sdt }),
              createInlineSdtWrapper: () => {
                const wrapper = document.createElement('span');
                wrapper.className = 'superdoc-structured-content-inline';
                return wrapper;
              },
            }
          : {},
      ),
    );
    expect(line.querySelector('.superdoc-inline-text-group')).toBeNull();
    const leaves = Array.from(line.querySelectorAll<HTMLElement>('.superdoc-text-run'));
    const positioned = [leaves[0], leaves[1].parentElement!];
    expect(positioned.map((element) => element.style.left)).toEqual(['31px', '39px']);
    expect(positioned.map((element) => element.style.position)).toEqual(['absolute', 'absolute']);
    expect(positioned.map((element) => element.style.bottom)).toEqual(['0px', '0px']);
    expect(positioned.map((element) => element.style.top)).toEqual(['auto', 'auto']);
    expect(leaves[0]?.style.transform).toBe('scaleX(0.8)');
    expect(leaves[1]?.style.verticalAlign).toBe('baseline');
    expect(leaves[1]?.style.top).toBe('calc(-1 * -2.24px)');
    expect(leaves[1]?.dataset.pmStart).toBe('7');
    if (inSdt)
      expect(
        positioned.every((element) => element.parentElement?.className === 'superdoc-structured-content-inline'),
      ).toBe(true);
  });
});

describe('renderLine justification', () => {
  const makeLine = (text: string, overrides: Partial<Line> = {}): Line => ({
    fromRun: 0,
    fromChar: 0,
    toRun: 0,
    toChar: text.length,
    width: 40,
    maxWidth: 70,
    ascent: 12,
    descent: 4,
    lineHeight: 24,
    segments: [{ runIndex: 0, fromChar: 0, toChar: text.length, width: 40 }],
    ...overrides,
  });

  it.each([0, 1, 2])('preserves %i authored spaces before a line-ending tab', (spaces) => {
    const text = 'Alpha' + ' '.repeat(spaces);
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'terminal-tab',
      attrs: { alignment: 'justify' },
      runs: [
        { kind: 'text', text, fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 1 + text.length },
        { kind: 'tab', width: 20, pmStart: 1 + text.length, pmEnd: 2 + text.length },
      ],
    };
    const line = makeLine(text, { toRun: 1, toChar: 1, segments: undefined });
    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const paintedText = lineEl.querySelector<HTMLElement>('.superdoc-text-run')!;
    const tab = lineEl.querySelector<HTMLElement>('.superdoc-tab')!;
    expect(paintedText.textContent).toBe(text);
    expect(paintedText.dataset.pmEnd).toBe(tab.dataset.pmStart);
    expect(block.runs[0]).toMatchObject({ text, pmEnd: 1 + text.length });
  });

  it('still trims actual trailing wrap spaces when no tab follows them', () => {
    const text = 'Alpha ';
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'trailing-space',
      attrs: { alignment: 'justify' },
      runs: [{ kind: 'text', text, fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 7 }],
    };
    const lineEl = renderLine({
      block,
      line: makeLine(text),
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    expect(lineEl.querySelector('.superdoc-text-run')?.textContent).toBe('Alpha');
    expect(block.runs[0]).toMatchObject({ text: 'Alpha ', pmEnd: 7 });
  });

  it('paints measured CJK boundaries without a trailing advance', () => {
    const text = '春天来到';
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'cjk-justify',
      attrs: { alignment: 'justify' },
      runs: [{ kind: 'text', text, fontFamily: 'Arial', fontSize: 16, pmStart: 20, pmEnd: 24 }],
    };
    const line = makeLine(text, {
      justificationPlan: { type: 'inter-character', boundaries: [1, 2, 3] },
    });

    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const textRuns = Array.from(lineEl.querySelectorAll<HTMLElement>('.superdoc-text-run'));

    expect(textRuns.map((run) => run.textContent)).toEqual(['春天来', '到']);
    expect(textRuns[0]?.style.letterSpacing).toBe('10px');
    expect(textRuns[0]?.dataset.pmStart).toBe('20');
    expect(textRuns[0]?.dataset.pmEnd).toBe('23');
    expect(textRuns[1]?.style.letterSpacing).toBe('');
    expect(textRuns[1]?.dataset.pmStart).toBe('23');
    expect(textRuns[1]?.dataset.pmEnd).toBe('24');
    expect(lineEl.style.wordSpacing).toBe('');
  });

  it('keeps the final grapheme cluster outside inter-character spacing', () => {
    const text = '漢字\uFE0F';
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'cjk-grapheme-justify',
      attrs: { alignment: 'justify' },
      runs: [{ kind: 'text', text, fontFamily: 'Arial', fontSize: 16, pmStart: 20, pmEnd: 23 }],
    };
    const line = makeLine(text, {
      justificationPlan: { type: 'inter-character', boundaries: [1] },
    });

    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const textRuns = Array.from(lineEl.querySelectorAll<HTMLElement>('.superdoc-text-run'));

    expect(textRuns.map((run) => run.textContent)).toEqual(['漢', '字\uFE0F']);
    expect(textRuns.map((run) => run.style.letterSpacing)).toEqual(['30px', '']);
    expect(textRuns[0]?.dataset.pmEnd).toBe('21');
    expect(textRuns[1]?.dataset.pmStart).toBe('21');
    expect(textRuns[1]?.dataset.pmEnd).toBe('23');
  });

  it('uses run-end advances as opportunities across styled runs', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'styled-cjk-justify',
      attrs: { alignment: 'justify' },
      runs: [
        { kind: 'text', text: '春天', fontFamily: 'Arial', fontSize: 16, bold: true },
        { kind: 'text', text: '来到', fontFamily: 'Arial', fontSize: 16, color: '#123456' },
      ],
    };

    const lineEl = renderLine({
      block,
      line: {
        ...makeLine('春天来到'),
        toRun: 1,
        toChar: 2,
        segments: [
          { runIndex: 0, fromChar: 0, toChar: 2, width: 20 },
          { runIndex: 1, fromChar: 0, toChar: 2, width: 20 },
        ],
        justificationPlan: { type: 'inter-character', boundaries: [1, 2, 3] },
      },
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const textRuns = Array.from(lineEl.querySelectorAll<HTMLElement>('.superdoc-text-run'));

    expect(textRuns.map((run) => run.textContent)).toEqual(['春天', '来', '到']);
    expect(textRuns.map((run) => run.style.letterSpacing)).toEqual(['10px', '10px', '']);
  });

  it('keeps space-based justification on word-spacing', () => {
    const text = 'A B';
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'word-justify',
      attrs: { alignment: 'justify' },
      runs: [{ kind: 'text', text, fontFamily: 'Arial', fontSize: 16 }],
    };

    const lineEl = renderLine({
      block,
      line: makeLine(text, { spaceCount: 1 }),
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });

    expect(lineEl.style.wordSpacing).toBe('30px');
    expect(lineEl.querySelector<HTMLElement>('.superdoc-text-run')?.style.letterSpacing).toBe('');
  });

  it('leaves the true final line unstretched when the caller skips justify', () => {
    const text = '春天来到';
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'cjk-final-line',
      attrs: { alignment: 'justify' },
      runs: [{ kind: 'text', text, fontFamily: 'Arial', fontSize: 16 }],
    };

    const lineEl = renderLine({
      block,
      line: makeLine(text, { justificationPlan: { type: 'inter-character', boundaries: [1, 2, 3] } }),
      skipJustify: true,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });

    expect(lineEl.querySelectorAll('.superdoc-text-run')).toHaveLength(1);
    expect(lineEl.querySelector<HTMLElement>('.superdoc-text-run')?.style.letterSpacing).toBe('');
  });
});

describe('renderLine positioned tabs with vanished segments', () => {
  it('sizes an underlined positioned tab to the next visible aligned segment', () => {
    const hidden: TextRun = {
      kind: 'text',
      text: 'hidden',
      fontFamily: 'Arial',
      fontSize: 16,
      vanish: true,
    };
    const visible: TextRun = {
      kind: 'text',
      text: 'X',
      fontFamily: 'Arial',
      fontSize: 16,
    };
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'positioned-tab-vanish',
      attrs: {},
      runs: [
        {
          kind: 'tab',
          text: '\t',
          width: 48,
          fontSize: 16,
          underline: { style: 'single', color: '#000000' },
        } as Run,
        hidden,
        visible,
      ],
    };
    const line: Line = {
      fromRun: 0,
      fromChar: 0,
      toRun: 2,
      toChar: 1,
      width: 110,
      maxWidth: 200,
      ascent: 12,
      descent: 4,
      lineHeight: 24,
      segments: [
        { runIndex: 1, fromChar: 0, toChar: hidden.text.length, width: 0 },
        { runIndex: 2, fromChar: 0, toChar: 1, width: 10, x: 100, precedingTabEndX: 100 },
      ],
    };

    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });

    const tab = lineEl.querySelector('.superdoc-tab') as HTMLElement;
    const overlay = lineEl.querySelector('.superdoc-underline-overlay') as HTMLElement;
    const visibleRun = Array.from(lineEl.querySelectorAll('span')).find((span) => span.textContent === 'X') as
      | HTMLElement
      | undefined;

    expect(tab.style.left).toBe('0px');
    expect(tab.style.width).toBe('100px');
    expect(overlay.style.left).toBe('0px');
    expect(overlay.style.width).toBe('100px');
    expect(visibleRun?.style.left).toBe('100px');
  });

  it('renders a reviewable paragraph-mark deletion anchor even when layout omits its zero-width segment', () => {
    const hidden: TextRun = {
      kind: 'text',
      text: '\u200B',
      fontFamily: 'Arial',
      fontSize: 16,
      vanish: true,
      dataAttrs: { 'data-paragraph-mark-deletion-anchor': 'true' },
      trackedChange: {
        id: 'tc-delete-mark',
        kind: 'delete',
        type: 'structural',
        subtype: 'paragraph-mark-deletion',
        targetKind: 'paragraph-mark',
      },
    };
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'positioned-paragraph-mark-delete',
      attrs: {},
      runs: [{ kind: 'text', text: 'First paragraph', fontFamily: 'Arial', fontSize: 16 }, hidden],
    };
    const line: Line = {
      fromRun: 0,
      fromChar: 0,
      toRun: 1,
      toChar: 1,
      width: 110,
      maxWidth: 200,
      ascent: 12,
      descent: 4,
      lineHeight: 24,
      segments: [{ runIndex: 0, fromChar: 0, toChar: 15, width: 110, x: 0 }],
    };

    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext({
        showFormattingMarks: true,
        resolveTrackedChangesConfig: () => ({ enabled: true, mode: 'review' }),
        applyTrackedChangeDecorations: (el) => {
          el.classList.add('track-delete-dec', 'highlighted');
        },
      }),
    });

    const mark = lineEl.querySelector<HTMLElement>('.superdoc-tracked-paragraph-mark');
    expect(mark?.textContent).toBe('¶');
    expect(mark?.dataset.trackChangeId).toBe('tc-delete-mark');
    expect(mark?.dataset.trackChangeMarker).toBe('paragraph');
    expect(mark?.classList.contains('superdoc-tracked-paragraph-mark')).toBe(true);
    expect(mark?.style.left).toBe('110px');
  });

  it('uses measured segment positions for horizontally scaled LTR text', () => {
    const run: TextRun = {
      kind: 'text',
      text: 'February 2025',
      fontFamily: 'Arial',
      fontSize: 16,
      horizontalScale: 0.9,
    };
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'scaled-text',
      attrs: {},
      runs: [run],
    };
    const line: Line = {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: run.text.length,
      width: 96,
      maxWidth: 200,
      ascent: 12,
      descent: 4,
      lineHeight: 24,
      segments: [{ runIndex: 0, fromChar: 0, toChar: run.text.length, width: 96 }],
    };

    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const text = Array.from(lineEl.querySelectorAll<HTMLElement>('span')).find(
      (element) => element.textContent === run.text,
    );

    expect(text?.style.position).toBe('absolute');
    expect(text?.style.left).toBe('0px');
    expect(text?.style.transform).toBe('scaleX(0.9)');
  });

  it.each([
    { scale: 0.5, measuredWidth: 80 },
    { scale: 1.5, measuredWidth: 240 },
  ])('uses a $measuredWidth px inline advance for scaleX($scale) RTL text', ({ scale, measuredWidth }) => {
    const run: TextRun = {
      kind: 'text',
      text: 'שלוםשלום',
      fontFamily: 'Arial',
      fontSize: 40,
      horizontalScale: scale,
      bidi: { rtl: true },
      pmStart: 10,
      pmEnd: 18,
    };
    const followingRun: TextRun = {
      kind: 'text',
      text: 'NEXT',
      fontFamily: 'Arial',
      fontSize: 40,
      pmStart: 18,
      pmEnd: 22,
    };
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: `rtl-scaled-${scale}`,
      attrs: { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' } },
      runs: [run, followingRun],
    };
    const line: Line = {
      fromRun: 0,
      fromChar: 0,
      toRun: 1,
      toChar: followingRun.text.length,
      width: measuredWidth + 100,
      maxWidth: 600,
      ascent: 40,
      descent: 10,
      lineHeight: 50,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: run.text.length, width: measuredWidth },
        { runIndex: 1, fromChar: 0, toChar: followingRun.text.length, width: 100 },
      ],
    };

    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const advance = lineEl.querySelector<HTMLElement>('.superdoc-scaled-inline-advance');
    const text = advance?.querySelector<HTMLElement>('.superdoc-text-run');

    expect(lineEl.dir).toBe('rtl');
    expect(advance?.style.width).toBe(`${measuredWidth}px`);
    expect(text?.style.position).toBe('');
    expect(text?.style.transform).toBe(`scaleX(${scale})`);
    expect(text?.style.transformOrigin).toBe('right center');
    expect(advance?.nextElementSibling?.textContent).toBe('NEXT');
  });
});

describe('renderLine inline boxes', () => {
  const makeInlineBoxLine = (explicitPositioning: boolean): { block: ParagraphBlock; line: Line } => {
    const text = 'beforeboxedafter';
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: explicitPositioning ? 'positioned-inline-box' : 'flow-inline-box',
      attrs: {},
      runs: [{ kind: 'text', text, fontFamily: 'Arial', fontSize: 16, pmStart: 20, pmEnd: 36 }],
    };
    const line: Line = {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: text.length,
      width: 134,
      maxWidth: 200,
      ascent: 12,
      descent: 4,
      lineHeight: 22,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 6, width: 48, ...(explicitPositioning ? { x: 0 } : {}) },
        { runIndex: 0, fromChar: 6, toChar: 11, width: 40 },
        { runIndex: 0, fromChar: 11, toChar: text.length, width: 40 },
      ],
      inlineBoxes: [
        {
          id: 'provider:box',
          from: 6,
          to: 11,
          x: 51,
          width: 46,
          top: 0,
          height: 22,
          startsRange: true,
          endsRange: true,
          style: {
            paddingInlineStart: 2,
            paddingInlineEnd: 2,
            paddingBlockStart: 1,
            paddingBlockEnd: 1,
            gapBefore: 3,
            gapAfter: 4,
            borderWidth: 1,
            borderColor: '#333333',
            borderStyle: 'solid',
            borderRadius: 4,
            backgroundColor: '#eeeeee',
          },
        },
      ],
    };
    return { block, line };
  };

  it('keeps native leaves, inline-box styles and source ranges beside an expanding image', () => {
    const { block, line } = makeInlineBoxLine(false);
    block.runs.push({ kind: 'image', src: 'image.png', width: 31, height: 100 });
    line.toRun = 1;
    line.toChar = 0;
    line.lineHeight = 100;
    line.ascent = 100;
    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const boxed = Array.from(lineEl.querySelectorAll<HTMLElement>('.superdoc-text-run')).find(
      (leaf) => leaf.textContent === 'boxed',
    )!;
    expect(lineEl.querySelector('.superdoc-inline-text-group')).toBeNull();
    expect(boxed.parentElement).toBe(lineEl);
    for (const leaf of lineEl.querySelectorAll<HTMLElement>('.superdoc-text-run')) {
      if (leaf === boxed) continue;
      expect(leaf.style.lineHeight).toBe('normal');
      expect(leaf.style.verticalAlign).toBe('bottom');
    }
    expect(boxed.getAttribute('data-superdoc-inline-box-id')).toBe('provider:box');
    expect(boxed.style.paddingLeft).toBe('2px');
    expect(boxed.style.paddingRight).toBe('2px');
    expect(boxed.dataset.pmStart).toBe('26');
    expect(boxed.dataset.pmEnd).toBe('31');
  });

  it.each([
    { branch: 'inline flow', explicitPositioning: false, expectedPosition: '' },
    { branch: 'explicit positioning', explicitPositioning: true, expectedPosition: 'absolute' },
  ])('paints resolved box slices in the $branch branch', ({ explicitPositioning, expectedPosition }) => {
    const { block, line } = makeInlineBoxLine(explicitPositioning);

    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const leaves = Array.from(lineEl.querySelectorAll<HTMLElement>('.superdoc-text-run'));
    const boxed = leaves.find((leaf) => leaf.textContent === 'boxed');

    expect(lineEl.textContent).toBe('beforeboxedafter');
    expect(leaves).toHaveLength(3);
    expect(boxed?.getAttribute('data-superdoc-inline-box-id')).toBe('provider:box');
    expect(boxed?.style.position).toBe(expectedPosition);
    expect(boxed?.style.paddingLeft).toBe('2px');
    expect(boxed?.style.paddingRight).toBe('2px');
    expect(boxed?.dataset.pmStart).toBe('26');
    expect(boxed?.dataset.pmEnd).toBe('31');
    expect(boxed?.getAttribute('data-superdoc-inline-box-from')).toBeNull();
    if (explicitPositioning) {
      const after = leaves.find((leaf) => leaf.textContent === 'after');
      expect(after?.style.left).toBe('101px');
    }
  });

  it('preserves atomic runs while painting the visible text range after them', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'tabbed-inline-box',
      attrs: {},
      runs: [
        { kind: 'tab', text: '\t', width: 40, fontSize: 16 },
        { kind: 'text', text: 'abcdefghij', fontFamily: 'Arial', fontSize: 16, pmStart: 20, pmEnd: 30 },
      ],
    };
    const { line } = makeInlineBoxLine(false);
    line.fromRun = 0;
    line.toRun = 1;
    line.toChar = 10;
    line.segments = [
      { runIndex: 1, fromChar: 0, toChar: 5, width: 40 },
      { runIndex: 1, fromChar: 5, toChar: 10, width: 40 },
    ];
    line.inlineBoxes = line.inlineBoxes?.map((box) => ({ ...box, from: 6, to: 11 }));

    const lineEl = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });

    expect(lineEl.querySelector('.superdoc-tab')).not.toBeNull();
    expect(lineEl.querySelector('[data-superdoc-inline-box-id]')?.textContent).toBe('fghij');
  });

  it('removes owned box styling on a canonical repaint after clear', () => {
    const { block, line } = makeInlineBoxLine(false);
    const painted = renderLine({
      block,
      line,
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const cleared = renderLine({
      block,
      line: { ...line, inlineBoxes: undefined },
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });

    expect(painted.querySelector('[data-superdoc-inline-box-id]')).not.toBeNull();
    expect(cleared.querySelector('[data-superdoc-inline-box-id]')).toBeNull();
    expect(cleared.textContent).toBe('beforeboxedafter');
  });
});

describe('SD-5361 deleted manual break boundary metadata', () => {
  for (const deleted of [true, false]) {
    it(`stamps deletion ownership on the preceding painted line: ${deleted}`, () => {
      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'manual-break',
        runs: [
          { kind: 'text', text: 'Before', pmStart: 1, pmEnd: 7 },
          {
            kind: 'lineBreak',
            pmStart: 7,
            pmEnd: 8,
            ...(deleted ? { trackedChange: { kind: 'delete' as const, id: 'revision-1' } } : {}),
          },
          { kind: 'text', text: 'After', pmStart: 8, pmEnd: 13 },
        ],
      };
      const line: Line = {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 6,
        width: 40,
        ascent: 12,
        descent: 4,
        lineHeight: 16,
      };
      const element = renderLine({
        block,
        line,
        context: { pageNumber: 1, totalPages: 1, section: 'body' },
        runContext: makeRunContext(),
      });
      expect(element.dataset.v2DeletedLineBreakAfter).toBe(deleted ? 'true' : undefined);
      expect(element.textContent).toBe('Before');
      const wrapped = renderLine({
        block,
        line: { ...line, toChar: 3 },
        context: { pageNumber: 1, totalPages: 1, section: 'body' },
        runContext: makeRunContext(),
      });
      expect(wrapped.dataset.v2DeletedLineBreakAfter).toBeUndefined();
    });
  }
});

describe('renderLine empty-line placeholder', () => {
  const emptyLine = (): Line => ({
    fromRun: 0,
    fromChar: 0,
    toRun: 0,
    toChar: 0,
    width: 0,
    maxWidth: 200,
    ascent: 12,
    descent: 4,
    lineHeight: 18,
    segments: [],
  });

  const emptyBlock = (attrs: ParagraphBlock['attrs'] = {}): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'empty-block',
    attrs,
    runs: [{ kind: 'text', text: '', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 1 }],
  });

  it('fills the placeholder with a zero-width space so it takes no advance', () => {
    const lineEl = renderLine({
      block: emptyBlock(),
      line: emptyLine(),
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });

    const placeholder = lineEl.querySelector<HTMLElement>('.superdoc-empty-run');
    expect(placeholder?.textContent).toBe('\u200B');
    expect(placeholder?.dataset.pmStart).toBe('1');
    expect(placeholder?.dataset.pmEnd).toBe('1');
  });

  it('keeps the placeholder zero-advance on an RTL line', () => {
    const lineEl = renderLine({
      block: emptyBlock({ directionContext: { inlineDirection: 'rtl' } }),
      line: emptyLine(),
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });

    expect(lineEl.getAttribute('dir')).toBe('rtl');
    expect(lineEl.querySelector('.superdoc-empty-run')?.textContent).toBe('\u200B');
  });
});
