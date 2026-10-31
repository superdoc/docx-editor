import { describe, it, expect } from 'vite-plus/test';
import { createTextarea } from './createTextarea';

describe('createTextarea', () => {
  it('creates a textarea element with default values', () => {
    const textarea = createTextarea();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('');
    expect(textarea.style.position).toBe('absolute');
    expect(textarea.style.fontSize).toBe('16px');
    expect(textarea.style.fontFamily).toBe('Arial, sans-serif');
    expect(textarea.style.color).toBe('#000');
  });

  it('applies provided position and size', () => {
    const textarea = createTextarea({ left: 10, top: 20, width: 200, height: 50 });
    expect(textarea.style.left).toBe('10px');
    expect(textarea.style.top).toBe('20px');
    expect(textarea.style.width).toBe('200px');
    expect(textarea.style.height).toBe('50px');
  });

  it('accepts string sizes and custom styling', () => {
    const textarea = createTextarea({
      width: '12rem',
      height: '3rem',
      fontSize: '14pt',
      fontFamily: 'serif',
      color: '#123456',
      background: '#fff',
      resize: 'vertical',
    });
    expect(textarea.style.width).toBe('12rem');
    expect(textarea.style.height).toBe('3rem');
    expect(textarea.style.fontSize).toBe('14pt');
    expect(textarea.style.fontFamily).toBe('serif');
    expect(textarea.style.color).toBe('#123456');
    expect(textarea.style.background).toBe('#fff');
    expect(textarea.style.resize).toBe('vertical');
  });
});
