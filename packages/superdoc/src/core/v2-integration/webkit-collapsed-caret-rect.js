// WebKit browser-bug workaround for the V2 caret.
//
// WebKit returns an EMPTY client-rect list for a **collapsed** `Range` placed at
// the end of a text node, in a range of situations where Chromium and Firefox
// both report the caret correctly. `Range.getBoundingClientRect()` is no better
// in that state: it reports an all-zero rect. A *non-collapsed* range over the
// same character is measured correctly by every engine, WebKit included, which
// is what makes a repair possible at all.
//
// Measured triggers (`dir` x `white-space` x trailing character sweep), all at
// the end-of-text-node boundary:
//   - RTL text with preserved whitespace ending in a space or tab,
//   - RTL text ending in a digit or a Latin letter, in ANY white-space mode,
//   - LTR text ending in a digit, in ANY white-space mode.
// A trailing NBSP is measured correctly everywhere. What these share is a
// boundary the bidi algorithm treats as a level or whitespace edge, so
// installation keys off the *measurement failing*, never off a character class.
//
// The engine's caret layer resolves the caret from that collapsed range and,
// when it comes back empty, falls back to an adjacent character's rect. Its
// fallback picks LTR edges (the *right* edge of the preceding character), so in
// an RTL paragraph the caret is painted at the boundary *before* the trailing
// space — one position behind where typing actually continues. Hebrew and Arabic
// authors hit this between every two words, which is most of the time they are
// typing. See https://github.com/superdoc/docx-editor/issues/3943. (The LTR
// trailing-digit case is invisible only because the LTR edge happens to be the
// right answer there.)
//
// This module restores the missing measurement at its source: it wraps
// `Range.getClientRects` / `Range.getBoundingClientRect` so that a collapsed
// range inside a text node the browser refuses to measure is answered from the
// neighbouring character's rect plus that character's own bidi direction.
//
// Three deliberate choices, because this patches a DOM built-in in a library
// that is embedded in someone else's page:
//   - It only ever answers for text inside a mounted SuperDoc runtime. A range
//     anywhere else in the host page gets the browser's own result, byte for
//     byte, so host code that reads "no rects" as "not rendered" keeps seeing
//     exactly what it sees today.
//   - It is installed only after the quirk is observed in the live browser, so
//     Chromium, Firefox, a fixed future WebKit, and non-layout environments
//     (jsdom, SSR) run entirely unpatched.
//   - Installation can never throw. A caret nicety must not be able to reject
//     the engine-load promise and drop the editor to its fail-closed stub, so
//     every step is guarded and failure degrades to "not installed".
//
// Once installed it stays for the page's lifetime rather than being undone on
// `destroy()`: the patch belongs to the realm, not to one editor, and tearing it
// down would regress any other live instance. The returned uninstall exists for
// tests and for a host that wants explicit control.
//
// The durable fix belongs in the engine's caret resolver, which should pick the
// *logical* edge of the neighbouring glyph instead of assuming LTR. This shim
// can be deleted once that ships and the engine floor is raised past it.

import { RUNTIME_ROOT_ATTRIBUTE } from '../editor-runtime/root-marker.js';

/**
 * Boundaries to probe for the defect, each `[direction, whiteSpace, text]`.
 *
 * Detecting only the reported RTL trailing-space case would silently drop the
 * workaround for the others the moment WebKit fixes that one boundary alone, so
 * every measured trigger family is probed and any single failure installs.
 */
const PROBE_CASES = [
  ['rtl', 'pre', 'שלום '],
  ['rtl', 'normal', 'שלום 1'],
  ['ltr', 'normal', 'abc 1'],
];

/** Marks this module's own patched methods, so a second install is a no-op. */
const INSTALLED_FLAG = '__superdocWebkitCollapsedCaretRectFix';

/**
 * How many times a window that cannot be measured at all is re-probed before the
 * workaround gives up on it.
 *
 * A window is deliberately not cached as clean while it answers "unknown": it
 * may simply have had no layout yet, and re-probing costs less than never
 * installing. But each probe forces a layout and delivers two childList records
 * to any host observing `document.body`, so a page that constructs many editors
 * in an environment without layout should not pay it indefinitely.
 */
const MAX_UNKNOWN_PROBES = 4;

/** @type {WeakMap<object, number>} Unmeasurable probes spent per window. */
const probeCounts = new WeakMap();

/** Selector for the shell-owned wrapper around a mounted runtime. */
const RUNTIME_ROOT_SELECTOR = `[${RUNTIME_ROOT_ATTRIBUTE}]`;

/**
 * Windows already measured and found correct, so repeated editor construction
 * on Chromium does not re-probe — each probe costs a forced layout and delivers
 * mutation records to any host observing `document.body`. A window that could
 * not be measured at all is deliberately NOT cached: it may simply have had no
 * layout yet, and re-probing costs less than never installing.
 *
 * @type {WeakSet<object>}
 */
const measuredCleanWindows = new WeakSet();

/**
 * First rect with height, read by index so a long list is never copied — this
 * runs on every `getClientRects()` call in the page once installed.
 *
 * A zero-*width* rect is legitimate here: a caret rect has no width.
 *
 * @param {DOMRectList | DOMRect[] | null | undefined} rects
 * @returns {DOMRect | null}
 */
const firstRectWithHeight = (rects) => {
  const length = rects?.length ?? 0;
  for (let index = 0; index < length; index += 1) {
    const rect = rects[index];
    if (rect && rect.height > 0) return rect;
  }
  return null;
};

/**
 * First rect that can be a *glyph*, which additionally requires width.
 *
 * A one-character range whose glyph opens a new line or a new bidi run returns
 * two rects in WebKit: a zero-width sentinel parked at the end of the previous
 * line, then the glyph itself. Accepting the sentinel would take its edges and
 * its `top`, painting the caret on the wrong line.
 *
 * @param {DOMRectList | DOMRect[] | null | undefined} rects
 * @returns {DOMRect | null}
 */
const firstGlyphRect = (rects) => {
  const length = rects?.length ?? 0;
  for (let index = 0; index < length; index += 1) {
    const rect = rects[index];
    if (rect && rect.height > 0 && rect.width > 0) return rect;
  }
  return null;
};

/**
 * Character sets for the Unicode Bidirectional Algorithm classes this module
 * has to tell apart. Each is mechanically derived from `DerivedBidiClass.txt`
 * (Unicode 17.0.0) rather than approximated by a general category, because the
 * two disagree in exactly the places that matter here: Arabic-Indic digits are
 * numbers inside a right-to-left block, NKo and Adlam digits are right-to-left
 * despite being digits, and `½` is a number that is not ordered as one.
 *
 * `֐-ࣿ` and the other block ranges are a superset of Bidi_Class R and AL,
 * narrowed by RTL_BLOCK_NEUTRAL below. Every character they cover that is not
 * R or AL is either resolved before the block is consulted (marks, numbers,
 * terminators) or listed there; that has been checked against the whole of
 * Unicode, so the pair is exact.
 */
const RTL_SCRIPT_BLOCK = /[\u0590-\u08FF\u200F\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/**
 * The 112 code points inside those blocks that are NOT Bidi_Class R or AL: the
 * Arabic comma, the ornate parentheses, the Arabic ligature and honorific
 * symbols, the NKo punctuation, the Arabic Extended-C signs, and the
 * noncharacters. They are neutral, so they take the paragraph's direction like
 * any other neutral.
 */
const RTL_BLOCK_NEUTRAL =
  /[\u0606-\u0607\u060C\u060E-\u060F\u06DE\u06E9\u07F6-\u07F9\uFB29\uFBC3-\uFBD2\uFD3E-\uFD4F\uFD90-\uFD91\uFDC8-\uFDEF\uFDFD-\uFDFF\uFEFF\u{1091F}\u{10B39}-\u{10B3F}\u{10D6E}\u{10ED0}-\u{10ED8}\u{1EEF0}-\u{1EEF1}]/u;

/** Bidi_Class EN — European numbers, ordered left-to-right at any embedding level. */
const EUROPEAN_NUMBER_CHAR =
  /[\u0030-\u0039\u00B2-\u00B3\u00B9\u06F0-\u06F9\u2070\u2074-\u2079\u2080-\u2089\u2488-\u249B\uFF10-\uFF19\u{102E1}-\u{102FB}\u{1CCF0}-\u{1CCF9}\u{1D7CE}-\u{1D7FF}\u{1F100}-\u{1F10A}\u{1FBF0}-\u{1FBF9}]/u;

/** Bidi_Class AN — Arabic numbers, also ordered left-to-right (rules I1/I2). */
const ARABIC_NUMBER_CHAR =
  /[\u0600-\u0605\u0660-\u0669\u066B-\u066C\u06DD\u0890-\u0891\u08E2\u{10D30}-\u{10D39}\u{10D40}-\u{10D49}\u{10E60}-\u{10E7E}]/u;

/** Bidi_Class ET — terminators that a neighbouring European number absorbs (rule W5). */
const NUMBER_TERMINATOR_CHAR =
  /[\u0023-\u0025\u00A2-\u00A5\u00B0-\u00B1\u058F\u0609-\u060A\u066A\u09F2-\u09F3\u09FB\u0AF1\u0BF9\u0E3F\u17DB\u2030-\u2034\u20A0-\u20CF\u212E\u2213\uA838-\uA839\uFE5F\uFE69-\uFE6A\uFF03-\uFF05\uFFE0-\uFFE1\uFFE5-\uFFE6\u{11FDD}-\u{11FE0}\u{1E2FF}]/u;

/** Bidi_Class AL — Arabic letters, which turn a following European number Arabic (rule W2). */
const ARABIC_LETTER_CHAR =
  /[\u0608\u060B\u060D\u061B-\u064A\u066D-\u066F\u0671-\u06D5\u06E5-\u06E6\u06EE-\u06EF\u06FA-\u0710\u0712-\u072F\u074B-\u07A5\u07B1-\u07BF\u0860-\u088F\u0892-\u0896\u08A0-\u08C9\uFB50-\uFBC2\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFC\uFE70-\uFEFE\u{10D00}-\u{10D23}\u{10D28}-\u{10D2F}\u{10D3A}-\u{10D3F}\u{10EC0}-\u{10ECF}\u{10ED9}-\u{10EF9}\u{10F30}-\u{10F45}\u{10F51}-\u{10F6F}\u{1EC70}-\u{1ECBF}\u{1ED00}-\u{1ED4F}\u{1EE00}-\u{1EEEF}\u{1EEF2}-\u{1EEFF}]/u;

/**
 * Bidi_Class NSM — non-spacing marks, which take the class of the character
 * before them (rule W1). Every NSM character is general category Mn or Me, and
 * all but five characters of those categories are NSM, so this needs only the
 * category test and the short exception list below.
 */
const MARK_CHAR = /[\p{Mn}\p{Me}]/u;

/**
 * The five characters that are general category Mn without being
 * Bidi_Class NSM — U+0CBF and U+0CC6 (Kannada), U+11A07 and U+11A08
 * (Zanabazar Square) and U+11C3F (Bhaiksuki). They are Bidi_Class L, so they
 * carry their own direction rather than inheriting the previous character's.
 */
const MARK_EXCEPTION_CHAR = /[\u0CBF\u0CC6\u{11A07}\u{11A08}\u{11C3F}]/u;

/**
 * The neutral classes — ON, WS, BN, B, S, CS, ES and the explicit formatting
 * codes — for what is left once the classes above are resolved.
 *
 * This is the last test, so everything it does not match is Bidi_Class L. That
 * is the right default: Unicode gives L to every code point it does not say
 * otherwise about, unassigned ones included, and the two blocks where the
 * default is something else — the right-to-left scripts and the currency
 * symbols — are both resolved above. Listing the neutrals rather than guessing
 * at the left-to-right ones is what makes the classification exact: general
 * categories cut across Bidi_Class badly here, since `½` and `①` are numbers
 * that are neutral, 620 decimal digits are plain left-to-right, and private use
 * and Indic spacing marks are left-to-right without being letters.
 *
 * Private use earns its place: a .docx symbol run (Wingdings, Symbol) maps to
 * U+F0xx, the Unicode default for private use is left-to-right, and Chromium
 * lays it out that way. What remains misread as neutral is punctuation and
 * symbols belonging to left-to-right scripts — 1.3% of assigned code points,
 * and visible only inside a right-to-left paragraph.
 */
// The C0 controls are in this set on purpose: Bidi_Class B, S and WS cover tab,
// the line and paragraph breaks, and the file and record separators, all of
// which are neutral and all of which a text node can hold.
const NEUTRAL_CHAR =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0040\u005B-\u0060\u007B-\u00A9\u00AB-\u00B4\u00B6-\u00B8\u00BB-\u00BF\u00D7\u00F7\u02B9-\u02BA\u02C2-\u02CF\u02D2-\u02DF\u02E5-\u02ED\u02EF-\u02FF\u0374-\u0375\u037E\u0384-\u0385\u0387\u03F6\u058A\u058D-\u07F9\u0BF3-\u0BFA\u0C78-\u0C7E\u0F3A-\u0F3D\u1390-\u1399\u1400\u1680\u169B-\u169C\u17F0-\u17F9\u1800-\u180E\u1940\u1944-\u1945\u19DE-\u19FF\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF\u1FDD-\u1FDF\u1FED-\u1FEF\u1FFD-\u1FFE\u2000-\u200D\u2010-\u206F\u207A-\u207E\u208A-\u208E\u2100-\u2101\u2103-\u2106\u2108-\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u213A-\u213B\u2140-\u2144\u214A-\u214D\u2150-\u215F\u2189-\u218B\u2190-\u2335\u237B-\u2394\u2396-\u2429\u2440-\u244A\u2460-\u2487\u24EA-\u26AB\u26AD-\u27FF\u2900-\u2B73\u2B76-\u2BFF\u2CE5-\u2CEA\u2CF9-\u2CFF\u2E00-\u2E5D\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u3004\u3008-\u3020\u3030\u3036-\u3037\u303D-\u303F\u309B-\u309C\u30A0\u30FB\u31C0-\u31E5\u31EF\u321D-\u321E\u3250-\u325F\u327C-\u327E\u32B1-\u32BF\u32CC-\u32CF\u3377-\u337A\u33DE-\u33DF\u33FF\u4DC0-\u4DFF\uA490-\uA4C6\uA60D-\uA60F\uA673-\uA67F\uA700-\uA721\uA788\uA828-\uA82B\uA874-\uA877\uAB6A-\uAB6B\uFB29-\uFE19\uFE30-\uFE52\uFE54-\uFE66\uFE68-\uFE6B\uFEFF\uFF01-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\uFFE2-\uFFE4\uFFE8-\uFFEE\uFFF0-\uFFFF\u{10101}\u{10140}-\u{1018C}\u{10190}-\u{1019C}\u{101A0}\u{1091F}-\u{10ED8}\u{11052}-\u{11065}\u{11660}-\u{1166C}\u{11FD5}-\u{11FF1}\u{16FE2}\u{1BCA0}-\u{1BCA3}\u{1CC00}-\u{1CCD5}\u{1CCFA}-\u{1CCFC}\u{1CD00}-\u{1CEB3}\u{1CEBA}-\u{1CED0}\u{1CEE0}-\u{1CEF0}\u{1D173}-\u{1D17A}\u{1D1E9}-\u{1D1EA}\u{1D200}-\u{1D245}\u{1D300}-\u{1D356}\u{1D6C1}\u{1D6DB}\u{1D6FB}\u{1D715}\u{1D735}\u{1D74F}\u{1D76F}\u{1D789}\u{1D7A9}\u{1D7C3}\u{1EEF0}-\u{1F02B}\u{1F030}-\u{1F093}\u{1F0A0}-\u{1F0AE}\u{1F0B1}-\u{1F0BF}\u{1F0C1}-\u{1F0CF}\u{1F0D1}-\u{1F0F5}\u{1F10B}-\u{1F10F}\u{1F12F}\u{1F16A}-\u{1F16F}\u{1F1AD}\u{1F260}-\u{1F265}\u{1F300}-\u{1F6D8}\u{1F6DC}-\u{1F6EC}\u{1F6F0}-\u{1F6FC}\u{1F700}-\u{1F7D9}\u{1F7E0}-\u{1F7EB}\u{1F7F0}\u{1F800}-\u{1F80B}\u{1F810}-\u{1F847}\u{1F850}-\u{1F859}\u{1F860}-\u{1F887}\u{1F890}-\u{1F8AD}\u{1F8B0}-\u{1F8BB}\u{1F8C0}-\u{1F8C1}\u{1F8D0}-\u{1F8D8}\u{1F900}-\u{1FA57}\u{1FA60}-\u{1FA6D}\u{1FA70}-\u{1FA7C}\u{1FA80}-\u{1FA8A}\u{1FA8E}-\u{1FAC6}\u{1FAC8}\u{1FACD}-\u{1FADC}\u{1FADF}-\u{1FAEA}\u{1FAEF}-\u{1FAF8}\u{1FB00}-\u{1FB92}\u{1FB94}-\u{1FBFA}\u{1FFFE}-\u{1FFFF}\u{2FFFE}-\u{2FFFF}\u{3FFFE}-\u{3FFFF}\u{4FFFE}-\u{4FFFF}\u{5FFFE}-\u{5FFFF}\u{6FFFE}-\u{6FFFF}\u{7FFFE}-\u{7FFFF}\u{8FFFE}-\u{8FFFF}\u{9FFFE}-\u{9FFFF}\u{AFFFE}-\u{AFFFF}\u{BFFFE}-\u{BFFFF}\u{CFFFE}-\u{CFFFF}\u{DFFFE}-\u{E0FFF}\u{EFFFE}-\u{EFFFF}\u{FFFFE}-\u{FFFFF}\u{10FFFE}-\u{10FFFF}]/u;

const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;

/**
 * Index of the first UTF-16 unit of the code point covering `index`, so an
 * offset that lands on a low surrogate refers to the whole pair.
 *
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function codePointStart(text, index) {
  const unit = text.charCodeAt(index);
  if (!(unit >= LOW_SURROGATE_START && unit <= LOW_SURROGATE_END) || index <= 0) return index;
  const before = text.charCodeAt(index - 1);
  return before >= HIGH_SURROGATE_START && before <= HIGH_SURROGATE_END ? index - 1 : index;
}

/**
 * Index just past the code point covering `index`.
 *
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function codePointEnd(text, index) {
  const start = codePointStart(text, index);
  const code = text.codePointAt(start);
  return start + (code !== undefined && code > 0xffff ? 2 : 1);
}

/**
 * The whole character at `index`, so a surrogate pair is classified as the
 * character it encodes rather than as half of one.
 *
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function characterAt(text, index) {
  const code = text.codePointAt(codePointStart(text, index));
  return code === undefined ? '' : String.fromCodePoint(code);
}

const CLASS_RTL = 1;
const CLASS_LTR = 2;
const CLASS_NUMBER = 3;
const CLASS_TERMINATOR = 4;
const CLASS_NEUTRAL = 5;
const CLASS_MARK = 6;

/**
 * Coarse Bidi_Class of one character: the six groups this module has to
 * distinguish, in the order the algorithm resolves them.
 *
 * @param {string} char
 * @returns {number}
 */
function classOf(char) {
  if (MARK_CHAR.test(char) && !MARK_EXCEPTION_CHAR.test(char)) return CLASS_MARK;
  if (EUROPEAN_NUMBER_CHAR.test(char) || ARABIC_NUMBER_CHAR.test(char)) return CLASS_NUMBER;
  if (NUMBER_TERMINATOR_CHAR.test(char)) return CLASS_TERMINATOR;
  if (RTL_SCRIPT_BLOCK.test(char)) return RTL_BLOCK_NEUTRAL.test(char) ? CLASS_NEUTRAL : CLASS_RTL;
  if (NEUTRAL_CHAR.test(char)) return CLASS_NEUTRAL;
  return CLASS_LTR;
}

/**
 * The 64 bracket pairs of `BidiBrackets.txt` (Unicode 17.0.0), index-aligned:
 * the closing bracket for `BRACKET_OPENINGS[i]` is `BRACKET_CLOSINGS[i]`.
 */
const BRACKET_OPENINGS =
  '\u0028\u005B\u007B\u0F3A\u0F3C\u169B\u2045\u207D\u208D\u2308\u230A\u2329\u2768\u276A\u276C\u276E\u2770\u2772\u2774\u27C5\u27E6\u27E8\u27EA\u27EC\u27EE\u2983\u2985\u2987\u2989\u298B\u298D\u298F\u2991\u2993\u2995\u2997\u29D8\u29DA\u29FC\u2E22\u2E24\u2E26\u2E28\u2E55\u2E57\u2E59\u2E5B\u3008\u300A\u300C\u300E\u3010\u3014\u3016\u3018\u301A\uFE59\uFE5B\uFE5D\uFF08\uFF3B\uFF5B\uFF5F\uFF62';
const BRACKET_CLOSINGS =
  '\u0029\u005D\u007D\u0F3B\u0F3D\u169C\u2046\u207E\u208E\u2309\u230B\u232A\u2769\u276B\u276D\u276F\u2771\u2773\u2775\u27C6\u27E7\u27E9\u27EB\u27ED\u27EF\u2984\u2986\u2988\u298A\u298C\u2990\u298E\u2992\u2994\u2996\u2998\u29D9\u29DB\u29FD\u2E23\u2E25\u2E27\u2E29\u2E56\u2E58\u2E5A\u2E5C\u3009\u300B\u300D\u300F\u3011\u3015\u3017\u3019\u301B\uFE5A\uFE5C\uFE5E\uFF09\uFF3D\uFF5D\uFF60\uFF63';

/** BD16 caps its stack at 63 pairs and stops looking for pairs beyond that. */
const MAX_BRACKET_PAIRS = 63;

/**
 * U+2329 and U+232A are canonically equivalent to U+3008 and U+3009, and BD16
 * matches brackets across that equivalence. They are the only two in the table.
 *
 * @param {string} char
 * @returns {string}
 */
function canonicalBracket(char) {
  if (char === '\u2329') return '\u3008';
  if (char === '\u232A') return '\u3009';
  return char;
}

/**
 * What the rules need to know about one text node's characters, worked out as
 * they ask for it and kept for as long as that text stands.
 *
 * For a given character the rules need the nearest strong character on each
 * side, the character a mark sits on, whether a terminator touches a European
 * number, and where the bracket pairs are. None of that can be cut off at a
 * fixed distance: past a cutoff a neutral run stops seeing the strong characters
 * around it and a wide bracket pair stops being a pair, so the answer changes.
 * Nor can it be worked out for the whole node up front, because every keystroke
 * replaces the text: a node analysed in full on each one makes a typing session
 * quadratic, twelve milliseconds a keystroke in a twenty-thousand character
 * paragraph.
 *
 * So each answer is worked out from the character outward, and written back over
 * every position the walk passed — they all share it, which is what makes this
 * sound. One resolution costs the distance to the nearest strong character, one
 * character in ordinary text, and every resolution over one text together costs
 * a single pass over it however they are spread.
 *
 * Zero means "not worked out yet" in every table, and each table is allocated
 * the first time a rule reaches for it, so the common answers cost neither a
 * pass nor an allocation. An edit hands on the half of the tables it cannot have
 * changed, so a keystroke never walks a run twice.
 *
 * Only the paragraph-independent half is worked out here, so a character that
 * carries its own direction still resolves without reading the paragraph's,
 * which forces a style recalc.
 *
 * @typedef {object} TextAnalysis
 * @property {string} text The text every index below refers to.
 * @property {Int8Array | null} classes Coarse Bidi_Class, at each code point's first unit.
 * @property {Int32Array | null} baseBefore The character a mark sits on, biased (rule W1).
 * @property {Int8Array | null} strongBefore Direction of the nearest strong character before each index.
 * @property {Int8Array | null} strongAfter The same, after each index.
 * @property {Uint8Array | null} letterBefore Nearest strong letter before each index (rule W2).
 * @property {Int32Array | null} runFirst Left end of the terminator run reaching each index, biased (rule W5).
 * @property {Int32Array | null} runPast Right end of that run, biased.
 * @property {Map<number, BracketPair> | null} bracketPairs Built the first time a bracket is asked about.
 */

/**
 * @typedef {object} BracketPair
 * @property {number} open
 * @property {number} close
 * @property {{ rtl: boolean, ltr: boolean } | null} enclosed Filled in on first use.
 */

/** Every table reads zero as "this position has not been worked out yet". */
const NOT_WORKED_OUT = 0;

/** Direction of the nearest strong character. Numbers count as right-to-left, as rule N1 has them. */
const STRONG_NONE = 1;
const STRONG_LTR = 2;
const STRONG_RTL = 3;

/** The nearest strong *letter*, which is what rule W2 reads — a number does not stand in for one there. */
const LETTER_NONE = 1;
const LETTER_LTR = 2;
const LETTER_RTL = 3;
const LETTER_ARABIC = 4;

/** A mark's base character, stored as its index plus two so zero stays free for "not worked out". */
const BASE_NONE = 1;
const BASE_BIAS = 2;

/**
 * @param {string} text
 * @returns {TextAnalysis}
 */
function createAnalysis(text) {
  return {
    text,
    classes: null,
    baseBefore: null,
    strongBefore: null,
    strongAfter: null,
    letterBefore: null,
    runFirst: null,
    runPast: null,
    bracketPairs: null,
  };
}

/**
 * Positions the walks below have visited, in total, since the module loaded.
 *
 * This is the module's cost: a resolution costs exactly the positions its walks
 * cross, and every guarantee above about that cost — one pass per text however
 * many carets, a handful of positions per keystroke — is a statement about this
 * number. The tests that pin those guarantees read it instead of a clock, so
 * they fail the same way on a loaded CI runner as on a quiet desktop, and a
 * regression to a walk per caret is a count a thousand times over, not a
 * budget missed by a few milliseconds. One increment per position walked, on a
 * path that is already reading a typed array; nothing in production reads it.
 */
let positionsWalked = 0;

/**
 * @internal For the cost tests only. Everything else about this module shows in
 * its answers; how much of the text it read to give them does not.
 * @returns {number}
 */
export function positionsWalkedSoFar() {
  return positionsWalked;
}

/**
 * The analysis of the text the caret is in, kept so that resolutions in one text
 * share their walks. One entry is enough: the caret is resolved in the node it
 * is in, and moving to another node is not the case that repeats.
 *
 * @type {TextAnalysis | null}
 */
let lastAnalysis = null;

/**
 * @param {string} text
 * @returns {TextAnalysis}
 */
function analysisFor(text) {
  const previous = lastAnalysis;
  if (previous?.text === text) return previous;
  lastAnalysis = createAnalysis(text);
  if (previous) carryUnchangedPrefix(previous, lastAnalysis);
  return lastAnalysis;
}

/**
 * Keep what an edit did not invalidate.
 *
 * Everything worked out about a character from the text *before* it — its own
 * class, the character a mark sits on, and the nearest strong character and
 * strong letter behind it — is still true when the text after it changes. So an
 * edit hands those on for the part of the text it left alone, and a keystroke
 * never re-walks a run that has already been walked, even one with no strong
 * character in it at all.
 *
 * What a position has *after* it, and the bracket pairing, are dropped: an edit
 * moves both.
 *
 * @param {TextAnalysis} previous
 * @param {TextAnalysis} analysis
 */
function carryUnchangedPrefix(previous, analysis) {
  const text = analysis.text;
  const previousText = previous.text;
  // Typing and backspacing leave one text a prefix of the other, which the
  // engine answers with a single comparison; anything else is compared until it
  // differs, which is where the edit was.
  let shared;
  if (text.startsWith(previousText)) shared = previousText.length;
  else if (previousText.startsWith(text)) shared = text.length;
  else {
    const limit = Math.min(previousText.length, text.length);
    shared = 0;
    while (shared < limit && previousText.charCodeAt(shared) === text.charCodeAt(shared)) shared += 1;
  }
  // A code point the edit split is worked out again, whichever text it is whole
  // in: the units before it are the same in both, but the character they encode
  // need not be. An edit that completes a pair leaves the whole in the new text;
  // one that takes its low surrogate away, or puts something else there, leaves
  // the whole in the old text and a half in the new, and the half must not
  // inherit the whole's class.
  const kept = Math.min(codePointStart(text, shared), codePointStart(previousText, shared));
  if (kept <= 0) return;

  const carry = (table, Table) => {
    if (!table) return null;
    const carried = new Table(text.length);
    carried.set(table.subarray(0, kept));
    return carried;
  };
  analysis.classes = carry(previous.classes, Int8Array);
  analysis.baseBefore = carry(previous.baseBefore, Int32Array);
  analysis.strongBefore = carry(previous.strongBefore, Int8Array);
  analysis.letterBefore = carry(previous.letterBefore, Uint8Array);
  analysis.runFirst = carry(previous.runFirst, Int32Array);
}

/**
 * Coarse Bidi_Class of the code point starting at `at`, worked out once.
 *
 * @param {TextAnalysis} analysis
 * @param {number} at First UTF-16 unit of a code point.
 * @returns {number}
 */
function classAt(analysis, at) {
  const classes = analysis.classes ?? (analysis.classes = new Int8Array(analysis.text.length));
  const known = classes[at];
  if (known !== NOT_WORKED_OUT) return known;
  const charClass = classOf(characterAt(analysis.text, at));
  classes[at] = charClass;
  return charClass;
}

/**
 * Rule W1: the character a mark takes its class from, or -1 when the text starts
 * with the mark. A run of marks all sit on the same character, so the walk
 * writes its answer over the whole run.
 *
 * @param {TextAnalysis} analysis
 * @param {number} at First UTF-16 unit of a code point.
 * @returns {number}
 */
function baseBefore(analysis, at) {
  if (classAt(analysis, at) !== CLASS_MARK) return at;
  const text = analysis.text;
  const table = analysis.baseBefore ?? (analysis.baseBefore = new Int32Array(text.length));
  const known = table[at];
  if (known !== NOT_WORKED_OUT) return known === BASE_NONE ? -1 : known - BASE_BIAS;

  let base = at;
  let walked = at;
  for (;;) {
    base = base > 0 ? codePointStart(text, base - 1) : -1;
    if (base < 0) break;
    positionsWalked += 1;
    // A mark whose own base is known is in this same run, so its base is this
    // one's too, and the rest of the run does not have to be walked again.
    const answered = table[base];
    if (answered !== NOT_WORKED_OUT) {
      base = answered === BASE_NONE ? -1 : answered - BASE_BIAS;
      break;
    }
    if (classAt(analysis, base) !== CLASS_MARK) break;
    walked = base;
  }

  // Only what this walk covered is written; the rest of the run already carries
  // the same answer, and rewriting it would put the run's length back into the
  // cost of every resolution.
  const value = base < 0 ? BASE_NONE : base + BASE_BIAS;
  for (let fill = at; fill >= walked;) {
    table[fill] = value;
    if (fill === 0) break;
    fill = codePointStart(text, fill - 1);
  }
  return base;
}

/**
 * Direction of the nearest strong character before `at`, for rules N1 and N2.
 *
 * Everything between that character and `at` is neutral, so it has the same
 * answer, and the walk writes it over all of them. An earlier walk's answer is
 * taken where it is met, which is what keeps every resolution inside one neutral
 * run to a single pass between them.
 *
 * @param {TextAnalysis} analysis
 * @param {number} at First UTF-16 unit of a code point.
 * @returns {number}
 */
function strongBefore(analysis, at) {
  const text = analysis.text;
  const table = analysis.strongBefore ?? (analysis.strongBefore = new Int8Array(text.length));
  const known = table[at];
  if (known !== NOT_WORKED_OUT) return known;

  let side = STRONG_NONE;
  let stop = -1;
  for (let index = at; index > 0;) {
    index = codePointStart(text, index - 1);
    positionsWalked += 1;
    const charClass = classAt(analysis, index);
    if (charClass === CLASS_RTL || charClass === CLASS_NUMBER) side = STRONG_RTL;
    else if (charClass === CLASS_LTR) side = STRONG_LTR;
    else if (table[index] !== NOT_WORKED_OUT) side = table[index];
    else continue;
    stop = index;
    break;
  }

  for (let fill = at; fill > stop;) {
    table[fill] = side;
    if (fill === 0) break;
    fill = codePointStart(text, fill - 1);
  }
  return side;
}

/**
 * Direction of the nearest strong character after `at`, the mirror of
 * `strongBefore` and written back the same way.
 *
 * @param {TextAnalysis} analysis
 * @param {number} at First UTF-16 unit of a code point.
 * @returns {number}
 */
function strongAfter(analysis, at) {
  const text = analysis.text;
  const length = text.length;
  const table = analysis.strongAfter ?? (analysis.strongAfter = new Int8Array(length));
  const known = table[at];
  if (known !== NOT_WORKED_OUT) return known;

  let side = STRONG_NONE;
  let stop = length;
  for (let index = codePointEnd(text, at); index < length; index = codePointEnd(text, index)) {
    positionsWalked += 1;
    const charClass = classAt(analysis, index);
    if (charClass === CLASS_RTL || charClass === CLASS_NUMBER) side = STRONG_RTL;
    else if (charClass === CLASS_LTR) side = STRONG_LTR;
    else if (table[index] !== NOT_WORKED_OUT) side = table[index];
    else continue;
    stop = index;
    break;
  }

  for (let fill = at; fill < stop; fill = codePointEnd(text, fill)) table[fill] = side;
  return side;
}

/**
 * Rule W2 reads the nearest strong letter before a number, which is not the
 * nearest strong character: a number does not stand in for one here. Written
 * back over the walk like the others.
 *
 * @param {TextAnalysis} analysis
 * @param {number} at First UTF-16 unit of a code point.
 * @returns {number}
 */
function letterBefore(analysis, at) {
  const text = analysis.text;
  const table = analysis.letterBefore ?? (analysis.letterBefore = new Uint8Array(text.length));
  const known = table[at];
  if (known !== NOT_WORKED_OUT) return known;

  let letter = LETTER_NONE;
  let stop = -1;
  for (let index = at; index > 0;) {
    index = codePointStart(text, index - 1);
    positionsWalked += 1;
    const charClass = classAt(analysis, index);
    if (charClass === CLASS_RTL) {
      letter = ARABIC_LETTER_CHAR.test(characterAt(text, index)) ? LETTER_ARABIC : LETTER_RTL;
    } else if (charClass === CLASS_LTR) {
      letter = LETTER_LTR;
    } else if (table[index] !== NOT_WORKED_OUT) {
      letter = table[index];
    } else {
      continue;
    }
    stop = index;
    break;
  }

  for (let fill = at; fill > stop;) {
    table[fill] = letter;
    if (fill === 0) break;
    fill = codePointStart(text, fill - 1);
  }
  return letter;
}

/**
 * The first character of the run of terminators and marks reaching `at`, which
 * is the left end rule W5 measures from. It depends only on the text before
 * `at`, so an edit hands it on and a keystroke does not walk the run again.
 *
 * @param {TextAnalysis} analysis
 * @param {number} at First UTF-16 unit of a code point.
 * @returns {number}
 */
function terminatorRunFirst(analysis, at) {
  const text = analysis.text;
  const table = analysis.runFirst ?? (analysis.runFirst = new Int32Array(text.length));
  const known = table[at];
  if (known !== NOT_WORKED_OUT) return known - 1;

  let first = at;
  let walked = at;
  while (first > 0) {
    const before = codePointStart(text, first - 1);
    positionsWalked += 1;
    const answered = table[before];
    if (answered !== NOT_WORKED_OUT) {
      first = answered - 1;
      break;
    }
    const charClass = classAt(analysis, before);
    if (charClass !== CLASS_TERMINATOR && charClass !== CLASS_MARK) break;
    first = before;
    walked = before;
  }

  // Stored biased by one, so that zero stays free for "not worked out", and only
  // over what this walk covered: the rest of the run already says the same.
  for (let fill = at; fill >= walked;) {
    table[fill] = first + 1;
    if (fill === 0) break;
    fill = codePointStart(text, fill - 1);
  }
  return first;
}

/**
 * The right end of that run. Unlike its left end this cannot survive an edit,
 * since an edit moves what follows — but within one text it still costs a single
 * pass however many carets are resolved inside the run.
 *
 * @param {TextAnalysis} analysis
 * @param {number} at First UTF-16 unit of a code point.
 * @returns {number}
 */
function terminatorRunPast(analysis, at) {
  const text = analysis.text;
  const length = text.length;
  const table = analysis.runPast ?? (analysis.runPast = new Int32Array(length));
  const known = table[at];
  if (known !== NOT_WORKED_OUT) return known - 1;

  let past = at;
  let walked = at;
  for (;;) {
    past = codePointEnd(text, past);
    if (past >= length) {
      past = length;
      break;
    }
    positionsWalked += 1;
    const answered = table[past];
    if (answered !== NOT_WORKED_OUT) {
      past = answered - 1;
      break;
    }
    const charClass = classAt(analysis, past);
    if (charClass !== CLASS_TERMINATOR && charClass !== CLASS_MARK) break;
    walked = past;
  }

  for (let fill = at; fill <= walked; fill = codePointEnd(text, fill)) table[fill] = past + 1;
  return past;
}

/**
 * Rule W5 with rule W2 folded in: a run of terminators joins an adjacent
 * European number, unless an Arabic letter before that number made it Arabic.
 *
 * Marks inside the run have already been resolved away by rule W1, so they do
 * not separate a terminator from the number it belongs to.
 *
 * @param {TextAnalysis} analysis
 * @param {number} at First UTF-16 unit of a terminator.
 * @returns {boolean}
 */
function terminatorJoinsNumber(analysis, at) {
  const text = analysis.text;
  const first = terminatorRunFirst(analysis, at);
  const past = terminatorRunPast(analysis, at);
  const touchesEuropean = (index) =>
    index >= 0 &&
    index < text.length &&
    classAt(analysis, index) === CLASS_NUMBER &&
    EUROPEAN_NUMBER_CHAR.test(characterAt(text, index)) &&
    letterBefore(analysis, index) !== LETTER_ARABIC;
  return touchesEuropean(first > 0 ? codePointStart(text, first - 1) : -1) || touchesEuropean(past);
}

/**
 * Whether a character can take part in a bracket pair at all. Asked before the
 * pairing is built, so that text without brackets never pays for that pass.
 *
 * @param {string} char
 * @returns {boolean}
 */
function isBracket(char) {
  const canonical = canonicalBracket(char);
  return BRACKET_OPENINGS.indexOf(canonical) >= 0 || BRACKET_CLOSINGS.indexOf(canonical) >= 0;
}

/**
 * BD16: the bracket pairs of the text, from one pass with a stack. Built the
 * first time a bracket is resolved and then kept, since pairing a closing
 * bracket needs the openings before it and so cannot start from the caret.
 *
 * @param {TextAnalysis} analysis
 * @param {number} at First UTF-16 unit of a bracket.
 * @returns {BracketPair | null}
 */
function bracketPairAt(analysis, at) {
  if (analysis.bracketPairs) return analysis.bracketPairs.get(at) ?? null;

  const text = analysis.text;
  /** @type {Map<number, BracketPair>} */
  const pairs = new Map();
  /** @type {{ closing: string, at: number }[]} */
  const stack = [];
  for (let index = 0; index < text.length; index = codePointEnd(text, index)) {
    positionsWalked += 1;
    const char = characterAt(text, index);
    if (!isBracket(char) || classAt(analysis, index) !== CLASS_NEUTRAL) continue;
    const canonical = canonicalBracket(char);
    const opening = BRACKET_OPENINGS.indexOf(canonical);
    if (opening >= 0) {
      if (stack.length >= MAX_BRACKET_PAIRS) break;
      stack.push({ closing: BRACKET_CLOSINGS[opening], at: index });
      continue;
    }
    for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
      if (stack[depth].closing !== canonical) continue;
      const pair = { open: stack[depth].at, close: index, enclosed: null };
      pairs.set(pair.open, pair);
      pairs.set(pair.close, pair);
      stack.length = depth;
      break;
    }
  }

  analysis.bracketPairs = pairs;
  return pairs.get(at) ?? null;
}

/**
 * What a bracket pair encloses, by strong direction. Worked out on first use
 * because most brackets are never asked about, and kept on the pair so a nested
 * pair is not rescanned.
 *
 * @param {TextAnalysis} analysis
 * @param {BracketPair} pair
 * @returns {{ rtl: boolean, ltr: boolean }}
 */
function enclosedDirections(analysis, pair) {
  if (pair.enclosed) return pair.enclosed;
  const text = analysis.text;
  let rtl = false;
  let ltr = false;
  for (let at = codePointEnd(text, pair.open); at < pair.close; at = codePointEnd(text, at)) {
    positionsWalked += 1;
    const charClass = classAt(analysis, at);
    // N0 counts numbers as right-to-left, exactly as N1 does.
    if (charClass === CLASS_RTL || charClass === CLASS_NUMBER) rtl = true;
    else if (charClass === CLASS_LTR) ltr = true;
  }
  pair.enclosed = { rtl, ltr };
  return pair.enclosed;
}

/**
 * Whether the character at `index` is laid out right-to-left, following the
 * Unicode Bidirectional Algorithm.
 *
 * Direction has to come from the character because neighbouring rects cannot
 * distinguish a one-character run from a continuing run of the opposite
 * direction — they are geometrically identical — and it cannot come from the
 * paragraph alone, because a right-to-left paragraph ending in a Latin word or
 * a number has its last characters laid out left-to-right. Reading the
 * character keeps the answer independent of zoom, of sub-pixel rounding, and of
 * how the browser rounds adjacent glyph rects.
 *
 * The rules applied, in order: W1 (a mark inherits from the character before
 * it), I1/I2 (numbers are raised to an even, left-to-right level at both
 * paragraph directions), W2 and W5 (a terminator joins an adjacent European
 * number), N0 for a paired bracket, then N1/N2 and L1 for anything neutral,
 * which at the end of the text is always the paragraph's own direction.
 *
 * What the rules need from the rest of the text is worked out from the
 * character outward and kept, so this costs the distance to the nearest strong
 * character rather than the length of the text.
 *
 * @param {string} text
 * @param {number} index
 * @param {() => boolean} resolveParagraphIsRtl Paragraph direction, read only when needed since it forces a style recalc.
 * @returns {boolean}
 */
function characterIsRtl(text, index, resolveParagraphIsRtl) {
  const analysis = analysisFor(text);

  // W1: a non-spacing mark takes the class of the character before it, and the
  // paragraph direction when there is none.
  const at = baseBefore(analysis, codePointStart(text, index));
  if (at < 0) return resolveParagraphIsRtl();

  const charClass = classAt(analysis, at);
  if (charClass === CLASS_RTL) return true;
  if (charClass === CLASS_LTR) return false;
  if (charClass === CLASS_NUMBER) return false;
  if (charClass === CLASS_TERMINATOR && terminatorJoinsNumber(analysis, at)) return false;

  const paragraphIsRtl = resolveParagraphIsRtl();
  const sideIsRtl = (side) => (side === STRONG_NONE ? paragraphIsRtl : side === STRONG_RTL);

  // N0: a paired bracket resolves from what its pair encloses, before the
  // general neutral rules see it. A pair enclosing nothing strong, and a bracket
  // with no pair, fall through to those rules.
  const pair = isBracket(characterAt(text, at)) ? bracketPairAt(analysis, at) : null;
  if (pair) {
    const enclosed = enclosedDirections(analysis, pair);
    const enclosesParagraphDirection = paragraphIsRtl ? enclosed.rtl : enclosed.ltr;
    const enclosesOppositeDirection = paragraphIsRtl ? enclosed.ltr : enclosed.rtl;
    if (enclosesParagraphDirection) return paragraphIsRtl;
    if (enclosesOppositeDirection) {
      // The pair runs against the paragraph, so the text before it decides
      // whether the brackets join that run or fall back to the paragraph.
      const opposite = !paragraphIsRtl;
      return sideIsRtl(strongBefore(analysis, pair.open)) === opposite ? opposite : paragraphIsRtl;
    }
  }

  // N1 and N2: a neutral takes the direction its two sides share, and the
  // paragraph's otherwise. At either end of the text the paragraph stands in,
  // which is also what L1 gives for a trailing neutral.
  const before = sideIsRtl(strongBefore(analysis, at));
  const after = sideIsRtl(strongAfter(analysis, at));
  return before === after ? before : paragraphIsRtl;
}

/**
 * How far to look past characters that have no glyph box — a zero-width space, a
 * bidi mark, a joiner, a soft hyphen — for the neighbour whose edge the caret
 * sits on.
 *
 * WebKit refuses the caret after "שלום " followed by any of those, and the
 * character immediately before it then has nothing to measure, so without this
 * the repair would decline and leave the caret where the bug put it. Chromium
 * places it at the logical end of the space, which is the first neighbour that
 * does have a box.
 *
 * Bounded because every step is a forced layout, and a text node made only of
 * format controls would otherwise turn one caret into thousands of them. Past
 * the bound the workaround declines, which is the behaviour it has for every
 * boundary it cannot measure.
 */
const MAX_INVISIBLE_NEIGHBOURS = 16;

/**
 * The nearest character on one side of `offset` that has a glyph box, together
 * with the index it was found at.
 *
 * Both neighbours are addressed by the first UTF-16 unit of their code point, so
 * a caller measuring the character never receives half a surrogate pair.
 *
 * @param {number} offset Caret offset within the text node.
 * @param {string} text The text node's data.
 * @param {(index: number) => DOMRect | null} measureCharRect
 * @param {number} step -1 to look back from the caret, 1 to look forward.
 * @returns {{ index: number, rect: DOMRect } | null}
 */
function nearestMeasuredCharacter(offset, text, measureCharRect, step) {
  let index = step < 0 ? (offset > 0 ? codePointStart(text, offset - 1) : -1) : codePointStart(text, offset);
  for (let steps = 0; steps < MAX_INVISIBLE_NEIGHBOURS; steps += 1) {
    if (index < 0 || index >= text.length) return null;
    const rect = measureCharRect(index);
    if (rect) return { index, rect };
    index = step < 0 ? (index > 0 ? codePointStart(text, index - 1) : -1) : codePointEnd(text, index);
  }
  return null;
}

/**
 * Resolve the caret x for a boundary the browser would not measure, from the
 * rect of the character next to it and that character's direction.
 *
 * A caret sits at the *logical end* of the character before it — the right edge
 * of a left-to-right character, the left edge of a right-to-left one — or, at
 * the very start of the text, at the logical start of the character after it.
 *
 * The direction comes from the character rather than from the rects because
 * neighbouring rects cannot distinguish a one-character run from a continuing
 * run of the opposite direction: they are geometrically identical. It also
 * cannot come from the paragraph alone, because an RTL paragraph ending in a
 * Latin word or a digit has its last characters laid out left-to-right. Reading
 * the character keeps the answer independent of zoom, of sub-pixel rounding, and
 * of how the browser rounds adjacent glyph rects.
 *
 * @param {number} offset Caret offset within the text node.
 * @param {string} text The text node's data.
 * @param {(index: number) => DOMRect | null} measureCharRect Rect of the whole code point starting at `index`.
 * @param {() => boolean} resolveParagraphIsRtl Direction of the containing paragraph, for neutral characters.
 * @returns {{ x: number, top: number, height: number } | null}
 */
export function resolveCollapsedCaretGeometry(offset, text, measureCharRect, resolveParagraphIsRtl) {
  if (typeof text !== 'string') return null;
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return null;

  const previous = nearestMeasuredCharacter(offset, text, measureCharRect, -1);
  if (previous) {
    const runIsRtl = characterIsRtl(text, previous.index, resolveParagraphIsRtl);
    const rect = previous.rect;
    return { x: runIsRtl ? rect.left : rect.right, top: rect.top, height: rect.height };
  }

  const next = nearestMeasuredCharacter(offset, text, measureCharRect, 1);
  if (next) {
    const runIsRtl = characterIsRtl(text, next.index, resolveParagraphIsRtl);
    const rect = next.rect;
    return { x: runIsRtl ? rect.right : rect.left, top: rect.top, height: rect.height };
  }

  return null;
}

/**
 * Whether a range is a collapsed caret inside a text node that a mounted
 * SuperDoc runtime owns — the only shape this workaround ever answers for.
 *
 * Everything else in the host page, including SuperDoc's own chrome outside a
 * runtime root, keeps the browser's native answer.
 *
 * @param {Range} range
 * @returns {boolean}
 */
const isOwnedCollapsedTextRange = (range) => {
  if (!range?.collapsed) return false;
  const node = range.startContainer;
  if (node?.nodeType !== 3 /* Node.TEXT_NODE */) return false;

  // `closest()` stops at a shadow boundary, and SuperDoc mounts painter content
  // inside one in at least one supported embedding — which is why the shell
  // reads pointer targets through `composedPath()`. Climb out through each
  // shadow host so text in that tree is recognised as the runtime's own; without
  // this the workaround would quietly decline exactly there.
  for (let element = node.parentElement; element;) {
    if (typeof element.closest !== 'function') return false;
    if (element.closest(RUNTIME_ROOT_SELECTOR)) return true;
    const root = typeof element.getRootNode === 'function' ? element.getRootNode() : null;
    const host = root && root !== element.ownerDocument ? root.host : null;
    element = host?.nodeType === 1 /* Node.ELEMENT_NODE */ ? host : null;
  }
  return false;
};

/**
 * Build the caret rect for a collapsed text range using only native measurement.
 *
 * @param {Range} range
 * @param {(this: Range) => DOMRectList} nativeGetClientRects Unpatched accessor, so measurement cannot recurse.
 * @returns {DOMRect | null}
 */
function synthesizeCollapsedCaretRect(range, nativeGetClientRects) {
  const node = /** @type {Text} */ (range.startContainer);
  const doc = node.ownerDocument;
  const view = doc?.defaultView;
  if (!doc || typeof doc.createRange !== 'function' || typeof view?.DOMRect !== 'function') return null;

  const text = node.data ?? '';
  if (text.length === 0) return null;

  const probe = doc.createRange();
  /** @type {Map<number, DOMRect | null>} */
  const measured = new Map();
  const measureCharRect = (index) => {
    // Measure the whole code point. Both engines widen a range that splits a
    // surrogate pair, but the DOM counts range offsets in UTF-16 units and is
    // not obliged to, so the pair is spanned explicitly.
    const start = codePointStart(text, index);
    if (measured.has(start)) return measured.get(start) ?? null;
    let rect = null;
    try {
      probe.setStart(node, start);
      probe.setEnd(node, codePointEnd(text, start));
      rect = firstGlyphRect(nativeGetClientRects.call(probe));
    } catch {
      rect = null;
    }
    measured.set(start, rect);
    return rect;
  };

  /** @type {boolean | undefined} */
  let paragraphIsRtl;
  const resolveParagraphIsRtl = () => {
    if (paragraphIsRtl === undefined) {
      // Climb past inline wrappers. The painter puts `dir` on individual run
      // spans, but a neutral at the end of a line takes the direction of the
      // block that contains it, not of the span it happens to sit in.
      let element = node.parentElement;
      let style = element ? view.getComputedStyle(element) : null;
      while (element && (style?.display === 'inline' || style?.display === 'contents')) {
        element = element.parentElement;
        style = element ? view.getComputedStyle(element) : null;
      }
      paragraphIsRtl = style ? style.direction === 'rtl' : false;
    }
    return paragraphIsRtl;
  };

  const geometry = resolveCollapsedCaretGeometry(range.startOffset, text, measureCharRect, resolveParagraphIsRtl);
  if (!geometry) return null;
  return new view.DOMRect(geometry.x, geometry.top, 0, geometry.height);
}

/**
 * Present a single rect the way callers read a `DOMRectList`: by `length`, by
 * index, through `item()`, and by iteration.
 *
 * Deliberately not an `Array`. The patch is global, so host code that branches
 * on the shape of the result should not suddenly see `Array.isArray` pass.
 *
 * @param {DOMRect} rect
 * @returns {DOMRectList}
 */
function toRectList(rect) {
  const list = {
    0: rect,
    [Symbol.iterator]: function* iterate() {
      yield rect;
    },
  };
  // On a real DOMRectList `length` is a non-enumerable accessor and `item` lives
  // on the prototype, so neither shows up in `Object.keys` or `JSON.stringify`.
  // Defining them the same way keeps host logging and deep-equality assertions
  // seeing the shape this API has everywhere else.
  Object.defineProperty(list, 'length', { value: 1 });
  Object.defineProperty(list, 'item', { value: (index) => (index === 0 ? rect : null) });
  return /** @type {unknown} */ (list);
}

/**
 * Detect the quirk by measuring it, never by sniffing the user agent.
 *
 * Each probed boundary is paired with a *control* one character earlier, which
 * no engine gets wrong. Environments with no layout — jsdom, SSR, a detached
 * document — fail every control and are reported as `'unknown'` rather than as
 * a quirk.
 *
 * @param {Document | null | undefined} doc
 * @returns {'quirk' | 'clean' | 'unknown'}
 */
export function detectCollapsedCaretRectQuirk(doc) {
  let container = null;
  try {
    const host = doc?.body ?? doc?.documentElement;
    if (!doc || !host || typeof doc.createRange !== 'function') return 'unknown';

    container = doc.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;font:16px sans-serif;';

    const probes = PROBE_CASES.map(([direction, whiteSpace, text]) => {
      const probe = doc.createElement('div');
      probe.style.cssText = `direction:${direction};white-space:${whiteSpace};`;
      probe.textContent = text;
      container.appendChild(probe);
      return { probe, length: text.length };
    });
    host.appendChild(container);

    const range = doc.createRange();
    const boundaryIsMeasurable = (node, offset) => {
      range.setStart(node, offset);
      range.collapse(true);
      return firstRectWithHeight(range.getClientRects()) != null;
    };

    let sawLayout = false;
    for (const { probe, length } of probes) {
      const node = probe.firstChild;
      if (!node || !boundaryIsMeasurable(node, length - 1)) continue; // No layout: cannot tell.
      sawLayout = true;
      if (!boundaryIsMeasurable(node, length)) return 'quirk';
    }
    return sawLayout ? 'clean' : 'unknown';
  } catch {
    return 'unknown';
  } finally {
    try {
      container?.remove();
    } catch {
      /* A host that broke `remove()` must not break editor startup. */
    }
  }
}

/**
 * Install the workaround on a window, if that window needs it.
 *
 * Never throws: a frozen `Range.prototype` (SES/Lockdown), an instrumented
 * `createElement`/`appendChild`, or a non-HTML document all resolve to "not
 * installed" rather than to a rejected engine load.
 *
 * Safe to call repeatedly: an already-patched realm returns the no-op uninstall,
 * and a realm already measured as correct is not probed again. Takes the window
 * explicitly so a future iframe-hosted surface can install into its own realm.
 *
 * @param {(Window & typeof globalThis) | null | undefined} win
 * @returns {(() => void) | null} Uninstall function, or `null` when not installed.
 */
export function installWebKitCollapsedCaretRectFix(win) {
  try {
    const rangePrototype = win?.Range?.prototype;
    if (!rangePrototype || typeof rangePrototype.getClientRects !== 'function') return null;
    // The mark goes on the function rather than on the prototype, so that a
    // host which replaces `getClientRects` outright — rather than wrapping it —
    // is noticed and the workaround reinstates itself. Reinstating over a host's
    // own wrapper is harmless: the inner patch has already answered, so the
    // outer one sees rects and passes them through.
    if (rangePrototype.getClientRects[INSTALLED_FLAG]) return () => {};
    if (measuredCleanWindows.has(win)) return null;
    const probesSoFar = probeCounts.get(win) ?? 0;
    if (probesSoFar >= MAX_UNKNOWN_PROBES) return null;

    const status = detectCollapsedCaretRectQuirk(win.document);
    if (status === 'clean') measuredCleanWindows.add(win);
    if (status === 'unknown') probeCounts.set(win, probesSoFar + 1);
    if (status !== 'quirk') return null;

    const nativeGetClientRects = rangePrototype.getClientRects;
    const nativeGetBoundingClientRect = rangePrototype.getBoundingClientRect;

    // The native call stays outside the guard so that a range the browser
    // itself rejects fails exactly as it does unpatched. Everything after it is
    // guarded: `getClientRects` is specified never to throw for a valid range,
    // and a host that has instrumented `closest` or `getComputedStyle` — an
    // extension, a hardened realm, a test stub — must not be able to turn every
    // Range on the page into a throwing API. Failure falls back to the
    // browser's own answer, which is the unpatched behaviour.

    /** @this {Range} */
    function patchedGetClientRects() {
      const native = nativeGetClientRects.call(this);
      try {
        if (firstRectWithHeight(native)) return native;
        if (!isOwnedCollapsedTextRange(this)) return native;
        const rect = synthesizeCollapsedCaretRect(this, nativeGetClientRects);
        return rect ? toRectList(rect) : native;
      } catch {
        return native;
      }
    }

    /** @this {Range} */
    function patchedGetBoundingClientRect() {
      const native = nativeGetBoundingClientRect.call(this);
      try {
        if (native && native.height > 0) return native;
        if (!isOwnedCollapsedTextRange(this)) return native;
        return synthesizeCollapsedCaretRect(this, nativeGetClientRects) ?? native;
      } catch {
        return native;
      }
    }

    const restore = () => {
      try {
        rangePrototype.getClientRects = nativeGetClientRects;
        rangePrototype.getBoundingClientRect = nativeGetBoundingClientRect;
      } catch {
        /* Nothing left to do: the realm refuses writes. */
      }
    };

    try {
      Object.defineProperty(patchedGetClientRects, INSTALLED_FLAG, { value: true });
      Object.defineProperty(patchedGetBoundingClientRect, INSTALLED_FLAG, { value: true });
      rangePrototype.getClientRects = patchedGetClientRects;
      rangePrototype.getBoundingClientRect = patchedGetBoundingClientRect;
    } catch {
      restore();
      return null;
    }

    return restore;
  } catch {
    return null;
  }
}
