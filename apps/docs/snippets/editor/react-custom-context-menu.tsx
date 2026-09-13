import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { SuperDoc, UIConfig } from 'superdoc';
import type { CommandExecutionResult } from 'superdoc/ui';
import { SuperDocUIProvider, useSetSuperDoc, useSuperDocSelection, useSuperDocUI } from 'superdoc/ui/react';
import '@superdoc/react/style.css';

const editorUi = { contextMenu: false } satisfies UIConfig;

type ChangeTarget = { id: string; story?: unknown };
type MenuState = {
  id: number;
  x: number;
  y: number;
  changeTarget: ChangeTarget | null;
};

export default function App() {
  return (
    <SuperDocUIProvider>
      <ContextMenuEditor />
    </SuperDocUIProvider>
  );
}

function ContextMenuEditor() {
  const ui = useSuperDocUI();
  // The selection can still be settling when the menu opens. Subscribing keeps
  // Copy in step with the live selection instead of the snapshot at open time.
  const selection = useSuperDocSelection();
  const setSuperDoc = useSetSuperDoc();
  const superdocRef = useRef<SuperDoc | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuIdRef = useRef(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [decisionPending, setDecisionPending] = useState(false);
  const [status, setStatus] = useState('Right-click the document or press Shift+F10.');

  const selectedText = selection.status === 'ready' && !selection.empty ? selection.quotedText : '';

  function closeMenu(restoreEditorFocus: boolean) {
    // Any dismissal retires the current menu, so an action still in flight
    // cannot close it later or move focus away from wherever the user went.
    menuIdRef.current += 1;
    setMenu(null);
    if (restoreEditorFocus) requestAnimationFrame(() => superdocRef.current?.focus());
  }

  function openMenu(point: { x: number; y: number }) {
    if (!ui) return;

    const context = ui.contextMenu.contextAt(point);
    const trackedChange = context.entities.find((entity) => entity.type === 'trackedChange');

    menuIdRef.current += 1;
    setMenu({
      id: menuIdRef.current,
      x: context.point?.x ?? point.x,
      y: context.point?.y ?? point.y,
      changeTarget: trackedChange
        ? {
            id: trackedChange.id,
            ...(trackedChange.story === undefined ? {} : { story: trackedChange.story }),
          }
        : null,
    });
  }

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;

    const bounds = element.getBoundingClientRect();
    const edge = 8;
    element.style.left = `${Math.max(edge, Math.min(menu.x, window.innerWidth - bounds.width - edge))}px`;
    element.style.top = `${Math.max(edge, Math.min(menu.y, window.innerHeight - bounds.height - edge))}px`;
    (element.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? element).focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;

    const handleOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu(false);
    };
    const handleViewportChange = () => closeMenu(false);

    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [menu]);

  function report(result: CommandExecutionResult, success: string) {
    if (result === false) setStatus('That action is unavailable.');
    else if (result === true || result.success) setStatus(success);
    else setStatus(result.failure.message);
  }

  async function decideChange(decision: 'accept' | 'reject') {
    if (!ui || !menu?.changeTarget || decisionPending) return;
    // Only the menu that started this decision may close when it settles. The
    // user can dismiss it, or open another one, before the mutation lands.
    const menuId = menu.id;
    setDecisionPending(true);
    try {
      const result =
        decision === 'accept'
          ? await ui.trackChanges.acceptAsync(menu.changeTarget)
          : await ui.trackChanges.rejectAsync(menu.changeTarget);
      report(result, decision === 'accept' ? 'Change accepted.' : 'Change rejected.');
    } finally {
      setDecisionPending(false);
    }
    if (menuIdRef.current === menuId) closeMenu(true);
  }

  async function copySelection() {
    if (!selectedText) return;
    const menuId = menu?.id;
    try {
      await navigator.clipboard.writeText(selectedText);
      setStatus('Selection copied.');
    } catch {
      setStatus('The browser did not allow clipboard access.');
    }
    if (menuIdRef.current === menuId) closeMenu(true);
  }

  // SuperDocEditor renders its toolbar beside the editor container. Only
  // events from inside the editor open the document menu; the toolbar and any
  // other application chrome keep their own context behaviour.
  function isInsideEditor(target: EventTarget | null) {
    return target instanceof Element && target.closest('.superdoc-editor-container') !== null;
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!isInsideEditor(event.target)) return;
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY });
  }

  function handleContextMenuKey(event: ReactKeyboardEvent<HTMLElement>) {
    const requested = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!requested || !ui || !isInsideEditor(event.target)) return;

    const anchor = ui.selection.getAnchorRect({ placement: 'center' });
    if (!anchor) return;

    event.preventDefault();
    openMenu({ x: (anchor.left + anchor.right) / 2, y: (anchor.top + anchor.bottom) / 2 });
  }

  function handleMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      closeMenu(event.key === 'Escape');
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    items[(current + direction + items.length) % items.length]?.focus();
  }

  return (
    <>
      <section onContextMenu={handleContextMenu} onKeyDownCapture={handleContextMenuKey}>
        <SuperDocEditor
          document='/contract.docx'
          documentMode='suggesting'
          onContentError={({ error }) => console.error('SuperDoc could not open the document.', error)}
          onException={({ error }) => console.error('SuperDoc could not open the document.', error)}
          onReady={({ superdoc }) => {
            superdocRef.current = superdoc;
            setSuperDoc(superdoc);
          }}
          ui={editorUi}
        />
      </section>

      {menu && (
        <div
          aria-label='Document actions'
          onKeyDown={handleMenuKey}
          ref={menuRef}
          role='menu'
          style={{ left: menu.x, position: 'fixed', top: menu.y, zIndex: 10 }}
          tabIndex={-1}
        >
          <button
            disabled={!menu.changeTarget || decisionPending}
            onClick={() => void decideChange('accept')}
            role='menuitem'
            type='button'
          >
            Accept change
          </button>
          <button
            disabled={!menu.changeTarget || decisionPending}
            onClick={() => void decideChange('reject')}
            role='menuitem'
            type='button'
          >
            Reject change
          </button>
          <button disabled={!selectedText} onClick={() => void copySelection()} role='menuitem' type='button'>
            Copy selected text
          </button>
        </div>
      )}

      <p aria-live='polite' role='status'>
        {status}
      </p>
    </>
  );
}
