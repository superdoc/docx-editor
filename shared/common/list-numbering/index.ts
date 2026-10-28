type NumberingHandler = (path: number[], lvlText: string, customFormat?: string) => string | null;

type NumberFormatter = (value: number) => string;

const handleDecimal: NumberingHandler = (path, lvlText) => generateNumbering(path, lvlText, numberToStringFormatter);
const handleRoman: NumberingHandler = (path, lvlText) => generateNumbering(path, lvlText, intToRoman);
const handleLowerRoman: NumberingHandler = (path, lvlText) => {
  const result = handleRoman(path, lvlText);
  return result ? result.toLowerCase() : null;
};
const handleAlpha: NumberingHandler = (path, lvlText) => generateNumbering(path, lvlText, intToAlpha);
const handleLowerAlpha: NumberingHandler = (path, lvlText) => {
  const result = handleAlpha(path, lvlText);
  return result ? result.toLowerCase() : null;
};
const handleOrdinal: NumberingHandler = (path, lvlText) => generateNumbering(path, lvlText, ordinalFormatter);
const handleOrdinalText: NumberingHandler = (path, lvlText) => generateNumbering(path, lvlText, ordinalTextFormatter);
const handleCardinalText: NumberingHandler = (path, lvlText) => generateNumbering(path, lvlText, cardinalTextFormatter);
const handleCustom: NumberingHandler = (path, lvlText, customFormat) =>
  generateFromCustom(path, lvlText, customFormat as string);
const handleJapaneseCounting: NumberingHandler = (path, lvlText) =>
  generateNumbering(path, lvlText, intToJapaneseCounting);
const handleDecimalZero: NumberingHandler = (path, lvlText) => generateNumbering(path, lvlText, decimalZeroFormatter);
const handleChineseCounting: NumberingHandler = (path, lvlText) =>
  generateNumbering(path, lvlText, intToChineseCounting);
const handleChineseCountingThousand: NumberingHandler = (path, lvlText) =>
  generateNumbering(path, lvlText, intToChineseCountingThousand);
const handleHebrewNumeral: NumberingHandler = (path, lvlText) => generateNumbering(path, lvlText, intToHebrewNumeral);
const handleHebrewAlphabetic: NumberingHandler = (path, lvlText) =>
  generateNumbering(path, lvlText, intToHebrewAlphabetic);

const listIndexMap: Record<string, NumberingHandler> = {
  decimal: handleDecimal,
  decimalZero: handleDecimalZero,
  lowerRoman: handleLowerRoman,
  upperRoman: handleRoman,
  lowerLetter: handleLowerAlpha,
  upperLetter: handleAlpha,
  ordinal: handleOrdinal,
  ordinalText: handleOrdinalText,
  cardinalText: handleCardinalText,
  custom: handleCustom,
  japaneseCounting: handleJapaneseCounting,
  chineseCounting: handleChineseCounting,
  chineseCountingThousand: handleChineseCountingThousand,
  hebrew1: handleHebrewNumeral,
  hebrew2: handleHebrewAlphabetic,
};

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
  const handler = listIndexMap[listNumberingType as string];
  return handler ? handler(listLevel, lvlText, customFormat) : null;
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

// OOXML w:numFmt values per ECMA-376 §17.18.59:
//   ordinalText  -> "First", "Second", "Third", ...
//   cardinalText -> "One", "Two", "Three", ...
// Used by legal/contract templates (e.g., FIRST: SECOND: section markers).
// The <w:caps/> mark on the run elevates these to "FIRST", "SECOND", etc.
const ONES_ORDINAL = [
  '',
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
  'Eleventh',
  'Twelfth',
  'Thirteenth',
  'Fourteenth',
  'Fifteenth',
  'Sixteenth',
  'Seventeenth',
  'Eighteenth',
  'Nineteenth',
];
const TENS_ORDINAL = [
  '',
  '',
  'Twentieth',
  'Thirtieth',
  'Fortieth',
  'Fiftieth',
  'Sixtieth',
  'Seventieth',
  'Eightieth',
  'Ninetieth',
];
const ONES_CARDINAL = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS_CARDINAL = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const ordinalTextFormatter: NumberFormatter = (value) => {
  if (!Number.isFinite(value) || value < 1) return '';
  if (value < ONES_ORDINAL.length) return ONES_ORDINAL[value];
  if (value < 100) {
    const t = Math.floor(value / 10);
    const o = value % 10;
    if (o === 0) return TENS_ORDINAL[t];
    return `${TENS_CARDINAL[t]}-${ONES_ORDINAL[o]}`;
  }
  // Fallback for 100+: numeric ordinal (kept simple).
  return ordinalFormatter(value);
};

const cardinalTextFormatter: NumberFormatter = (value) => {
  if (!Number.isFinite(value) || value < 1) return '';
  if (value < ONES_CARDINAL.length) return ONES_CARDINAL[value];
  if (value < 100) {
    const t = Math.floor(value / 10);
    const o = value % 10;
    if (o === 0) return TENS_CARDINAL[t];
    return `${TENS_CARDINAL[t]}-${ONES_CARDINAL[o]}`;
  }
  return String(value);
};

const decimalZeroFormatter: NumberFormatter = (value) => {
  if (value >= 10) return String(value);
  return `0${value}`;
};

const generateFromCustom = (path: number[], lvlText: string, customFormat: string): string => {
  if (typeof customFormat !== 'string') {
    return generateNumbering(path, lvlText, numberToStringFormatter);
  }
  if (customFormat.match(/(?:[0]+\d,\s){3}\.{3}/) == null) {
    return generateNumbering(path, lvlText, numberToStringFormatter);
  }

  const match = customFormat.match(/(\d+)/);
  if (!match) {
    throw new Error('Invalid format string: no numeric pattern found');
  }

  const digitCount = match[1].length;
  return generateNumbering(path, lvlText, (p) => String(p).padStart(digitCount, '0'));
};

const numberToStringFormatter: NumberFormatter = (value) => String(value);

const intToRoman = (num: number): string => {
  const romanNumeralMap = [
    { value: 1000, numeral: 'M' },
    { value: 900, numeral: 'CM' },
    { value: 500, numeral: 'D' },
    { value: 400, numeral: 'CD' },
    { value: 100, numeral: 'C' },
    { value: 90, numeral: 'XC' },
    { value: 50, numeral: 'L' },
    { value: 40, numeral: 'XL' },
    { value: 10, numeral: 'X' },
    { value: 9, numeral: 'IX' },
    { value: 5, numeral: 'V' },
    { value: 4, numeral: 'IV' },
    { value: 1, numeral: 'I' },
  ];

  let result = '';
  let remaining = num;
  for (const { value, numeral } of romanNumeralMap) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
};

/**
 * Word-compatible alphabetic numbering for `upperLetter` / `lowerLetter`
 * list formats: A, B, ..., Z, AA, BB, ..., ZZ, AAA, BBB, ..., ZZZ, AAAA, ...
 *
 * The OOXML spec maps `n` to the letter at index `(n-1) % 26` repeated
 * `floor((n-1) / 26) + 1` times. This differs from a base-26 (Excel-style)
 * mapping where 27 → "AA" but 28 → "AB"; Word emits "BB" at 28.
 */
const intToAlpha = (num: number): string => {
  if (num < 1) return '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letter = alphabet[(num - 1) % 26];
  const repeats = Math.floor((num - 1) / 26) + 1;
  return letter.repeat(repeats);
};

export const intToJapaneseCounting = (num: number): string => {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const units = ['', '十', '百', '千'];

  if (num === 0) return '零';
  if (num < 10) return digits[num];

  let result = '';
  let tempNum = num;
  let unitIndex = 0;

  while (tempNum > 0) {
    const digit = tempNum % 10;
    if (digit !== 0) {
      const digitStr = digit === 1 && unitIndex > 0 ? '' : digits[digit];
      result = digitStr + (unitIndex > 0 ? units[unitIndex] : '') + result;
    } else if (result && tempNum > 0) {
      if (!result.startsWith('零') && tempNum % 100 !== 0) {
        result = '零' + result;
      }
    }

    tempNum = Math.floor(tempNum / 10);
    unitIndex += 1;

    if (unitIndex > 3) break;
  }

  if (num >= 10 && num < 20) {
    result = result.replace(/^一十/, '十');
  }

  return result;
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

const normalizeChars = new Set(['', '', '○', 'o', '■', '□']);

export const normalizeLvlTextChar = (lvlText?: string): string | undefined => {
  if (!lvlText || !normalizeChars.has(lvlText)) return lvlText;

  if (lvlText === '') return '•';
  if (lvlText === '○' || lvlText === 'o') return '◦';
  if (lvlText === '■' || lvlText === '') return '▪';
  if (lvlText === '□') return '◯';
  return lvlText;
};

export const listNumberingHelpers = {
  generateOrderedListIndex,
  intToJapaneseCounting,
  normalizeLvlTextChar,
};

export type { NumberingHandler };
