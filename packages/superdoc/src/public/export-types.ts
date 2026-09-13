/** Browser export format. DOCX is the only supported output. */
export type ExportType = 'docx';

/** Comment output: `external` includes external comments; `clean` removes comments. */
export type CommentsType = 'external' | 'clean';

/** Options accepted by `SuperDoc.export()` and `ui.document.export()`. */
export interface ExportParams {
  /** Browser export format. DOCX is the only supported output. */
  exportType?: readonly [ExportType];
  /** How to handle comments. */
  commentsType?: CommentsType;
  /** Custom filename without an extension. */
  exportedName?: string;
  /** Extra files to include in the export zip. */
  additionalFiles?: globalThis.Blob[];
  /** Filenames for the additional files. */
  additionalFileNames?: string[];
  /** Whether this is a final document export. */
  isFinalDoc?: boolean;
  /** Download the file or return its Blob without downloading. */
  triggerDownload?: boolean;
  /** Field-highlight color, or `null` to omit field highlighting. */
  fieldsHighlightColor?: string | null;
}
