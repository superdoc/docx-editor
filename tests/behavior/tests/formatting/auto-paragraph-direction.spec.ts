import { test, expect } from '../../fixtures/superdoc.js';

// A paragraph with no explicit direction renders `dir="auto"`, so the
// browser resolves base direction from the first strong character typed
// (Arabic → rtl, Latin → ltr). An explicit toolbar/command direction is a hard
// override that does NOT auto-detect (Option A).

type LineDir = { dir: string | null; computed: string };

async function lineDir(superdoc: { page: import('@playwright/test').Page }, index: number): Promise<LineDir> {
  return superdoc.page.evaluate((i) => {
    const line = document.querySelectorAll<HTMLElement>('.superdoc-line')[i];
    if (!line) throw new Error(`.superdoc-line[${i}] not found`);
    return { dir: line.getAttribute('dir'), computed: getComputedStyle(line).direction };
  }, index);
}

test.describe('auto paragraph direction', () => {
  test('new line adopts RTL when the first typed character is Arabic', async ({ superdoc }) => {
    await superdoc.type('Hello');
    await superdoc.newLine();
    await superdoc.type('مرحبا');
    await superdoc.waitForStable();

    const second = await lineDir(superdoc, 1);
    // The line inherits the paragraph wrapper's resolved auto direction
    // (wrapper carries dir="auto"; lines don't stamp their own dir).
    expect(second.dir).toBeNull();
    expect(second.computed).toBe('rtl');
  });

  test('new line adopts LTR when the first typed character is Latin', async ({ superdoc }) => {
    await superdoc.type('مرحبا');
    await superdoc.newLine();
    await superdoc.type('Hello');
    await superdoc.waitForStable();

    const second = await lineDir(superdoc, 1);
    expect(second.dir).toBeNull();
    expect(second.computed).toBe('ltr');
  });

  test('manual RTL override persists when Latin is typed (Option A)', async ({ superdoc }) => {
    await superdoc.executeCommand('setParagraphDirection', { direction: 'rtl' });
    await superdoc.waitForStable();
    await superdoc.type('Hello English');
    await superdoc.waitForStable();

    const first = await lineDir(superdoc, 0);
    // Hard override — stays rtl, NOT "auto", even though the content is Latin.
    expect(first.dir).toBe('rtl');
    expect(first.computed).toBe('rtl');
  });

  test('manual LTR override persists when Arabic is typed (Option A)', async ({ superdoc }) => {
    await superdoc.executeCommand('setParagraphDirection', { direction: 'ltr' });
    await superdoc.waitForStable();
    await superdoc.type('مرحبا');
    await superdoc.waitForStable();

    const first = await lineDir(superdoc, 0);
    // Hard override — stays ltr, NOT "auto", even though the content is Arabic.
    expect(first.dir).toBe('ltr');
    expect(first.computed).toBe('ltr');
  });
});
