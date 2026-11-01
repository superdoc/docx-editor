import { describe, it, expect } from 'vite-plus/test';
import { formatDate } from './helpers.js';

describe('formatDate', () => {
  it('formats a morning timestamp with AM and padded minutes', () => {
    // 2024-01-15 09:05:00 local
    const ts = new Date(2024, 0, 15, 9, 5).getTime();
    expect(formatDate(ts)).toBe('9:05AM Jan 15');
  });

  it('formats an afternoon timestamp with PM', () => {
    const ts = new Date(2024, 5, 1, 14, 30).getTime();
    expect(formatDate(ts)).toBe('2:30PM Jun 1');
  });

  it('displays midnight as 12 AM', () => {
    const ts = new Date(2024, 11, 31, 0, 0).getTime();
    expect(formatDate(ts)).toBe('12:00AM Dec 31');
  });

  it('displays noon as 12 PM', () => {
    const ts = new Date(2024, 6, 4, 12, 45).getTime();
    expect(formatDate(ts)).toBe('12:45PM Jul 4');
  });

  it('pads single-digit minutes with a leading zero', () => {
    const ts = new Date(2024, 2, 2, 8, 9).getTime();
    expect(formatDate(ts)).toBe('8:09AM Mar 2');
  });
});
