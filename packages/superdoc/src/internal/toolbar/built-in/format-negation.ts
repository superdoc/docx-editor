type MarkAttrs = Record<string, unknown>;

/**
 * Normalize "off" values used by cascade-aware formatting marks.
 */
export const isOffValue = (value: unknown): boolean => {
  if (value == null) return false;
  const normalized = String(value).toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'off';
};

export const negationChecks: Record<string, (attrs?: MarkAttrs) => boolean> = {
  bold: (attrs = {}) => isOffValue(attrs.value),
  italic: (attrs = {}) => isOffValue(attrs.value),
  strike: (attrs = {}) => isOffValue(attrs.value),
  underline: (attrs = {}) => {
    const type = attrs.underlineType ?? attrs.value;
    if (type == null) return false;
    const normalized = String(type).toLowerCase();
    return normalized === 'none' || isOffValue(normalized);
  },
  color: (attrs = {}) => {
    const value = attrs.color;
    if (value == null) return true;
    return String(value).toLowerCase() === 'inherit';
  },
  highlight: (attrs = {}) => {
    const value = attrs.color;
    if (value == null) return true;
    const normalized = String(value).toLowerCase();
    return normalized === 'transparent' || normalized === 'none';
  },
};

/**
 * Determine whether a mark is currently negated (explicitly turning formatting off).
 */
export const isNegatedMark = (name: string, attrs: MarkAttrs = {}): boolean => {
  const checker = negationChecks[name];
  if (typeof checker !== 'function') return false;
  return Boolean(checker(attrs));
};

export default isNegatedMark;
