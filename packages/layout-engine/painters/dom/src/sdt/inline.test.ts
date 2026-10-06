import { describe, expect, it } from 'vite-plus/test';
import type { TextRun } from '@superdoc/contracts';
import { syncInlineSdtWrapperTypography } from './inline.js';

describe('syncInlineSdtWrapperTypography', () => {
  it('uses an em-sized line box for Word checkbox controls', () => {
    const wrapper = document.createElement('span');
    wrapper.dataset.wordCheckbox = 'true';

    syncInlineSdtWrapperTypography(wrapper, { text: '', fontSize: 24 } as TextRun);

    expect(wrapper.style.fontSize).toBe('24px');
    expect(wrapper.style.lineHeight).toBe('1');
    expect(wrapper.style.verticalAlign).toBe('baseline');
  });

  it('retains normal line height for ordinary inline content controls', () => {
    const wrapper = document.createElement('span');

    syncInlineSdtWrapperTypography(wrapper, { text: '', fontSize: 24 } as TextRun);

    expect(wrapper.style.lineHeight).toBe('normal');
  });
});
