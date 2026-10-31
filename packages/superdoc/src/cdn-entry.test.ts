import { describe, it, expect } from 'vite-plus/test';
import SuperDoc from './cdn-entry.js';
import * as namespace from './public/index.ts';
import { resolveDocxEngineCdnBaseUrl } from './core/v2-integration/cdn-engine-loader.js';

describe('cdn-entry', () => {
  it('exposes the SuperDoc class as the default export', () => {
    expect(typeof SuperDoc).toBe('function');
    expect(SuperDoc.name).toBe('SuperDoc');
  });

  it('attaches every named export as a static property on SuperDoc with identity preserved', () => {
    const mismatched = [];
    for (const key of Object.keys(namespace)) {
      if (key === 'SuperDoc' || key === 'default') continue;
      if (SuperDoc[key] !== namespace[key]) mismatched.push(key);
    }
    expect(mismatched).toEqual([]);
  });

  it('does not leak wrapper aliases like SuperDoc.SuperDoc or SuperDoc.default', () => {
    expect(SuperDoc).not.toHaveProperty('SuperDoc');
    expect(SuperDoc).not.toHaveProperty('default');
  });

  it('preserves Function intrinsics (name, prototype) — no clobbering', () => {
    expect(SuperDoc.name).toBe('SuperDoc');
    expect(typeof SuperDoc.prototype).toBe('object');
    expect(SuperDoc.prototype.constructor).toBe(SuperDoc);
  });

  it('loads the exact engine version from jsDelivr by default', () => {
    expect(resolveDocxEngineCdnBaseUrl({}, '0.1.0')).toBe('https://cdn.jsdelivr.net/npm/@superdoc/docx-engine@0.1.0');
  });

  it('accepts a runtime CDN base override', () => {
    expect(
      resolveDocxEngineCdnBaseUrl({ SUPERDOC_ENGINE_CDN_BASE_URL: 'https://cdn.example.test/engine/' }, '0.1.0'),
    ).toBe('https://cdn.example.test/engine');
  });
});
