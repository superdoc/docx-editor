/**
 * Union type representing all supported numbering format types.
 * These formats determine how list markers are displayed.
 */
export type NumberingFormat = 'bullet' | 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';

/**
 * Default hanging indent for list items in pixels.
 * This value determines the horizontal offset between the marker and the text content.
 */
export const DEFAULT_LIST_HANGING_PX = 18;

/**
 * Gap between the list marker and the text content in pixels.
 * This spacing ensures visual separation between the marker and the paragraph text.
 */
export const LIST_MARKER_GAP = 8;
