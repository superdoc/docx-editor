const FONT_GUIDE_URL = 'https://docs.superdoc.dev/editor/fonts/';

function isLocalDevelopmentHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.')
  );
}

export function warnForMissingDocumentFonts(
  missingFonts: readonly string[] | undefined,
  warnedFonts: Set<string>,
  hostname = typeof window === 'undefined' ? '' : window.location.hostname,
): void {
  if (!isLocalDevelopmentHost(hostname) || !Array.isArray(missingFonts)) return;

  const newlyMissing = [...new Set(missingFonts.map((font) => font.trim()).filter(Boolean))].filter(
    (font) => !warnedFonts.has(font),
  );
  if (newlyMissing.length === 0) return;

  for (const font of newlyMissing) warnedFonts.add(font);
  const noun = newlyMissing.length === 1 ? 'font' : 'fonts';
  const names = newlyMissing.map((font) => `"${font}"`).join(', ');
  console.warn(
    `[SuperDoc] Missing document ${noun}: ${names}. The browser is using fallback fonts, which can change line and page breaks. Configure document fonts: ${FONT_GUIDE_URL}`,
  );
}
