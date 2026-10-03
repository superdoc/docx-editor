import { useEffect, useRef, useState } from 'react';
import type { SelectionCapture } from 'superdoc/ui';
import {
  useSuperDocCommand,
  useSuperDocDocument,
  useSuperDocFontOptions,
  useSuperDocFontSizeOptions,
  useSuperDocHost,
  useSuperDocUI,
} from 'superdoc/ui/react';

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
};

// Renders native font selectors backed by the active SuperDoc selection.
function FontControls() {
  const ui = useSuperDocUI();
  const fontState = useSuperDocCommand('font-family');
  const sizeState = useSuperDocCommand('font-size');
  const fonts = useSuperDocFontOptions();
  const sizes = useSuperDocFontSizeOptions();
  const selectionCapture = useRef<SelectionCapture | null>(null);
  const fontValue = String(fontState.value ?? fonts[0]?.value ?? 'Arial');
  const sizeValue = String(
    sizeState.value ?? sizes.find((size) => size.value === '12')?.value ?? sizes[0]?.value ?? '12',
  );

  // Preserves the editor selection while focus moves into a native select.
  const preserveSelection = () => {
    selectionCapture.current = ui?.selection.capture() ?? null;
  };

  const execute = (command: string, value: string | number) => {
    if (selectionCapture.current) ui?.selection.restore(selectionCapture.current);
    ui?.commands.execute(command, value);
  };

  return (
    <div className='native-font-controls' aria-label='Font controls'>
      <select
        aria-label='Font family'
        value={fontValue}
        onPointerDown={preserveSelection}
        onChange={(event) => execute('font-family', event.target.value)}
      >
        {!fonts.some((font) => font.value === fontValue) ? <option value={fontValue}>{fontValue}</option> : null}
        {fonts.map((font) => (
          <option key={font.value} value={font.value}>
            {font.label}
          </option>
        ))}
      </select>
      <select
        aria-label='Font size'
        value={sizeValue}
        onPointerDown={preserveSelection}
        onChange={(event) => execute('font-size', Number(event.target.value))}
      >
        {!sizes.some((size) => size.value === sizeValue) ? <option value={sizeValue}>{sizeValue}</option> : null}
        {sizes.map((size) => (
          <option key={size.value} value={size.value}>
            {size.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Hosts document actions, naming, mode selection, and formatting controls.
export function Topbar({
  documentName,
  onNewDocument,
  onUploadDocument,
  onOpenRoom,
  onRenameDocument,
}: {
  documentName: string;
  onNewDocument: () => void;
  onUploadDocument: (file: File) => void;
  onOpenRoom: () => void;
  onRenameDocument: (name: string) => Promise<void>;
}) {
  const host = useSuperDocHost();
  const ui = useSuperDocUI();
  const document = useSuperDocDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(documentName);

  useEffect(() => setNameDraft(documentName), [documentName]);

  // Persists a non-empty inline document-name edit.
  const saveName = async () => {
    const nextName = nameDraft.trim();
    if (!nextName) {
      setNameDraft(documentName);
      setEditingName(false);
      return;
    }
    try {
      await onRenameDocument(nextName);
    } finally {
      setEditingName(false);
    }
  };

  // Exports the active document through the SuperDoc host.
  const exportDocument = async (exportedName = documentName.replace(/\.docx$/i, '')) => {
    if (!host || !('export' in host) || typeof host.export !== 'function') return;
    setSaving(true);
    try {
      await host.export({ exportType: ['docx'], exportedName });
    } finally {
      setSaving(false);
    }
  };

  // Validates a native file selection before creating an uploaded room.
  const uploadDocument = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setImportError('Choose a .docx file.');
      return;
    }
    setImportError('');
    onUploadDocument(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Uses the native save picker when available and falls back to a download.
  const saveDocumentAs = async () => {
    if (!ui) return;
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (!picker) {
      const name = window.prompt('Save document as', 'reviewed-contract');
      if (name?.trim()) await exportDocument(name.trim().replace(/\.docx$/i, ''));
      return;
    }

    try {
      const handle = await picker({
        suggestedName: `${documentName.replace(/\.docx$/i, '')}.docx`,
        types: [
          {
            description: 'Word document',
            accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
          },
        ],
      });
      setSaving(true);
      const result = await ui.document.export({ exportType: ['docx'], triggerDownload: false });
      if (!(result instanceof Blob)) throw new Error('SuperDoc did not return a DOCX file.');
      const writable = await handle.createWritable();
      await writable.write(result);
      await writable.close();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error(error);
      setImportError('The document could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const fileActions: Record<string, () => void> = {
    new: onNewDocument,
    open: onOpenRoom,
    upload: () => fileInputRef.current?.click(),
    'save-as': () => void saveDocumentAs(),
  };

  // Dispatches the selected File menu command.
  const chooseFileAction = (action: string) => fileActions[action]?.();

  return (
    <header className='topbar'>
      <div className='ribbon-tabs-row'>
        <div className='file-title'>
          {editingName ? (
            <input
              className='file-name-input'
              value={nameDraft}
              autoFocus
              aria-label='Document name'
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveName();
                if (event.key === 'Escape') {
                  setNameDraft(documentName);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <button className='file-name-button' onClick={() => setEditingName(true)}>
              <span>{documentName}</span>
              <span className='file-name-caret' aria-hidden='true' />
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          className='visually-hidden'
          type='file'
          accept='.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          onChange={(event) => uploadDocument(event.target.files?.[0])}
        />
        <select
          className='file-menu'
          aria-label='File'
          value=''
          onChange={(event) => chooseFileAction(event.target.value)}
          disabled={!document.ready}
          title={importError || undefined}
        >
          <option value='' disabled>
            File
          </option>
          <option value='new'>New Document</option>
          <option value='open'>Open recent…</option>
          <option value='upload'>Upload…</option>
          <option value='save-as'>Save As…</option>
        </select>
        <label className='mode-select'>
          <select
            aria-label='Document mode'
            value={document.mode ?? 'suggesting'}
            onChange={(event) => host?.setDocumentMode?.(event.target.value as 'suggesting' | 'editing' | 'viewing')}
          >
            <option value='suggesting'>Reviewing</option>
            <option value='editing'>Editing</option>
            <option value='viewing'>Viewing</option>
          </select>
        </label>
      </div>
      <div className='ribbon-controls-row default-toolbar-row'>
        <FontControls />
        <div id='default-toolbar' className='default-toolbar' aria-label='Document toolbar' />
      </div>
    </header>
  );
}
