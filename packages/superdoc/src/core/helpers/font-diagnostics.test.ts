import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { warnForMissingDocumentFonts } from './font-diagnostics.js';

afterEach(() => vi.restoreAllMocks());

describe('warnForMissingDocumentFonts', () => {
  it('warns once per missing font on local development hosts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const warnedFonts = new Set<string>();

    warnForMissingDocumentFonts(['Aptos', 'Aptos Display'], warnedFonts, 'localhost');
    warnForMissingDocumentFonts(['Aptos'], warnedFonts, '127.0.0.1');

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Missing document fonts: "Aptos", "Aptos Display"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('https://docs.superdoc.dev/editor/fonts/'));
  });

  it('does not warn outside a local development host', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warnForMissingDocumentFonts(['Aptos'], new Set(), 'app.example.com');

    expect(warn).not.toHaveBeenCalled();
  });

  it('recognizes common loopback hostnames', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    for (const hostname of ['docs.localhost', '0.0.0.0', '::1', '[::1]', '127.0.0.2']) {
      warnForMissingDocumentFonts(['Aptos'], new Set(), hostname);
    }

    expect(warn).toHaveBeenCalledTimes(5);
  });
});
