import type { SuperDoc } from 'superdoc';

export function observeDocumentFonts(superdoc: SuperDoc) {
  return superdoc.fonts.onReport(({ report = [] }) => {
    for (const font of report) {
      console.log({
        logicalFamily: font.logicalFamily,
        physicalFamily: font.physicalFamily,
        reason: font.reason,
        loadStatus: font.loadStatus,
        systemAvailability: font.systemAvailability,
        exportFamily: font.exportFamily,
        missing: font.missing,
        // Face-level rows repeat a family per weight/style; without this, a failed bold is
        // indistinguishable from the regular that loaded beside it.
        face: font.face,
        // A substitution can load cleanly and still reflow the document. `evidence.lineBreakSafe`
        // is the only field that separates a metric-safe substitute from a visual-only one.
        evidence: font.evidence,
      });
    }
  });
}
