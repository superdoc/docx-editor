import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('unconditional tracked-change loading', () => {
  it.each(['vite.config.js', 'vite.config.cdn.js', 'vite.config.devapp.js'])(
    'keeps %s free of the retired development bypass',
    (config) => {
      const source = readFileSync(path.resolve(__dirname, '../..', config), 'utf8');
      expect(source).not.toContain('DISABLE_TRACKED_CHANGE_LOADING');
      expect(source).not.toContain('resolveDisableTrackedChangeLoading');
    },
  );
});
