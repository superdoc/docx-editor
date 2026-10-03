import { describe, expect, it } from 'bun:test';
import type { Line, ParagraphBlock, ParagraphMeasure, TableBlock, TableMeasure } from '@superdoc/contracts';
import { createFloatingObjectManager } from './floating-objects.js';
import { layoutParagraphBlock } from './layout-paragraph.js';
import type { PageState } from './paginator.js';

const line = (run: number): Line => ({
  fromRun: run,
  fromChar: 0,
  toRun: run,
  toChar: 0,
  width: 80,
  ascent: 16,
  descent: 4,
  lineHeight: 20,
  maxWidth: 400,
});
const text = (value: string) => ({ text: value, fontFamily: 'Arial', fontSize: 12 });
type TerminalForm = 'blank' | 'space' | 'omitted' | 'anotherBreak';

function runLayout(
  clear?: string,
  inline = false,
  floatPage = 1,
  floatColumn = 0,
  widowControl = false,
  contentBottom = 750,
  precedingLines = 1,
  terminalOptions?: { form: TerminalForm; secondFloat: boolean },
) {
  const terminal = terminalOptions?.form;
  const state: PageState = {
    page: { number: 1, fragments: [] },
    columnIndex: 0,
    cursorY: 50,
    topMargin: 50,
    contentBottom,
    constraintBoundaries: [],
    activeConstraintIndex: -1,
    trailingSpacing: 0,
    maxCursorY: 50,
    pageFootnoteReserve: 0,
    footnoteDemandThisPage: 0,
    footnoteRefsThisPage: 0,
  };
  if (widowControl) {
    state.page.fragments.push({
      kind: 'para',
      blockId: 'previous',
      fromLine: 0,
      toLine: 1,
      x: 50,
      y: 30,
      width: 400,
      height: 20,
      columnIndex: 0,
    });
  }
  const manager = createFloatingObjectManager({ width: 400, gap: 20, count: 2 }, { left: 50, right: 50 }, 940);
  const table: TableBlock = {
    kind: 'table',
    id: 'signature',
    rows: [],
    anchor: { isAnchored: true, hRelativeFrom: 'column', vRelativeFrom: 'paragraph' },
    wrap: { type: 'Square', distRight: 12, distBottom: 12 },
  };
  const tableMeasure: TableMeasure = {
    kind: 'table',
    rows: [],
    columnWidths: [200],
    totalWidth: 200,
    totalHeight: 200,
  };
  manager.registerTable(table, tableMeasure, 50, floatColumn, floatPage);
  if (terminalOptions?.secondFloat) {
    manager.registerTable(
      { ...table, id: 'second' },
      { ...tableMeasure, totalHeight: 50 },
      285,
      floatColumn,
      floatPage,
    );
  }
  const br = { kind: 'lineBreak' as const, attrs: { lineBreakType: 'textWrapping', ...(clear ? { clear } : {}) } };
  const block: ParagraphBlock = {
    kind: 'paragraph',
    id: 'clear-break',
    runs: terminal
      ? [
          text('Before'),
          br,
          ...(terminal === 'space' ? [text(' ')] : terminal === 'anotherBreak' ? [{ kind: 'lineBreak' as const }] : []),
        ]
      : inline
        ? [text('Before'), br, text('After')]
        : [br],
    attrs: { widowControl },
  };
  const lines = terminal
    ? [
        { ...line(0), toChar: 6 },
        ...(terminal === 'omitted'
          ? []
          : [{ ...line(terminal === 'space' ? 2 : 1), width: 0, toChar: terminal === 'space' ? 1 : 0 }]),
        ...(terminal === 'anotherBreak' ? [{ ...line(2), width: 0 }] : []),
      ]
    : inline
      ? [...Array.from({ length: precedingLines }, () => line(0)), line(2)]
      : [
          { ...line(0), width: 0 },
          { ...line(0), width: 0 },
        ];
  const measure: ParagraphMeasure = {
    kind: 'paragraph',
    lines,
    totalHeight: lines.reduce((height, line) => height + line.lineHeight, 0),
  };
  const regions: unknown[] = [];
  layoutParagraphBlock({
    block,
    measure,
    columnWidth: 400,
    ensurePage: () => state,
    advanceColumn: (current) => {
      current.page = { number: current.page.number + 1, fragments: [] };
      current.cursorY = current.topMargin;
      return current;
    },
    columnX: () => 50,
    floatManager: manager,
    remeasureParagraph: (_block, _width, _indent, lineRegions) => {
      regions.push(lineRegions);
      return measure;
    },
  });
  return { state, regions };
}

function runTerminalLayout(form: TerminalForm, secondFloat = false) {
  return runLayout('all', true, 1, 0, false, 750, 1, { form, secondFloat });
}

describe('SD-5640 authored clear-all breaks', () => {
  it('clears before the measured trailing blank line after visible text', () => {
    const terminal = runTerminalLayout('blank');
    const space = runTerminalLayout('space');
    expect(terminal.state.cursorY).toBe(282);
    expect(terminal.state.cursorY).toBe(space.state.cursorY);
    expect(terminal.regions[0]).toEqual([[{ offsetX: 212, width: 188 }], [{ offsetX: 0, width: 400 }]]);
  });

  it('keeps the fallback when a measurer omits the trailing blank line', () => {
    expect(runTerminalLayout('omitted').state.cursorY).toBe(262);
  });

  it('does not apply the terminal fallback again after laying out the blank line', () => {
    expect(runTerminalLayout('blank', true).state.cursorY).toBe(282);
  });

  it('does not reapply the clear when an ordinary break follows its blank line', () => {
    const { state, regions } = runTerminalLayout('anotherBreak', true);
    expect(state.cursorY).toBe(302);
    expect(regions[0]).toEqual([
      [{ offsetX: 212, width: 188 }],
      [{ offsetX: 0, width: 400 }],
      [{ offsetX: 212, width: 188 }],
    ]);
  });

  it('advances the next paragraph past a partial-width floating table and its bottom distance', () => {
    const { state } = runLayout('all');
    expect(state.cursorY).toBeGreaterThanOrEqual(262);
  });

  it('clears the following inline line while keeping the preceding line above the table bottom', () => {
    const { state, regions } = runLayout('all', true);
    const fragments = state.page.fragments.filter((fragment) => fragment.kind === 'para');
    expect(fragments).toHaveLength(2);
    expect(fragments[0].y).toBe(50);
    expect(fragments[1].y).toBe(262);
    expect(regions[0]).toEqual([[{ offsetX: 212, width: 188 }], [{ offsetX: 0, width: 400 }]]);
  });

  it('keeps an inline clear on the populated page when widow control is enabled', () => {
    const { state } = runLayout('all', true, 1, 0, true);
    expect(state.page.number).toBe(1);
    const fragments = state.page.fragments.filter((fragment) => fragment.blockId === 'clear-break');
    expect(fragments.map((fragment) => fragment.y)).toEqual([50, 262]);
  });

  it('keeps all preceding lines on the page when a clear follows three wrapped lines', () => {
    const { state } = runLayout('all', true, 1, 0, true, 750, 3);
    expect(state.page.number).toBe(1);
    const fragments = state.page.fragments.filter((fragment) => fragment.blockId === 'clear-break');
    expect(fragments.map((fragment) => fragment.y)).toEqual([50, 262]);
    expect(fragments[0].kind === 'para' && fragments[0].toLine).toBe(3);
  });

  it('retains widow control when the cleared line needs the next page', () => {
    const { state } = runLayout('all', true, 1, 0, true, 230);
    expect(state.page.number).toBe(2);
    const fragments = state.page.fragments.filter((fragment) => fragment.blockId === 'clear-break');
    expect(fragments).toHaveLength(1);
    expect(fragments[0].y).toBe(50);
    expect(state.cursorY).toBe(90);
  });

  for (const clear of [undefined, 'none', 'invalid']) {
    it('preserves ordinary side wrapping for clear=' + String(clear), () => {
      const { state } = runLayout(clear);
      expect(state.cursorY).toBe(90);
    });
  }

  it('does not clear a float belonging to another page', () => {
    expect(runLayout('all', false, 2).state.cursorY).toBe(90);
  });

  it('does not clear a float belonging to another column', () => {
    expect(runLayout('all', false, 1, 1).state.cursorY).toBe(90);
  });
});
