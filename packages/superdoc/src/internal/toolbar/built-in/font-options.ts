import type { ToolbarFontOption } from '../../../core/types/index.js';

/**
 * Normalize a font dropdown option so each row renders in its own typeface.
 *
 * Consumers can pass a minimal `{ label, key }` shape. The toolbar dropdown
 * spreads `option.props` onto each rendered `<li>`, so without an inline
 * `style.fontFamily` every row inherits the toolbar's UI font and the
 * dropdown loses its visual font preview. This fills that in from
 * `props.style.fontFamily` → `label` → `key` and keeps the existing
 * `data-item` hook that e2e selectors rely on.
 *
 * Idempotent: if `props.style.fontFamily` and `data-item` are already set,
 * the option is returned with those values preserved.
 */
export const normalizeFontOption = <T extends ToolbarFontOption>(option: T): T => {
  if (!option) return option;
  const fontFamily = option.props?.style?.fontFamily ?? option.label ?? option.key;
  return {
    ...option,
    props: {
      ...option.props,
      style: {
        ...option.props?.style,
        fontFamily,
      },
      'data-item': option.props?.['data-item'] ?? 'btn-fontFamily-option',
    },
  };
};
