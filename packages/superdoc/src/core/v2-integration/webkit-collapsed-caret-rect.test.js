import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
  detectCollapsedCaretRectQuirk,
  installWebKitCollapsedCaretRectFix,
  positionsWalkedSoFar,
  resolveCollapsedCaretGeometry,
} from './webkit-collapsed-caret-rect.js';

const CHAR_WIDTH = 10;
const LINE_HEIGHT = 16;

/** @returns {DOMRect} */
const rect = (left, right, top = 0) => ({
  left,
  right,
  top,
  bottom: top + LINE_HEIGHT,
  width: right - left,
  height: LINE_HEIGHT,
  x: left,
  y: top,
});

/** Characters painted right-to-left from x=100: logical char 0 is the rightmost. */
const rtlRun =
  (length, rightEdge = 100) =>
  (index) =>
    index >= 0 && index < length ? rect(rightEdge - CHAR_WIDTH * (index + 1), rightEdge - CHAR_WIDTH * index) : null;

/** Characters painted left-to-right from x=0: logical char 0 is the leftmost. */
const ltrRun =
  (length, leftEdge = 0) =>
  (index) =>
    index >= 0 && index < length ? rect(leftEdge + CHAR_WIDTH * index, leftEdge + CHAR_WIDTH * (index + 1)) : null;

const RTL = () => true;
const LTR = () => false;

/**
 * The cost tests below count the positions the module's walks visit, read from
 * `positionsWalkedSoFar()`, rather than timing anything. The count is the same
 * on a loaded CI runner as on a quiet desktop, and the two shapes the tests tell
 * apart — a pass over the text, against a pass per caret — sit thousands of
 * times apart in it, where a budget in milliseconds can only hold them a few
 * multiples apart and then only on an idle machine.
 *
 * A node long enough that a pass per caret is unmistakable in the count, swept
 * at enough carets to make it so. The tests that use it each start their text
 * with a different character, on purpose: what one resolution works out is
 * handed on to a text that extends it, so a shared prefix would let one test
 * answer the next and leave it counting nothing.
 */
const RUN = 20000;
const SWEEP = 2000;

/**
 * Passes over the text a sweep may cost in total, however many carets it
 * resolves. Two rules walk these texts — to the left end of the terminator run
 * and to the nearest strong character before the caret — and each may walk the
 * text once; the rest is a position or two per caret. A walk per caret would
 * come to SWEEP passes.
 */
const PASSES_ALLOWED = 4;

/**
 * Typing is measured on the same length of node, a keystroke at a time. A
 * keystroke may cost a few positions — the character it added and the one
 * before it — and never a pass: a pass per keystroke is what the carry across
 * an edit exists to prevent, and is what a node this long cost before it.
 */
const KEYSTROKES = 200;
const POSITIONS_PER_KEYSTROKE_ALLOWED = 8;

/**
 * The three cost tests below opt out of the suite's `retry`. Their assertion is
 * deterministic, so a failure is a regression and never noise; and a retry would
 * run the same text through a module that has already worked it out, count
 * nothing, and pass — hiding exactly what the test is for.
 */
const MEASURED_ONCE = { retry: 0 };

/**
 * Positions the module walked while `work` ran.
 *
 * @param {() => void} work
 * @returns {number}
 */
const positionsWalkedBy = (work) => {
  const before = positionsWalkedSoFar();
  work();
  return positionsWalkedSoFar() - before;
};

const HEBREW = 'שלום';
const HEBREW_SPACE = `${HEBREW} `;

/** The two edges of the character after HEBREW in a right-to-left run: its logical end is the left one. */
const TAIL_RIGHT = 100 - CHAR_WIDTH * HEBREW.length;
const TAIL_LEFT = TAIL_RIGHT - CHAR_WIDTH;

/**
 * An RTL paragraph whose Hebrew word is followed by a space and then a
 * left-to-right tail. The tail is painted to the LEFT of the space, so its rects
 * sit exactly where a continuing right-to-left run's rects would sit.
 */
const rtlThenLtrTail = (tail, head = HEBREW_SPACE) => {
  const rtlHead = rtlRun(head.length);
  const tailStart = 100 - CHAR_WIDTH * (head.length + tail.length);
  const ltrTail = ltrRun(tail.length, tailStart);
  return {
    text: head + tail,
    charRect: (index) => (index < head.length ? rtlHead(index) : ltrTail(index - head.length)),
    tailStart,
  };
};

describe('resolveCollapsedCaretGeometry', () => {
  it('places the end-of-text caret at the logical end of an RTL run (issue #3943)', () => {
    // "שלום " — the boundary WebKit refuses to measure. The caret belongs at the
    // LEFT edge of the trailing space; taking its right edge (the LTR answer)
    // paints the caret one character behind, which is the reported bug.
    const geometry = resolveCollapsedCaretGeometry(5, HEBREW_SPACE, rtlRun(5), RTL);
    expect(geometry?.x).toBe(100 - CHAR_WIDTH * 5);
  });

  it('places the end-of-text caret at the logical end of an LTR run', () => {
    expect(resolveCollapsedCaretGeometry(6, 'hello ', ltrRun(6), LTR)?.x).toBe(CHAR_WIDTH * 6);
  });

  it('keeps the caret after a lone digit ending an RTL paragraph', () => {
    // "שלום 1" — "עמוד 5" in the wild. The digit is a one-character
    // left-to-right run, so the caret belongs at its RIGHT edge. Its rects are
    // indistinguishable from a continuing RTL run, so only the character itself
    // carries the answer.
    const { text, charRect, tailStart } = rtlThenLtrTail('1');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH);
  });

  it('keeps the caret after a lone Latin letter ending an RTL paragraph', () => {
    const { text, charRect, tailStart } = rtlThenLtrTail('A');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH);
  });

  it('keeps the caret after an Arabic-Indic digit, which is a number and orders LTR', () => {
    // "صفحة ٥" — a page number in an Arabic document. The digit lives inside the
    // Arabic block but is laid out left-to-right like any other number, so a
    // plain block test would put the caret before it.
    const { text, charRect, tailStart } = rtlThenLtrTail('٥', 'مرحبا ');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH);
  });

  it('keeps the caret after an extended Arabic-Indic digit', () => {
    const { text, charRect, tailStart } = rtlThenLtrTail('۵', 'صفحه ');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH);
  });

  it('places the caret at the logical end of a trailing Arabic letter', () => {
    const text = 'مرحبا';
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('treats a terminator glued to a number as part of that number (UBA W5)', () => {
    // "50%" is one left-to-right run, so the caret belongs after the sign.
    const { text, charRect, tailStart } = rtlThenLtrTail('50%');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH * 3);
  });

  it('does not join a terminator to an Arabic-Indic number, which UBA W5 excludes', () => {
    // "نسبة ٥٠٪" — the percent sign follows Arabic-Indic digits, so it stays
    // neutral and takes the paragraph's direction rather than the number's run.
    const text = 'نسبة ٥٠٪';
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('gives a separator after a number the paragraph direction, not the number run', () => {
    // A trailing comma is not part of the number, so it stays neutral.
    const text = `${HEBREW_SPACE}1,`;
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('follows the character, not the paragraph, when an RTL paragraph ends in an LTR word', () => {
    const { text, charRect, tailStart } = rtlThenLtrTail('Word');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH * 4);
  });

  it('places the caret at the logical end of a trailing Hebrew letter', () => {
    const text = `${HEBREW} עולם`;
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('puts an interior caret at the logical end of the character before it', () => {
    expect(resolveCollapsedCaretGeometry(2, HEBREW_SPACE, rtlRun(5), RTL)?.x).toBe(100 - CHAR_WIDTH * 2);
    expect(resolveCollapsedCaretGeometry(2, 'hello ', ltrRun(6), LTR)?.x).toBe(CHAR_WIDTH * 2);
  });

  it('places the start-of-text caret at the logical start of the first character', () => {
    expect(resolveCollapsedCaretGeometry(0, HEBREW_SPACE, rtlRun(5), RTL)?.x).toBe(100);
    expect(resolveCollapsedCaretGeometry(0, 'hello ', ltrRun(6), LTR)?.x).toBe(0);
  });

  it('takes the paragraph direction for a neutral character, which carries none of its own', () => {
    expect(resolveCollapsedCaretGeometry(1, ' ', rtlRun(1), RTL)?.x).toBe(100 - CHAR_WIDTH);
    expect(resolveCollapsedCaretGeometry(1, ' ', ltrRun(1), LTR)?.x).toBe(CHAR_WIDTH);
  });

  it('does not read the paragraph direction for a character that carries its own', () => {
    // Reading it forces a style recalc, and this runs per synthesized caret.
    let reads = 0;
    const countingDirection = () => {
      reads += 1;
      return true;
    };
    resolveCollapsedCaretGeometry(4, HEBREW_SPACE, rtlRun(5), countingDirection);
    expect(reads).toBe(0);
  });

  it('classifies a surrogate pair as one character rather than as half of one', () => {
    // An astral RTL letter (Phoenician alf) closing an LTR paragraph. Reading
    // only the low surrogate would see no letter at all, fall through to the
    // paragraph, and put the caret on the wrong edge.
    const text = 'abc𐤀';
    expect(resolveCollapsedCaretGeometry(text.length, text, ltrRun(text.length), LTR)?.x).toBe(CHAR_WIDTH * 3);
  });

  it('asks for the whole code point, never for one half of a surrogate pair', () => {
    // Range offsets are UTF-16 units, so a caller handed the low surrogate could
    // measure half a pair. Both offsets inside the pair resolve to its start.
    const text = 'abc𐤀';
    const asked = [];
    const record = (index) => {
      asked.push(index);
      return ltrRun(text.length)(index);
    };
    resolveCollapsedCaretGeometry(text.length, text, record, LTR);
    resolveCollapsedCaretGeometry(text.length - 1, text, record, LTR);
    expect(asked).toEqual([3, 3]);
  });

  it('keeps the caret after an NKo digit, which is a digit written right-to-left', () => {
    // Not every digit orders left-to-right: NKo and Adlam write theirs
    // right-to-left, so a general-category test for "number" picks the wrong
    // edge. Chromium lays this one out right-to-left.
    const text = `${HEBREW_SPACE}߅`;
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('keeps the caret after an Adlam digit, which is astral and right-to-left', () => {
    const text = `${HEBREW_SPACE}𞥕`;
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length - 1), RTL)?.x).toBe(
      100 - CHAR_WIDTH * (text.length - 1),
    );
  });

  it('keeps the caret after an Imperial Aramaic number, which is right-to-left', () => {
    const text = `${HEBREW_SPACE}𐡘`;
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length - 1), RTL)?.x).toBe(
      100 - CHAR_WIDTH * (text.length - 1),
    );
  });

  it('gives a number symbol that is not ordered as a number the paragraph direction', () => {
    // "½" and "①" are numbers by general category but neutral to the bidi
    // algorithm, so they take the paragraph's direction rather than a run of
    // their own.
    for (const tail of ['½', '①']) {
      const text = `${HEBREW_SPACE}${tail}`;
      expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
        100 - CHAR_WIDTH * text.length,
      );
    }
  });

  it('keeps the caret after a Roman numeral, which is a left-to-right letter number', () => {
    const { text, charRect, tailStart } = rtlThenLtrTail('Ⅷ');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH);
  });

  it('keeps the caret after a private-use character, as a .docx symbol run paints', () => {
    // A Wingdings or Symbol run maps to U+F0xx. Unicode defaults private use to
    // left-to-right and Chromium lays it out that way.
    const { text, charRect, tailStart } = rtlThenLtrTail('');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH);
  });

  it('gives a combining mark the direction of the character it sits on (UBA W1)', () => {
    // The acute belongs to the Latin "e", which is left-to-right even though the
    // mark's own block is not. Its code-point block says nothing about it.
    const { text, charRect, tailStart } = rtlThenLtrTail('é');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH * 2);
  });

  it('gives a combining mark on a Hebrew letter the right-to-left direction', () => {
    const text = `${HEBREW_SPACE}אֱ`;
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('gives a variation selector the direction of the emoji it follows', () => {
    // "☺️" ends a Hebrew line. The selector is a mark, the emoji is neutral,
    // so the pair takes the paragraph's direction.
    const text = `${HEBREW_SPACE}☺️`;
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('gives a mark with nothing before it the paragraph direction (UBA W1 at sor)', () => {
    expect(resolveCollapsedCaretGeometry(1, '́', rtlRun(1), RTL)?.x).toBe(100 - CHAR_WIDTH);
    expect(resolveCollapsedCaretGeometry(1, '́', ltrRun(1), LTR)?.x).toBe(CHAR_WIDTH);
  });

  it('does not join a terminator to a number that Arabic letters made Arabic (UBA W2)', () => {
    // "مرحبا 50%": the digits follow an Arabic letter, so they order as an
    // Arabic number, and W5 no longer attaches the sign to them. Hebrew before
    // the same digits leaves them European and the sign does attach, which is
    // the case above. Both engines agree.
    const text = 'مرحبا 50%';
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('joins a terminator that comes before its number (UBA W5 reads both sides)', () => {
    const { text, charRect, tailStart } = rtlThenLtrTail('$50');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH * 3);
  });

  it('gives a neutral between two right-to-left runs their direction (UBA N1)', () => {
    // A Hebrew phrase inside an English paragraph: the full stop sits between two
    // Hebrew words, so it joins them rather than taking the paragraph.
    const text = 'abc שלום. עולם';
    const dot = text.indexOf('.');
    expect(resolveCollapsedCaretGeometry(dot + 1, text, rtlRun(text.length), LTR)?.x).toBe(
      100 - CHAR_WIDTH * (dot + 1),
    );
  });

  it('keeps the caret after Hebrew punctuation inside a left-to-right paragraph', () => {
    // Gershayim is right-to-left without being a letter, so a letters-only test
    // would hand it to the paragraph.
    const text = 'abc ״';
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), LTR)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('gives the Arabic comma the paragraph direction, since it is neutral', () => {
    // One of the 46 code points that sit inside a right-to-left block without
    // being right-to-left themselves.
    const text = 'abc ،';
    expect(resolveCollapsedCaretGeometry(text.length, text, ltrRun(text.length), LTR)?.x).toBe(
      CHAR_WIDTH * text.length,
    );
  });

  it('looks past a zero-width character to the neighbour that has a glyph box', () => {
    // WebKit refuses the caret after "שלום " + ZWSP, and the zero-width space it
    // would have measured has no box. Chromium puts the caret at the logical end
    // of the space, which is the first neighbour that does have one.
    const text = `${HEBREW_SPACE}\u200b`;
    const glyphs = rtlRun(HEBREW_SPACE.length);
    expect(resolveCollapsedCaretGeometry(text.length, text, glyphs, RTL)?.x).toBe(
      100 - CHAR_WIDTH * HEBREW_SPACE.length,
    );
  });

  it('looks past a run of bidi marks, which also have no glyph box', () => {
    const text = `${HEBREW_SPACE}\u200f\u200e\u200f`;
    const glyphs = rtlRun(HEBREW_SPACE.length);
    expect(resolveCollapsedCaretGeometry(text.length, text, glyphs, RTL)?.x).toBe(
      100 - CHAR_WIDTH * HEBREW_SPACE.length,
    );
  });

  it('declines rather than scanning an unbounded run of invisible characters', () => {
    // Every step is a forced layout, so the search is bounded and gives up
    // instead, which leaves the caret exactly where the unpatched browser puts it.
    let measurements = 0;
    const text = `${HEBREW_SPACE}${'\u200b'.repeat(64)}`;
    const glyphs = (index) => {
      measurements += 1;
      return rtlRun(HEBREW_SPACE.length)(index);
    };
    expect(resolveCollapsedCaretGeometry(text.length, text, glyphs, RTL)).toBeNull();
    expect(measurements).toBeLessThanOrEqual(32);
  });

  it('joins a bracket pair to the left-to-right text it encloses (UBA N0)', () => {
    // "שלום abc(def)" — a Latin parenthetical inside Hebrew, which Hebrew
    // technical and legal writing is full of. The pair encloses left-to-right
    // text and follows left-to-right text, so the brackets join that run rather
    // than taking the paragraph's direction.
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
      ['\uff08', '\uff09'],
      ['\u3008', '\u3009'],
    ]) {
      const { text, charRect, tailStart } = rtlThenLtrTail(`abc${open}def${close}`);
      expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH * 8);
    }
  });

  it('matches a bracket across canonical equivalence, as BD16 requires', () => {
    // U+2329 is canonically equivalent to U+3008, so it pairs with U+3009.
    const { text, charRect, tailStart } = rtlThenLtrTail('abc\u2329def\u3009');
    expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH * 8);
  });

  it('gives a bracket pair the paragraph direction when it encloses that direction', () => {
    const text = `${HEBREW_SPACE}(עולם)`;
    expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
      100 - CHAR_WIDTH * text.length,
    );
  });

  it('leaves an unpaired bracket, and one enclosing nothing strong, to the neutral rules', () => {
    for (const tail of ['abc)', '()']) {
      const text = `${HEBREW_SPACE}${tail}`;
      expect(resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL)?.x).toBe(
        100 - CHAR_WIDTH * text.length,
      );
    }
  });

  it('keeps the caret after a native-script digit, which is plain left-to-right', () => {
    // Only ASCII, Persian, fullwidth, Arabic-Indic, NKo and Adlam digits have a
    // bidi class of their own. Devanagari, Thai, Bengali and forty more scripts
    // write ordinary left-to-right digits, and reading them as neutral put the
    // caret on the paragraph's edge instead of theirs.
    for (const digit of ['२', '๑', '১', '၁']) {
      const { text, charRect, tailStart } = rtlThenLtrTail(digit);
      expect(resolveCollapsedCaretGeometry(text.length, text, charRect, RTL)?.x).toBe(tailStart + CHAR_WIDTH);
    }
  });

  it('returns nothing for text that is not a string', () => {
    for (const notText of [null, undefined, 42, {}]) {
      expect(resolveCollapsedCaretGeometry(0, notText, () => null, RTL)).toBeNull();
      expect(resolveCollapsedCaretGeometry(1, notText, rtlRun(1), RTL)).toBeNull();
    }
  });

  it('joins a neutral to the strong characters around it however far away they are', () => {
    // A left-to-right paragraph holding two Hebrew letters 1200 characters apart,
    // with the caret in the neutral run between them: N1 gives the run their
    // direction, and distance does not enter into it. Cutting the search off at
    // a fixed length would answer with the paragraph instead.
    const gap = ' '.repeat(1200);
    const text = `א${gap}ב`;
    const offset = 1 + gap.length / 2;
    expect(resolveCollapsedCaretGeometry(offset, text, ltrRun(text.length), LTR)?.x).toBe(CHAR_WIDTH * (offset - 1));
  });

  it('walks a neutral run once for all the carets resolved along it', MEASURED_ONCE, () => {
    // The rules need the nearest strong character on each side, which is linear
    // to walk to. Walking on every placement made an unbroken run of neutrals
    // quadratic under key-repeat. Sweeping forwards is what asks each walk to
    // stop at the answer the one before it left.
    const text = `a${'%'.repeat(RUN)}`;
    const glyphs = rtlRun(text.length);
    const walked = positionsWalkedBy(() => {
      for (let caret = text.length - SWEEP; caret <= text.length; caret += 1) {
        resolveCollapsedCaretGeometry(caret, text, glyphs, RTL);
      }
    });
    // Something was counted, so this text was not answered by an earlier one's.
    expect(walked).toBeGreaterThan(0);
    expect(walked).toBeLessThanOrEqual(PASSES_ALLOWED * text.length);
  });

  it('writes what one walk found over the whole run it passed', MEASURED_ONCE, () => {
    // Sweeping backwards instead: the first caret walks the run, and every
    // caret behind it must be answered by what that walk wrote down rather than
    // by a walk of its own. A separate text, since the sweep above would
    // otherwise have answered this one.
    const text = `b${'%'.repeat(RUN)}`;
    const glyphs = rtlRun(text.length);
    const walked = positionsWalkedBy(() => {
      for (let caret = 0; caret < SWEEP; caret += 1) {
        resolveCollapsedCaretGeometry(text.length - caret, text, glyphs, RTL);
      }
    });
    expect(walked).toBeGreaterThan(0);
    expect(walked).toBeLessThanOrEqual(PASSES_ALLOWED * text.length);
  });

  it('does not read the whole node again on every keystroke', MEASURED_ONCE, () => {
    // Typing replaces the text, so nothing kept on the whole text survives a
    // keystroke, and reading the whole node on each one made a typing session
    // quadratic in turn — twelve milliseconds a keystroke in a node this long.
    // What a character has behind it cannot be changed by an edit after it, so
    // an edit hands that on. The first resolution pays for the node once and is
    // left out of the count; the keystrokes are what is measured.
    let text = `c${'%'.repeat(RUN)}`;
    resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL);
    const walked = positionsWalkedBy(() => {
      for (let keystroke = 0; keystroke < KEYSTROKES; keystroke += 1) {
        text += '%';
        resolveCollapsedCaretGeometry(text.length, text, rtlRun(text.length), RTL);
      }
    });
    expect(walked).toBeGreaterThan(0);
    expect(walked).toBeLessThanOrEqual(POSITIONS_PER_KEYSTROKE_ALLOWED * KEYSTROKES);
  });

  it('works out a character again when an edit replaced it', () => {
    // What an edit changed is not among what it hands on. Resolving the Latin
    // tail first is what puts its answer in reach of the Hebrew one: both texts
    // share the four Hebrew letters, and only the fifth character differs.
    const latin = `${HEBREW}b`;
    const hebrew = `${HEBREW}\u05d0`;
    expect(resolveCollapsedCaretGeometry(latin.length, latin, rtlRun(latin.length), RTL)?.x).toBe(TAIL_RIGHT);
    expect(resolveCollapsedCaretGeometry(hebrew.length, hebrew, rtlRun(hebrew.length), RTL)?.x).toBe(TAIL_LEFT);
  });

  it('works out a character again when an edit completed its surrogate pair', () => {
    // A lone high surrogate and the pair it becomes share their first unit, so
    // comparing units alone would hand on an answer for a different character.
    // The half is left-to-right by default; the whole is Phoenician alf.
    const half = `${HEBREW}\ud802`;
    const whole = `${HEBREW}\ud802\udd00`;
    expect(resolveCollapsedCaretGeometry(half.length, half, rtlRun(half.length), RTL)?.x).toBe(TAIL_RIGHT);
    expect(resolveCollapsedCaretGeometry(whole.length, whole, rtlRun(whole.length), RTL)?.x).toBe(TAIL_LEFT);
  });

  it('works out a character again when an edit split its surrogate pair', () => {
    // The mirror image: the pair is worked out whole, then the edit takes its
    // low surrogate away, or puts something else in its place. The units before
    // the edit are the same in both texts, so a comparison of units alone would
    // hand the whole character's class on to the half — and Phoenician alf is
    // right-to-left where a lone surrogate is not.
    const whole = `${HEBREW}\ud802\udd00`;
    for (const split of [`${HEBREW}\ud802`, `${HEBREW}\ud802b`]) {
      expect(resolveCollapsedCaretGeometry(whole.length, whole, rtlRun(whole.length), RTL)?.x).toBe(TAIL_LEFT);
      expect(resolveCollapsedCaretGeometry(HEBREW.length + 1, split, rtlRun(split.length), RTL)?.x).toBe(TAIL_RIGHT);
    }
  });

  it('does not hand on what an edit moved', () => {
    // N1 reads both sides of a neutral. What is behind a character survives an
    // edit after it; what is ahead of it does not, and keeping that would answer
    // the second of these with the first one's tail.
    const gap = ' '.repeat(40);
    const offset = 1 + gap.length / 2;
    const rtlTail = `\u05d0${gap}\u05d1`;
    const ltrTail = `\u05d0${gap}b`;
    expect(resolveCollapsedCaretGeometry(offset, rtlTail, ltrRun(rtlTail.length), LTR)?.x).toBe(
      CHAR_WIDTH * (offset - 1),
    );
    expect(resolveCollapsedCaretGeometry(offset, ltrTail, ltrRun(ltrTail.length), LTR)?.x).toBe(CHAR_WIDTH * offset);
  });

  it('carries the glyph vertical metrics onto the caret', () => {
    expect(resolveCollapsedCaretGeometry(5, HEBREW_SPACE, rtlRun(5), RTL)).toMatchObject({
      top: 0,
      height: LINE_HEIGHT,
    });
  });

  it('returns nothing when no glyph can be measured or the offset is out of range', () => {
    expect(resolveCollapsedCaretGeometry(0, '', () => null, RTL)).toBeNull();
    expect(resolveCollapsedCaretGeometry(2, 'ab', () => null, RTL)).toBeNull();
    expect(resolveCollapsedCaretGeometry(3, 'ab', rtlRun(2), RTL)).toBeNull();
    expect(resolveCollapsedCaretGeometry(-1, 'ab', rtlRun(2), RTL)).toBeNull();
  });
});

/**
 * A window whose ranges reproduce the WebKit defect: RTL text laid out
 * right-to-left, with no client rects for a collapsed range at the end of a text
 * node the browser refuses to measure.
 *
 * @param {{ isBrokenBoundary?: (text: string) => boolean, phantomGlyphRects?: boolean }} [options]
 */
function createFakeWindow({ isBrokenBoundary = (text) => /[ \t]$/.test(text), phantomGlyphRects = false } = {}) {
  const bodyChildren = [];

  class FakeDOMRect {
    constructor(x, y, width, height) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.left = x;
      this.right = x + width;
      this.top = y;
      this.bottom = y + height;
    }
  }

  class FakeRange {
    setStart(node, offset) {
      this.startContainer = node;
      this.startOffset = offset;
      this.endContainer = node;
      this.endOffset = offset;
      this.collapsed = true;
    }
    setEnd(node, offset) {
      this.endContainer = node;
      this.endOffset = offset;
      this.collapsed = this.startOffset === offset;
    }
    collapse() {
      this.endOffset = this.startOffset;
      this.collapsed = true;
    }
    // The browser's own measurement. Both public methods read it directly, so
    // neither can be satisfied by the other one's patch.
    measure() {
      const text = this.startContainer?.data ?? '';
      if (!this.collapsed) {
        const glyph = rtlRun(text.length)(this.startOffset);
        if (!glyph) return [];
        // WebKit prefixes a zero-width sentinel parked on the previous line when
        // a glyph opens a new line or a new bidi run.
        return phantomGlyphRects ? [rect(999, 999, 100), glyph] : [glyph];
      }
      if (this.startOffset === text.length && isBrokenBoundary(text)) return [];
      return [rect(100 - CHAR_WIDTH * this.startOffset, 100 - CHAR_WIDTH * this.startOffset)];
    }
    getClientRects() {
      return this.measure();
    }
    getBoundingClientRect() {
      return this.measure()[0] ?? new FakeDOMRect(0, 0, 0, 0);
    }
  }

  const createTextNode = (data, parentElement) => ({ nodeType: 3, data, parentElement, ownerDocument: null });

  const createElement = () => {
    const element = {
      style: { cssText: '' },
      firstChild: null,
      setAttribute: () => {},
      appendChild: (child) => child,
      remove: () => {},
      set textContent(value) {
        this.firstChild = createTextNode(value, this);
        this.firstChild.ownerDocument = document;
      },
    };
    return element;
  };

  const document = {
    createRange: () => new FakeRange(),
    createElement,
    body: {
      appendChild: (element) => {
        bodyChildren.push(element);
      },
    },
  };

  const window = {
    Range: FakeRange,
    DOMRect: FakeDOMRect,
    document,
    getComputedStyle: (element) => ({
      display: element?.display ?? 'block',
      direction: element?.direction ?? 'rtl',
    }),
  };
  document.defaultView = window;

  /**
   * A text node painted inside (or outside) a mounted SuperDoc runtime.
   *
   * `runDirection` wraps it in an inline run span carrying its own `dir`, which
   * is what the painter emits around a numeric or Latin run.
   */
  const textNode = (data, { owned = true, runDirection = null, paragraphDirection = 'rtl' } = {}) => {
    const runtimeRoot = { tagName: 'DIV' };
    const closest = (selector) => (owned && selector === '[data-superdoc-runtime-id]' ? runtimeRoot : null);
    const paragraph = { tagName: 'DIV', display: 'block', direction: paragraphDirection, closest };
    const parentElement = runDirection
      ? { tagName: 'SPAN', display: 'inline', direction: runDirection, parentElement: paragraph, closest }
      : paragraph;
    const node = createTextNode(data, parentElement);
    node.ownerDocument = document;
    return node;
  };

  const caretAt = (node, offset) => {
    const range = new FakeRange();
    range.setStart(node, offset);
    range.collapse();
    return range;
  };

  return { window, document, FakeRange, textNode, caretAt, bodyChildren };
}

describe('detectCollapsedCaretRectQuirk', () => {
  it('reports the quirk when the control boundary measures but the target one does not', () => {
    expect(detectCollapsedCaretRectQuirk(createFakeWindow().document)).toBe('quirk');
  });

  it('reports the quirk from any probed boundary, not only the trailing-space one', () => {
    // A WebKit that fixed only RTL trailing whitespace still misplaces the caret
    // after a trailing digit, so detection must not hinge on a single case.
    const partiallyFixed = createFakeWindow({ isBrokenBoundary: (text) => /\d$/.test(text) });
    expect(detectCollapsedCaretRectQuirk(partiallyFixed.document)).toBe('quirk');
  });

  it('reports a correct engine as clean', () => {
    expect(detectCollapsedCaretRectQuirk(createFakeWindow({ isBrokenBoundary: () => false }).document)).toBe('clean');
  });

  it('reports an environment without layout as unknown, not as a quirk', () => {
    // happy-dom returns no client rects at all, exactly like jsdom and SSR. An
    // engine cannot be called quirky for measuring nothing anywhere.
    expect(detectCollapsedCaretRectQuirk(document)).toBe('unknown');
    expect(detectCollapsedCaretRectQuirk(null)).toBe('unknown');
    expect(detectCollapsedCaretRectQuirk(undefined)).toBe('unknown');
  });

  it('reports unknown instead of throwing when the host has broken the DOM it needs', () => {
    const { document: doc } = createFakeWindow();
    doc.createElement = () => {
      throw new Error('host instrumentation');
    };
    expect(detectCollapsedCaretRectQuirk(doc)).toBe('unknown');
  });
});

describe('installWebKitCollapsedCaretRectFix', () => {
  // The suite asserts against the real test-env window; make sure a runner that
  // ever reports layout cannot leave this realm patched for other suites.
  const nativeGetClientRects = Range.prototype.getClientRects;
  const nativeGetBoundingClientRect = Range.prototype.getBoundingClientRect;
  afterEach(() => {
    Range.prototype.getClientRects = nativeGetClientRects;
    Range.prototype.getBoundingClientRect = nativeGetBoundingClientRect;
  });

  it('does not patch a browser that measures the boundary correctly', () => {
    expect(installWebKitCollapsedCaretRectFix(window)).toBeNull();
    expect(installWebKitCollapsedCaretRectFix(createFakeWindow({ isBrokenBoundary: () => false }).window)).toBeNull();
    expect(installWebKitCollapsedCaretRectFix(null)).toBeNull();
    expect(installWebKitCollapsedCaretRectFix({})).toBeNull();
  });

  it('answers the unmeasurable caret with the logical end of the trailing space', () => {
    const { window: quirky, textNode, caretAt } = createFakeWindow();
    const uninstall = installWebKitCollapsedCaretRectFix(quirky);
    expect(uninstall).toBeTypeOf('function');

    const range = caretAt(textNode(HEBREW_SPACE), 5);
    const rects = Array.from(range.getClientRects());
    expect(rects).toHaveLength(1);
    // Logical end of the RTL run: the LEFT edge of the trailing space.
    expect(rects[0].left).toBe(100 - CHAR_WIDTH * 5);
    expect(rects[0].width).toBe(0);
    expect(rects[0].height).toBe(LINE_HEIGHT);
    expect(range.getBoundingClientRect().left).toBe(100 - CHAR_WIDTH * 5);

    uninstall();
  });

  it('reads the paragraph direction, not the direction of the inline run span', () => {
    // The painter puts `dir` on individual run spans, but a neutral at the end
    // of a line takes the direction of the block that contains it.
    const { window: quirky, textNode, caretAt } = createFakeWindow();
    const uninstall = installWebKitCollapsedCaretRectFix(quirky);

    const inLtrRunSpan = caretAt(textNode(HEBREW_SPACE, { runDirection: 'ltr' }), 5);
    expect(Array.from(inLtrRunSpan.getClientRects())[0].left).toBe(100 - CHAR_WIDTH * 5);

    uninstall();
  });

  it('leaves text outside a mounted SuperDoc runtime to the browser', () => {
    // The patch is global, so the host page's own ranges must keep the browser's
    // answer byte for byte — including "no rects", which hosts read as
    // "not rendered".
    const { window: quirky, textNode, caretAt } = createFakeWindow();
    const uninstall = installWebKitCollapsedCaretRectFix(quirky);

    const outside = caretAt(textNode(HEBREW_SPACE, { owned: false }), 5);
    expect(Array.from(outside.getClientRects())).toHaveLength(0);
    expect(outside.getBoundingClientRect().height).toBe(0);

    uninstall();
  });

  it('ignores the zero-width sentinel WebKit puts in front of a glyph', () => {
    const { window: quirky, textNode, caretAt } = createFakeWindow({ phantomGlyphRects: true });
    const uninstall = installWebKitCollapsedCaretRectFix(quirky);

    const caret = Array.from(caretAt(textNode(HEBREW_SPACE), 5).getClientRects())[0];
    // Taking the sentinel would put the caret at x=999 on the previous line.
    expect(caret.left).toBe(100 - CHAR_WIDTH * 5);
    expect(caret.top).toBe(0);

    uninstall();
  });

  it('passes a boundary the browser does measure straight through', () => {
    const { window: quirky, textNode, caretAt } = createFakeWindow();
    const uninstall = installWebKitCollapsedCaretRectFix(quirky);

    expect(Array.from(caretAt(textNode(HEBREW_SPACE), 3).getClientRects())[0].left).toBe(100 - CHAR_WIDTH * 3);
    uninstall();
  });

  it('leaves a non-collapsed range and a non-text range alone', () => {
    const { window: quirky, document: doc, FakeRange, textNode } = createFakeWindow();
    const uninstall = installWebKitCollapsedCaretRectFix(quirky);

    const spanning = new FakeRange();
    spanning.setStart(textNode(HEBREW_SPACE), 0);
    spanning.setEnd(spanning.startContainer, 5);
    expect(Array.from(spanning.getClientRects())).toHaveLength(1);

    const element = new FakeRange();
    element.setStart({ nodeType: 1, ownerDocument: doc }, 0);
    element.collapse();
    expect(Array.from(element.getClientRects())).toHaveLength(1);

    uninstall();
  });

  it('returns a DOMRectList-like result rather than an Array', () => {
    const { window: quirky, textNode, caretAt } = createFakeWindow();
    const uninstall = installWebKitCollapsedCaretRectFix(quirky);

    const rects = caretAt(textNode(HEBREW_SPACE), 5).getClientRects();
    expect(Array.isArray(rects)).toBe(false);
    expect(rects.length).toBe(1);
    expect(rects[0]).toBeDefined();
    expect(rects.item(0)).toBe(rects[0]);
    expect(rects.item(1)).toBeNull();
    expect([...rects]).toHaveLength(1);
    expect(Array.from(rects)).toHaveLength(1);

    uninstall();
  });

  it('installs once and restores the native methods on uninstall', () => {
    const { window: quirky, FakeRange } = createFakeWindow();
    const native = FakeRange.prototype.getClientRects;

    const uninstall = installWebKitCollapsedCaretRectFix(quirky);
    expect(FakeRange.prototype.getClientRects).not.toBe(native);

    const patched = FakeRange.prototype.getClientRects;
    const second = installWebKitCollapsedCaretRectFix(quirky);
    expect(FakeRange.prototype.getClientRects).toBe(patched);
    second?.();

    uninstall?.();
    expect(FakeRange.prototype.getClientRects).toBe(native);
  });

  it('probes a correct engine only once, however many editors are constructed', () => {
    // The probe forces a layout and delivers mutation records to any host
    // observing document.body, so it must not repeat per editor.
    const { window: clean, bodyChildren } = createFakeWindow({ isBrokenBoundary: () => false });
    installWebKitCollapsedCaretRectFix(clean);
    installWebKitCollapsedCaretRectFix(clean);
    installWebKitCollapsedCaretRectFix(clean);
    expect(bodyChildren).toHaveLength(1);
  });

  it('answers the browser rather than throwing when the host has broken the DOM it reads', () => {
    // `getClientRects` is specified never to throw for a valid range. A host that
    // has instrumented `closest` or `getComputedStyle` — an extension, a hardened
    // realm, a test stub — must not be able to turn every Range on the page into
    // a throwing API through this patch.
    for (const breakage of ['closest', 'getComputedStyle']) {
      const { window, textNode, caretAt } = createFakeWindow();
      installWebKitCollapsedCaretRectFix(window);
      const node = textNode(HEBREW_SPACE);
      if (breakage === 'closest') {
        node.parentElement.closest = () => {
          throw new Error('host instrumentation');
        };
      } else {
        window.getComputedStyle = () => {
          throw new Error('host instrumentation');
        };
      }
      const caret = caretAt(node, HEBREW_SPACE.length);
      expect(() => caret.getClientRects()).not.toThrow();
      expect(() => caret.getBoundingClientRect()).not.toThrow();
      expect(Array.from(caret.getClientRects())).toHaveLength(0);
    }
  });

  it('recognises text inside a shadow root under the runtime, which closest() cannot reach', () => {
    // SuperDoc mounts painter content inside a shadow root in at least one
    // supported embedding, which is why the shell reads pointer targets through
    // composedPath(). `closest()` stops at that boundary.
    const { window, textNode, caretAt } = createFakeWindow();
    installWebKitCollapsedCaretRectFix(window);
    const node = textNode(HEBREW_SPACE, { owned: false });
    const runtimeRoot = { tagName: 'DIV' };
    const host = {
      nodeType: 1,
      tagName: 'DIV',
      closest: (selector) => (selector === '[data-superdoc-runtime-id]' ? runtimeRoot : null),
    };
    node.parentElement.getRootNode = () => ({ host });
    expect(Array.from(caretAt(node, HEBREW_SPACE.length).getClientRects())).toHaveLength(1);
  });

  it('leaves a text node with no parent element to the browser', () => {
    const { window, textNode, caretAt } = createFakeWindow();
    installWebKitCollapsedCaretRectFix(window);
    const node = textNode(HEBREW_SPACE);
    node.parentElement = null;
    expect(Array.from(caretAt(node, HEBREW_SPACE.length).getClientRects())).toHaveLength(0);
  });

  it('hides length and item from enumeration, as a real DOMRectList does', () => {
    // A real DOMRectList exposes `length` as a non-enumerable accessor and `item`
    // on its prototype, so neither appears in Object.keys or JSON.stringify. Host
    // logging and deep-equality assertions compare against that shape.
    const { window, textNode, caretAt } = createFakeWindow();
    installWebKitCollapsedCaretRectFix(window);
    const rects = caretAt(textNode(HEBREW_SPACE), HEBREW_SPACE.length).getClientRects();
    expect(Object.keys(rects)).toEqual(['0']);
    expect(JSON.parse(JSON.stringify(rects))).not.toHaveProperty('length');
    expect(rects.length).toBe(1);
    expect(typeof rects.item).toBe('function');
  });

  it('reinstates itself when a host replaces the patched method outright', () => {
    // Wrapping composes; replacing does not, and the workaround would otherwise
    // be gone for the rest of the page's life with no way to notice.
    const { window, FakeRange, textNode, caretAt } = createFakeWindow();
    installWebKitCollapsedCaretRectFix(window);
    const native = FakeRange.prototype.measure;
    FakeRange.prototype.getClientRects = function replaced() {
      return native.call(this);
    };
    expect(Array.from(caretAt(textNode(HEBREW_SPACE), HEBREW_SPACE.length).getClientRects())).toHaveLength(0);

    installWebKitCollapsedCaretRectFix(window);
    expect(Array.from(caretAt(textNode(HEBREW_SPACE), HEBREW_SPACE.length).getClientRects())).toHaveLength(1);
  });

  it('stops re-probing a window that can never be measured', () => {
    // Each probe forces a layout and delivers two childList records to any host
    // observing document.body, so a page building many editors without layout
    // must not pay it for every one of them.
    const { window, bodyChildren } = createFakeWindow();
    window.document.createRange = () => ({
      setStart: () => {},
      setEnd: () => {},
      collapse: () => {},
      getClientRects: () => [],
      getBoundingClientRect: () => null,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) installWebKitCollapsedCaretRectFix(window);
    expect(bodyChildren.length).toBeLessThanOrEqual(8);
  });

  it('declines instead of throwing when the realm refuses the patch', () => {
    // SES/Lockdown and similar hardened embeds freeze built-in prototypes. A
    // caret workaround must never reject the engine-load promise, which would
    // drop the editor to its fail-closed stub.
    const { window: quirky, FakeRange } = createFakeWindow();
    const native = FakeRange.prototype.getClientRects;
    Object.freeze(FakeRange.prototype);

    expect(installWebKitCollapsedCaretRectFix(quirky)).toBeNull();
    expect(FakeRange.prototype.getClientRects).toBe(native);
  });

  it('declines instead of throwing when the host has instrumented the DOM', () => {
    const { window: quirky, document: doc, FakeRange } = createFakeWindow();
    const native = FakeRange.prototype.getClientRects;
    doc.body.appendChild = () => {
      throw new Error('host instrumentation');
    };

    expect(installWebKitCollapsedCaretRectFix(quirky)).toBeNull();
    expect(FakeRange.prototype.getClientRects).toBe(native);
  });
});
