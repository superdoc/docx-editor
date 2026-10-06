import type { Run, SdtMetadata, TextRun } from '@superdoc/contracts';
import { DOM_CLASS_NAMES } from '../constants.js';
import { BROWSER_DEFAULT_FONT_SIZE } from '../styles.js';
import type { RunRenderContext } from '../runs/types.js';

export const resolveRunSdtId = (run: Run): { sdtId: string; sdt: SdtMetadata } | null => {
  const sdt = (run as TextRun).sdt;
  if (sdt?.type === 'structuredContent' && sdt?.scope === 'inline' && sdt?.id) {
    return { sdtId: String(sdt.id), sdt };
  }
  return null;
};

export const createInlineSdtWrapper = (sdt: SdtMetadata, context: RunRenderContext): HTMLElement => {
  const wrapper = context.doc.createElement('span');
  wrapper.className = DOM_CLASS_NAMES.INLINE_SDT_WRAPPER;
  wrapper.dataset.layoutEpoch = String(context.layoutEpoch);
  context.applySdtDataset(wrapper, sdt);

  const appearance = sdt.type === 'structuredContent' ? (sdt as { appearance?: string }).appearance : undefined;
  if (appearance === 'hidden') {
    wrapper.dataset.appearance = 'hidden';
    return wrapper;
  }
  const structuredContent = sdt.type === 'structuredContent' ? sdt : undefined;
  const checkbox = structuredContent?.checkbox;
  if (checkbox) {
    // Checkbox content controls own their visible glyph. Do not paint the
    // generic SDT border label around them: Word presents these as controls.
    wrapper.dataset.wordCheckbox = 'true';
    wrapper.setAttribute('role', 'checkbox');
    wrapper.setAttribute('aria-checked', String(checkbox.checked));
    if (structuredContent?.lockMode === 'contentLocked' || structuredContent?.lockMode === 'sdtContentLocked') {
      wrapper.setAttribute('aria-disabled', 'true');
    } else wrapper.tabIndex = 0;
    return wrapper;
  }
  if (context.contentControlsChrome === 'none') {
    return wrapper;
  }

  const alias = (sdt as { alias?: string })?.alias || 'Inline content';
  const labelEl = context.doc.createElement('span');
  labelEl.className = DOM_CLASS_NAMES.INLINE_SDT_LABEL;
  labelEl.textContent = alias;
  wrapper.appendChild(labelEl);
  return wrapper;
};

export const syncInlineSdtWrapperTypography = (wrapper: HTMLElement, runForSizing?: Run): void => {
  // The line container sets fontSize:0; keep wrapper chrome aligned with the run text size.
  const runFontSize =
    runForSizing && 'fontSize' in runForSizing && typeof runForSizing.fontSize === 'number'
      ? `${runForSizing.fontSize}px`
      : BROWSER_DEFAULT_FONT_SIZE;
  wrapper.style.fontSize = runFontSize;
  // A checkbox's symbol can come from a font whose `normal` line-height is
  // taller than its measured Word line. Keep the control's hit/selection box
  // on the authored em square so it cannot grow on the first interaction and
  // then shrink after the next paint.
  if (wrapper.dataset.wordCheckbox === 'true') {
    wrapper.style.lineHeight = '1';
    wrapper.style.verticalAlign = 'baseline';
    return;
  }
  wrapper.style.lineHeight = 'normal';
};

export const expandSdtWrapperPmRange = (wrapper: HTMLElement, pmStart?: number | null, pmEnd?: number | null): void => {
  if (pmStart != null) {
    const cur = wrapper.dataset.pmStart;
    if (!cur || pmStart < parseInt(cur, 10)) {
      wrapper.dataset.pmStart = String(pmStart);
    }
  }
  if (pmEnd != null) {
    const cur = wrapper.dataset.pmEnd;
    if (!cur || pmEnd > parseInt(cur, 10)) {
      wrapper.dataset.pmEnd = String(pmEnd);
    }
  }
};
