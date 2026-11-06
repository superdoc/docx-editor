/**
 * Hand-written declarations for `SuperConverter`. The implementation lives
 * in the sibling `SuperConverter.js`.
 *
 * SD-3213c partially drained this shim:
 *   - typed constructor (no more `constructor(...args: any[])`)
 *   - typed the named static methods and exported helper function
 *   - tightened `extractDocumentGuid` / `getStoredSuperdocVersion` /
 *     `setStoredSuperdocVersion` from `any[]` to specific shapes
 *
 * The `[key: string]: any` catchall is intentionally retained for now.
 * `SuperConverter.d.ts` doubles as the type source for a large `.js`
 * implementation; internal callers (`Editor.ts`, `PresentationEditor.ts`,
 * `HeaderFooterRegistry.ts`, list-level helpers, etc.) read dozens of
 * instance properties and methods on this class via the index signature.
 * Tightening the public shape without converting the impl to TypeScript
 * (or splitting public/internal contracts) cascades into ~60 typecheck
 * errors across the repo. Tracked as follow-up: convert SuperConverter
 * to TS or formalize a public/internal contract split.
 *
 * Consumer note: external code accessing `SuperConverter` instance
 * properties or methods through the index signature still resolves to
 * `any`. This is debt, not desired public API. Anything you read off a
 * SuperConverter instance today is not part of the stable contract.
 */
export class SuperConverter {
  constructor(params?: {
    debug?: boolean;
    mockWindow?: unknown;
    mockDocument?: unknown;
    docx?: unknown;
    media?: Record<string, unknown>;
    fonts?: Record<string, unknown>;
    xml?: string;
    json?: unknown;
    fileSource?: unknown;
    documentId?: string | null;
    isNewFile?: boolean;
    trackedChangesOptions?: { replacements?: 'paired' | 'independent' } | null;
  });

  static getStoredSuperdocVersion(docx: readonly { readonly name: string; readonly content: string }[]): string | null;
  static setStoredCustomProperty(
    docx: unknown,
    propertyName: string,
    value: string | (() => string),
    preserveExisting?: boolean,
  ): string | null;
  // The setter accepts either shape (array of file entries or mutable map
  // keyed by package path); the underlying `setStoredCustomProperty` does
  // `docx[customLocation] = ...`, which works on both at runtime.
  static setStoredSuperdocVersion(docx: unknown, version?: string): string | null;
  static extractDocumentGuid(docx: readonly { readonly name: string; readonly content: string }[]): string | null;

  /** Serialized export-local people part and optional relationship overlay. */
  getCommentPeopleUpdatedFiles(): Record<string, string>;

  // Internal-implementation catchall. See file header for context.
  [key: string]: any;
}

export function hasBodyNumberingReferences(
  documentXml: { name?: string; elements?: readonly unknown[] } | null | undefined,
): boolean;
