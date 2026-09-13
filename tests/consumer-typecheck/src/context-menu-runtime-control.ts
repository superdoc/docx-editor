import type {
  Config,
  ContextMenuConfig,
  ContextMenuContext,
  ContextMenuItem,
  ContextMenuOpenContext,
  ContextMenuResolvedItem,
  ContextMenuResolvedSection,
  ContextMenuSection,
  ContextMenuSelectContext,
  DocumentMode,
  Modules,
  SuperDoc,
} from 'superdoc';
import type { ContextMenuHandle, ViewportContext, WorkflowActionResult } from 'superdoc/ui';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

const sections = [
  {
    id: 'application-actions',
    items: [
      {
        id: 'send-selection',
        label: 'Send selection',
        showWhen: (context: ContextMenuOpenContext) => {
          const _mode: DocumentMode = context.documentMode;
          const _canAccept: boolean = context.canAcceptTrackedChange;
          const _canReject: boolean = context.canRejectTrackedChange;

          // The v2 menu never supplies these ProseMirror-era fields.
          // @ts-expect-error ContextMenuOpenContext has no editor handle.
          void context.editor;
          // @ts-expect-error ContextMenuOpenContext has no ProseMirror position.
          void context.selectionStart;

          return context.hasSelection && context.isEditable;
        },
        enabledWhen: (context: ContextMenuOpenContext) => context.documentMode !== 'viewing',
        onSelect: ({ context, document }) => {
          const _context: ContextMenuSelectContext | null = context;
          if (context) {
            const _singleCell: boolean = context.isSingleCellSelected;
            const _selectedText: Promise<string> = context.selectedTextSettled;
            void [_singleCell, _selectedText];
          }
          if (document.available) {
            void document.doc;
            void document.readiness.whenPainted();
          }
          void _context;
        },
      },
    ],
  },
] as const satisfies readonly ContextMenuSection[];

const contextMenuConfig = {
  openOnSlash: false,
  defaultItems: false,
  sections,
  menuProvider: (context, resolvedSections) => {
    const _context: ContextMenuOpenContext = context;
    const _sections: readonly ContextMenuResolvedSection[] = resolvedSections;
    const _item: ContextMenuResolvedItem | undefined = resolvedSections[0]?.items[0];
    if (_item) {
      const _disabled: boolean = _item.disabled;
      void _disabled;
    }
    void [_context, _sections];
    return resolvedSections;
  },
} as const satisfies ContextMenuConfig;

const deprecatedItem = {
  id: 'legacy-action',
  label: 'Legacy action',
  component: {},
  action: () => undefined,
  render: () => document.createElement('div'),
} satisfies ContextMenuItem;

const deprecatedContextMenuConfig = {
  customItems: [{ id: 'application-actions', items: [deprecatedItem] }],
  includeDefaultItems: false,
} satisfies ContextMenuConfig;

const config = {
  selector: '#editor',
  ui: { contextMenu: contextMenuConfig },
  modules: {
    contextMenu: deprecatedContextMenuConfig,
    slashMenu: { openOnSlash: false, sections },
  },
  disableContextMenu: false,
} satisfies Config;

type DeprecatedSlashMenuConfig = Exclude<Modules['slashMenu'], undefined>;
const _slashMenuConfig: AssertEqual<DeprecatedSlashMenuConfig, ContextMenuConfig> = true;

// The legacy callback context stays exported for source compatibility.
declare const deprecatedContext: ContextMenuContext;
void deprecatedContext.editor;

declare const superdoc: SuperDoc;

const contextMenu: ContextMenuHandle = superdoc.ui.contextMenu;
const _openResult: AssertEqual<ReturnType<ContextMenuHandle['open']>, WorkflowActionResult> = true;
const _closeResult: AssertEqual<ReturnType<ContextMenuHandle['close']>, void> = true;
const _pointContext: AssertEqual<ReturnType<ContextMenuHandle['contextAt']>, ViewportContext> = true;
const _pointParams: AssertEqual<Parameters<ContextMenuHandle['contextAt']>, [{ x: number; y: number }]> = true;

void contextMenu.open();
contextMenu.close();
const contextAtPoint = contextMenu.contextAt({ x: 24, y: 48 });
const _contextPoint: { x: number; y: number } | undefined = contextAtPoint.point;
const _contextEntities: readonly { type: string; id: string }[] = contextAtPoint.entities;
void [
  config,
  contextMenuConfig,
  deprecatedContextMenuConfig,
  _openResult,
  _closeResult,
  _pointContext,
  _pointParams,
  _contextPoint,
  _contextEntities,
  _slashMenuConfig,
];
