type NumberingHandler = (path: number[], lvlText: string, customFormat?: string) => string | null;

type NumberFormatter = (value: number) => string;

const WORD_BLANK_NUMBER = ' ';

const decimalDigits: NumberFormatter = (value) => String(value);

const digitsIn = (digits: string): NumberFormatter => {
  const table = [...digits];
  return (value) => [...String(value)].map((digit) => table[Number(digit)]).join('');
};

const enclosedUpTo =
  (first: number, count: number): NumberFormatter =>
  (value) =>
    value >= 1 && value <= count ? String.fromCodePoint(first + value - 1) : String(value);

const cyclingLetters = (letters: string, zero: string): NumberFormatter => {
  const alphabet = [...letters];
  return (value) => (value < 1 ? zero : alphabet[(value - 1) % alphabet.length]);
};

const MAX_LETTER_REPEATS = 30;

const repeatingLetters = (letters: string, zero: string): NumberFormatter => {
  const alphabet = [...letters];
  return (value) => {
    if (value < 1) return zero;
    const wrapped = (value - 1) % (alphabet.length * MAX_LETTER_REPEATS);
    return alphabet[wrapped % alphabet.length].repeat(Math.floor(wrapped / alphabet.length) + 1);
  };
};

const HEAVENLY_STEMS = '甲乙丙丁戊己庚辛壬癸';
const EARTHLY_BRANCHES = '子丑寅卯辰巳午未申酉戌亥';

const sexagenaryCycle: NumberFormatter = (value) => {
  if (value < 1) return String(value);
  const index = (value - 1) % 60;
  return HEAVENLY_STEMS[index % 10] + EARTHLY_BRANCHES[index % 12];
};

const tableThenDecimal =
  (table: string): NumberFormatter =>
  (value) =>
    value >= 1 && value <= table.length ? table[value - 1] : String(value);

const CHICAGO_MARKS = '*†‡§';

const JAPANESE_DIGITAL_BLANK_FROM = 10_000;

const ideographDigits = digitsIn('〇一二三四五六七八九');
const fullWidthDigits = digitsIn('０１２３４５６７８９');
const koreanHanjaDigits = digitsIn('零一二三四五六七八九');

const SCRIPT_FORMATTERS: Record<string, NumberFormatter> = {
  decimalHalfWidth: decimalDigits,
  bahtText: decimalDigits,
  dollarText: decimalDigits,
  decimalFullWidth: fullWidthDigits,
  decimalFullWidth2: fullWidthDigits,
  hindiNumbers: digitsIn('०१२३४५६७८९'),
  thaiNumbers: digitsIn('๐๑๒๓๔๕๖๗๘๙'),
  ideographDigital: ideographDigits,
  japaneseDigitalTenThousand: (value) => (value >= JAPANESE_DIGITAL_BLANK_FROM ? '' : ideographDigits(value)),
  taiwaneseDigital: digitsIn('○一二三四五六七八九'),
  koreanDigital: digitsIn('영일이삼사오육칠팔구'),
  koreanDigital2: (value) => (value === 0 ? '\uF9B2' : koreanHanjaDigits(value)),
  hex: (value) => value.toString(16).toUpperCase(),
  numberInDash: (value) => `- ${value} -`,
  none: () => '',
  decimalEnclosedCircle: enclosedUpTo(0x2460, 20),
  decimalEnclosedCircleChinese: enclosedUpTo(0x2460, 20),
  decimalEnclosedFullstop: enclosedUpTo(0x2488, 20),
  decimalEnclosedParen: enclosedUpTo(0x2474, 20),
  ideographEnclosedCircle: enclosedUpTo(0x3220, 10),
  ideographTraditional: tableThenDecimal(HEAVENLY_STEMS),
  ideographZodiac: tableThenDecimal(EARTHLY_BRANCHES),
  ideographZodiacTraditional: sexagenaryCycle,
  chicago: repeatingLetters(CHICAGO_MARKS, ''),
  aiueo: cyclingLetters('ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ', '0'),
  aiueoFullWidth: cyclingLetters(
    'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン',
    '0',
  ),
  iroha: cyclingLetters('ｲﾛﾊﾆﾎﾍﾄﾁﾘﾇﾙｦﾜｶﾖﾀﾚｿﾂﾈﾅﾗﾑｳヰﾉｵｸﾔﾏｹﾌｺｴﾃｱｻｷﾕﾒﾐｼヱﾋﾓｾｽﾝ', '0'),
  irohaFullWidth: cyclingLetters(
    'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセスン',
    '0',
  ),
  chosung: cyclingLetters('ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ', '0'),
  ganada: cyclingLetters('가나다라마바사아자차카타파하', '0'),
  russianLower: repeatingLetters('абвгдежзиклмнопрстуфхцчшщыэюя', WORD_BLANK_NUMBER),
  russianUpper: repeatingLetters('АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЫЭЮЯ', WORD_BLANK_NUMBER),
};

const lowerCased =
  (formatter: NumberFormatter): NumberFormatter =>
  (value) =>
    formatter(value).toLowerCase();

const formatterFor = (numFmt: string | undefined): NumberFormatter | null =>
  (numFmt != null && NUMBER_FORMATTERS.get(numFmt)) || null;

const FORMATTED_WITHOUT_TABLE = new Set(['bullet', 'custom']);

export const isCountedNumberFormat = (numFmt: string): boolean =>
  FORMATTED_WITHOUT_TABLE.has(numFmt) || formatterFor(numFmt) !== null;

export const formatListNumber = (value: number, numFmt: string | undefined, customFormat?: string | null): string => {
  if (!Number.isFinite(value) || value < 0) return String(value);
  if (numFmt === 'custom') return customFormatter(customFormat)(value);
  if (numFmt === 'bullet') return '';
  const formatter = formatterFor(numFmt);
  return formatter ? formatter(value) : String(value);
};

const LEGAL_KEEPS_FORMAT = new Set(['decimalZero', 'none', 'bullet']);

export const legalNumberFormat = (numFmt: string, isLegal: boolean | undefined): string =>
  isLegal && !LEGAL_KEEPS_FORMAT.has(numFmt) ? 'decimal' : numFmt;

export interface GenerateOrderedListIndexOptions {
  listLevel: number[];
  lvlText: string | null | undefined;
  listNumberingType?: string;
  customFormat?: string;
}

export const generateOrderedListIndex = ({
  listLevel,
  lvlText,
  listNumberingType,
  customFormat,
}: GenerateOrderedListIndexOptions): string | null => {
  if (typeof lvlText !== 'string') return null;
  const formatter =
    listNumberingType === 'custom' ? customFormatter(customFormat ?? null) : formatterFor(listNumberingType);
  return formatter ? generateNumbering(listLevel, lvlText, formatter) : null;
};

const createNumbering = (values: string[], lvlText: string): string => {
  if (typeof lvlText !== 'string') return '';
  return values.reduce<string>((acc, value, index) => acc.replace(`%${index + 1}`, value), lvlText);
};

const generateNumbering = (path: number[], lvlText: string, formatter: NumberFormatter): string => {
  const formattedValues = path.map((entry) => formatter(entry));
  return createNumbering(formattedValues, lvlText);
};

const ordinalFormatter: NumberFormatter = (value) => {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const lastTwo = value % 100;
  const suffix = suffixes[(lastTwo - 20) % 10] || suffixes[lastTwo] || suffixes[0];
  return `${value}${suffix}`;
};

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: ReadonlyArray<readonly [number, string]> = [
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1000, 'thousand'],
  [100, 'hundred'],
];
const ORDINAL_WORDS: Record<string, string> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

const cardinalWords = (value: number): string => {
  if (value < 20) return ONES[value];
  if (value < 100) {
    const ones = value % 10;
    return ones === 0 ? TENS[Math.floor(value / 10)] : `${TENS[Math.floor(value / 10)]}-${ONES[ones]}`;
  }
  const [scale, name] = SCALES.find(([size]) => value >= size) ?? SCALES[SCALES.length - 1];
  const rest = value % scale;
  return `${cardinalWords(Math.floor(value / scale))} ${name}${rest === 0 ? '' : ` ${cardinalWords(rest)}`}`;
};

const ordinalWord = (word: string): string => {
  if (ORDINAL_WORDS[word]) return ORDINAL_WORDS[word];
  if (word.endsWith('y')) return `${word.slice(0, -1)}ieth`;
  return `${word}th`;
};

const ordinalWords = (value: number): string => {
  const cardinal = cardinalWords(value);
  const last = /[a-z]+$/.exec(cardinal)?.[0] ?? cardinal;
  return cardinal.slice(0, cardinal.length - last.length) + ordinalWord(last);
};

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const ordinalTextFormatter: NumberFormatter = (value) =>
  Number.isInteger(value) && value >= 0 ? capitalized(ordinalWords(value)) : String(value);

const cardinalTextFormatter: NumberFormatter = (value) =>
  Number.isInteger(value) && value >= 0 ? capitalized(cardinalWords(value)) : String(value);

const decimalZeroFormatter: NumberFormatter = (value) => {
  if (value >= 10) return String(value);
  return `0${value}`;
};

const customFormatter = (customFormat: string | null | undefined): NumberFormatter => {
  const width = customFormat?.match(/(?:[0]+\d,\s){3}\.{3}/)?.[0].match(/\d+/)?.[0].length;
  return width ? (value) => String(value).padStart(width, '0') : decimalDigits;
};

const ROMAN_NUMERALS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

const LARGEST_COUNTED_ROMAN = 32767;

const intToRoman = (num: number): string => {
  if (num < 1) return WORD_BLANK_NUMBER;
  if (!Number.isInteger(num) || num > LARGEST_COUNTED_ROMAN) return String(num);
  let result = 'M'.repeat(Math.floor(num / 1000));
  let remaining = num % 1000;
  for (const [value, numeral] of ROMAN_NUMERALS) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
};

const intToAlpha = repeatingLetters('ABCDEFGHIJKLMNOPQRSTUVWXYZ', WORD_BLANK_NUMBER);

const JAPANESE_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const JAPANESE_UNITS = [
  ['千', 1000],
  ['百', 100],
  ['十', 10],
] as const;

const japaneseGroup = (group: number, keepsThousandOne: boolean): string => {
  let result = '';
  for (const [unit, size] of JAPANESE_UNITS) {
    const digit = Math.floor(group / size) % 10;
    if (digit === 0) continue;
    const keepsOne = unit === '千' && keepsThousandOne;
    result += (digit === 1 && !keepsOne ? '' : JAPANESE_DIGITS[digit]) + unit;
  }
  return result + JAPANESE_DIGITS[group % 10];
};

const LARGEST_JAPANESE_GROUPED = 99_999_999;

export const intToJapaneseCounting = (num: number): string => {
  if (num === 0) return '〇';
  if (!Number.isInteger(num) || num < 0 || num > LARGEST_JAPANESE_GROUPED) return String(num);
  const wan = Math.floor(num / 10_000);
  const rest = num % 10_000;
  return (wan > 0 ? `${japaneseGroup(wan, false)}万` : '') + japaneseGroup(rest, wan > 0);
};

// OOXML w:numFmt values per ECMA-376 §17.18.59, matched to Word 16 output
// (ListFormat.ListString) where the spec and Word disagree:
//   chineseCounting         -> tens notation through 99, then positional digits
//                              with U+25CB zeros (100 -> 一○○, 12345 -> 一二三四五).
//   chineseCountingThousand -> grouped 十/百/千/万 numerals; interior zero runs
//                              collapse to one U+3007 (not the spec's U+96F6);
//                              empty output from 1,000,000 upward, like Word.
// Values 10-19 drop the leading 一 (十一) only as the whole value; group counts
// keep it (100000 -> 一十万, 110000 -> 一十一万).
const CHINESE_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const intToChineseCounting = (num: number): string => {
  if (!Number.isInteger(num) || num < 0) return '';
  if (num === 0) return '○';
  if (num === 10) return '十';
  if (num < 10) return CHINESE_DIGITS[num];
  if (num < 20) return `十${CHINESE_DIGITS[num % 10]}`;
  if (num < 100) {
    const ones = num % 10;
    return `${CHINESE_DIGITS[Math.floor(num / 10)]}十${ones === 0 ? '' : CHINESE_DIGITS[ones]}`;
  }
  return String(num)
    .split('')
    .map((digit) => (digit === '0' ? '○' : CHINESE_DIGITS[Number(digit)]))
    .join('');
};

const CHINESE_GROUP_UNITS = ['', '十', '百', '千'];

const chineseThousandGroup = (group: number): string => {
  let result = '';
  let pendingZero = false;
  for (let position = 3; position >= 0; position -= 1) {
    const digit = Math.floor(group / 10 ** position) % 10;
    if (digit === 0) {
      if (result) pendingZero = true;
      continue;
    }
    if (pendingZero) {
      result += '〇';
      pendingZero = false;
    }
    result += CHINESE_DIGITS[digit] + CHINESE_GROUP_UNITS[position];
  }
  return result;
};

const intToChineseCountingThousand = (num: number): string => {
  if (!Number.isInteger(num) || num < 0 || num >= 1_000_000) return '';
  if (num === 0) return '〇';
  if (num >= 10 && num < 20) {
    const ones = num % 10;
    return `十${ones === 0 ? '' : CHINESE_DIGITS[ones]}`;
  }
  const wan = Math.floor(num / 10_000);
  const rest = num % 10_000;
  let result = wan > 0 ? `${chineseThousandGroup(wan)}万` : '';
  if (rest > 0) {
    // A zero digit sits between the groups exactly when the 万-group ends in 0
    // or the remainder has no thousands digit (109999 -> 一十万〇九千九百九十九).
    const zeroBetweenGroups = wan > 0 && (wan % 10 === 0 || rest < 1000);
    result += (zeroBetweenGroups ? '〇' : '') + chineseThousandGroup(rest);
  }
  return result;
};

// OOXML w:numFmt values per ECMA-376 §17.18.59, matched to Word 16 output
// (ListFormat.ListString) where the spec and Word disagree:
//   hebrew1 -> gematria numerals   (א, ב, ... י, יא, ... כ, ... ק, ר, ש)
//   hebrew2 -> alphabet counting   (א ... ת, then תא, תב, ... תת, תתא, ...)
//
// Word's Hebrew converter only represents 1-392, and both formats then restart
// from א. Measured across three full periods of a 1200-item list and at the
// w:start values 0, 1, 380, 390, 391, 392, 393, 700, 780, 783, 784, 785 and
// 32760, so the wrap keys off the counter value rather than the item position.
// 392 has no meaning in Hebrew numeration - the natural bounds would be 399 or
// 400 - so treat it as an internal Word constant. Note that ת never appears in
// hebrew1: the highest representable value is 392 (שצב).
//
// The same 392 bound applies to the PAGE-field path, but its out-of-range
// behavior differs - Word emits a localized error string there rather than
// wrapping - so page numbering deliberately does not share these formatters.
//
// Two details Word insists on that the spec does not mention: 15 and 16 are טו
// and טז at every hundreds level (115, 215, 315 too), avoiding the divine-name
// spellings יה and יו; and every hebrew2 marker - but no hebrew1 marker -
// carries a leading U+200F, confirmed on both ListFormat.ListString and
// Field.Result.Text.
const HEBREW_NUMERAL_CYCLE = 392;
const HEBREW_HUNDREDS = ['', 'ק', 'ר', 'ש'];
const HEBREW_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HEBREW_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
// The 22 letters in alphabet order; hebrew2 never uses the final forms.
const HEBREW_ALPHABET = 'אבגדהוזחטיכלמנסעפצקרשת';

/**
 * Folds a counter onto Word's representable 1-392 range. Returns 0 for input
 * Word cannot number at all, which renders as an empty marker: `w:start="0"` is
 * schema-valid (`ST_DecimalNumber`) and Word draws no marker for that item.
 */
const toHebrewCycleValue = (num: number): number => {
  if (!Number.isInteger(num) || num < 1) return 0;
  return ((num - 1) % HEBREW_NUMERAL_CYCLE) + 1;
};

const intToHebrewNumeral = (num: number): string => {
  const value = toHebrewCycleValue(num);
  if (value === 0) return '';
  const hundreds = HEBREW_HUNDREDS[Math.floor(value / 100)];
  const rest = value % 100;
  if (rest === 15) return `${hundreds}טו`;
  if (rest === 16) return `${hundreds}טז`;
  return `${hundreds}${HEBREW_TENS[Math.floor(rest / 10)]}${HEBREW_ONES[rest % 10]}`;
};

const intToHebrewAlphabetic = (num: number): string => {
  const value = toHebrewCycleValue(num);
  if (value === 0) return '';
  const repeats = Math.floor((value - 1) / HEBREW_ALPHABET.length);
  return `\u200F${'ת'.repeat(repeats)}${HEBREW_ALPHABET[(value - 1) % HEBREW_ALPHABET.length]}`;
};

const NUMBER_FORMATTERS: ReadonlyMap<string, NumberFormatter> = new Map(
  Object.entries({
    decimal: decimalDigits,
    decimalZero: decimalZeroFormatter,
    lowerRoman: lowerCased(intToRoman),
    upperRoman: intToRoman,
    lowerLetter: lowerCased(intToAlpha),
    upperLetter: intToAlpha,
    ordinal: ordinalFormatter,
    ordinalText: ordinalTextFormatter,
    cardinalText: cardinalTextFormatter,
    japaneseCounting: intToJapaneseCounting,
    chineseCounting: intToChineseCounting,
    taiwaneseCounting: intToChineseCounting,
    chineseCountingThousand: intToChineseCountingThousand,
    hebrew1: intToHebrewNumeral,
    hebrew2: intToHebrewAlphabetic,
    ...SCRIPT_FORMATTERS,
  }),
);

const normalizeChars = new Set(['', '', '○', '■', '□']);

export const normalizeLvlTextChar = (lvlText?: string): string | undefined => {
  if (!lvlText || !normalizeChars.has(lvlText)) return lvlText;

  if (lvlText === '') return '•';
  if (lvlText === '○') return '◦';
  if (lvlText === '■' || lvlText === '') return '▪';
  if (lvlText === '□') return '◯';
  return lvlText;
};

const SYMBOL_FONT_PRIVATE_USE_GLYPHS: Readonly<Record<string, string>> = { symbol: '\uF0B7', wingdings: '\uF0A7' };

const primaryFontFamily = (fontFamily: string | null | undefined): string =>
  (fontFamily ?? '')
    .split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase() ?? '';

const SYMBOL_FONT_PRIVATE_USE_PATTERN = /[\uF0A7\uF0B7]/;

export const normalizeSymbolFontText = (text: string, fontFamily: string | null | undefined): string => {
  if (!SYMBOL_FONT_PRIVATE_USE_PATTERN.test(text)) return text;
  const glyph = SYMBOL_FONT_PRIVATE_USE_GLYPHS[primaryFontFamily(fontFamily)];
  return glyph && text.includes(glyph) ? text.split(glyph).join(normalizeLvlTextChar(glyph) ?? glyph) : text;
};

export const listNumberingHelpers = {
  generateOrderedListIndex,
  intToJapaneseCounting,
  normalizeLvlTextChar,
  normalizeSymbolFontText,
};

export type { NumberingHandler };
