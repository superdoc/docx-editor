import type { CSSProperties, ReactNode } from 'react';
import type { SuperDoc } from 'superdoc';

/**
 * Types for @superdoc/react
 *
 * Core types are extracted from the SuperDoc constructor parameter type,
 * ensuring they stay in sync with the superdoc package.
 */

// =============================================================================
// Extract types from SuperDoc constructor (single source of truth)
// =============================================================================

/** SuperDoc constructor config - extracted from superdoc package */
type SuperDocConstructorConfig = ConstructorParameters<typeof SuperDoc>[0];

/** SuperDoc instance type - from superdoc package */
export type SuperDocInstance = InstanceType<typeof SuperDoc>;

type SuperDocActiveEditor = NonNullable<SuperDocInstance['activeEditor']>;
type SuperDocActiveEditorDoc = SuperDocActiveEditor extends { doc?: infer T } ? T : never;

/** Document mode - extracted from Config.documentMode */
export type DocumentMode = NonNullable<SuperDocConstructorConfig['documentMode']>;

/** User role - extracted from Config.role */
export type UserRole = NonNullable<SuperDocConstructorConfig['role']>;

/** User object - extracted from Config.user */
export type SuperDocUser = NonNullable<SuperDocConstructorConfig['user']>;

/** Modules configuration - extracted from Config.modules */
export type SuperDocModules = NonNullable<SuperDocConstructorConfig['modules']>;

/** Full SuperDoc config - extracted from constructor */
export type SuperDocConfig = SuperDocConstructorConfig;

// =============================================================================
// Callback Event Types
// =============================================================================

/**
 * Runtime editor facade reported by `superdoc@2` callback events.
 *
 * v2 no longer exposes the v1 ProseMirror/Tiptap `Editor` type. Consumers that
 * need document operations should use the SuperDoc instance and Document API;
 * callback editor values are intentionally structural runtime evidence.
 */
export interface SuperDocRuntimeEditor {
  editorVersion?: 2;
  /**
   * The public, read-only-guarded browser Document API facade for the active
   * editor in inline v2 mode (`editor.doc`). Derived from the `superdoc`
   * instance type so this wrapper does not need its own Document API package
   * dependency.
   */
  doc?: SuperDocActiveEditorDoc;
  [key: string]: unknown;
}

/** Transaction-like payload emitted by the runtime. v2 does not expose a ProseMirror transaction type. */
export type SuperDocRuntimeTransaction = unknown;

/** Event passed to onReady callback */
export type SuperDocReadyEvent = Parameters<NonNullable<SuperDocConfig['onReady']>>[0];

/** Event passed to onEditorCreate callback */
export type SuperDocEditorCreateEvent = Parameters<NonNullable<SuperDocConfig['onEditorCreate']>>[0];

/** Surface where an editor event originated. */
export type EditorSurface = 'body' | 'header' | 'footer';

/** Event passed to onEditorUpdate callback. Mirrors superdoc's EditorUpdateEvent. */
export type SuperDocEditorUpdateEvent = Parameters<NonNullable<SuperDocConfig['onEditorUpdate']>>[0];

/** Event passed to onTransaction callback. Mirrors superdoc's EditorTransactionEvent. */
export type SuperDocTransactionEvent = Parameters<NonNullable<SuperDocConfig['onTransaction']>>[0];

/**
 * Event passed to onContentError callback. Re-derived from the core
 * `SuperDocConfig['onContentError']` parameter so the React wrapper
 * cannot drift from the core contract: any widening or tightening
 * upstream surfaces here automatically.
 */
export type SuperDocContentErrorEvent = Parameters<NonNullable<SuperDocConfig['onContentError']>>[0];

/**
 * Event passed to onException callback. Re-exports the core union so
 * the React wrapper matches what consumers receive when SuperDoc emits
 * an `exception` event. The union has three runtime shapes (store init,
 * restore failure, editor lifecycle); narrow with `'stage' in event`
 * or `'code' in event` to access shape-specific fields.
 */
export type SuperDocExceptionEvent = import('superdoc').SuperDocExceptionPayload;

/**
 * Event passed to onZoomChange callback. Re-derived from the core
 * `Config.onZoomChange` parameter so the React wrapper cannot drift
 * from the core contract.
 */
export type SuperDocZoomChangeEvent = Parameters<NonNullable<SuperDocConfig['onZoomChange']>>[0];

/**
 * Event passed to onViewportChange callback. Re-derived from the core
 * `Config.onViewportChange` parameter so the React wrapper cannot
 * drift from the core contract.
 */
export type SuperDocViewportChangeEvent = Parameters<NonNullable<SuperDocConfig['onViewportChange']>>[0];

/** Event passed to onPageMarginsChange callback. */
export type SuperDocPageMarginsChangeEvent = Parameters<NonNullable<SuperDocConfig['onPageMarginsChange']>>[0];

// =============================================================================
// React Component Types
// =============================================================================

/**
 * Props managed internally by the React component (not exposed to users).
 * - selector: managed by component (creates internal container)
 */
type InternalProps = 'selector';

/**
 * Props that are required in core but should be optional in React.
 * - documentMode: defaults to 'editing' if not provided
 */
type OptionalInReact = 'documentMode';

/**
 * Callback props that are explicitly typed in CallbackProps.
 * These are excluded from SuperDocConfig to avoid type conflicts.
 */
type ExplicitCallbackProps =
  | 'onReady'
  | 'onEditorCreate'
  | 'onEditorDestroy'
  | 'onEditorUpdate'
  | 'onTransaction'
  | 'onContentError'
  | 'onException'
  | 'onZoomChange'
  | 'onViewportChange'
  | 'onPageMarginsChange';

// V2 branch: there is no `editorVersion` / `editorIntegration` React prop.
// `@superdoc/react` wraps `superdoc@2`, which always runs the DOCX Engine
// editor. Customer runtime selection was removed, so these props no longer
// exist on the public component surface.

/**
 * Explicitly typed callback props to ensure proper TypeScript inference.
 * These override any loosely-typed callbacks from SuperDocConfig.
 */
export interface CallbackProps {
  /** Callback when SuperDoc is ready */
  onReady?: (event: SuperDocReadyEvent) => void;

  /** Callback after an editor is created */
  onEditorCreate?: (event: SuperDocEditorCreateEvent) => void;

  /** Callback when editor is destroyed */
  onEditorDestroy?: () => void;

  /** Callback when document content is updated */
  onEditorUpdate?: (event: SuperDocEditorUpdateEvent) => void;

  /** Callback when a transaction is emitted */
  onTransaction?: (event: SuperDocTransactionEvent) => void;

  /** Callback when there is a content parsing error */
  onContentError?: (event: SuperDocContentErrorEvent) => void;

  /** Callback when an exception is thrown */
  onException?: (event: SuperDocExceptionEvent) => void;

  /**
   * Callback when the zoom level changes (setZoom, toolbar, or fit-width mode)
   * @deprecated replaceWith=`superdoc.ui.zoom.observe` removeIn=v3.0
   */
  onZoomChange?: (event: SuperDocZoomChangeEvent) => void;

  /** Callback when the implied fit changes (rounded fit zoom or base page width); see the core viewport-change event */
  onViewportChange?: (event: SuperDocViewportChangeEvent) => void;

  /** Callback after a ruler drag changes the active section's left or right page margin. */
  onPageMarginsChange?: (event: SuperDocPageMarginsChangeEvent) => void;
}

/**
 * React-specific props added on top of SuperDocConfig.
 */
interface ReactProps {
  /** Optional ID for the editor container. Auto-generated if not provided. */
  id?: string;

  /**
   * Render application-owned content while the Editor opens. When omitted,
   * SuperDoc shows its built-in loading overlay unless `ui.loading` is false.
   */
  renderLoading?: () => ReactNode;

  /**
   * Hide the toolbar container. When true, no toolbar is rendered.
   *
   * Prefer `ui.toolbar: false`, which says this in the core configuration and
   * applies to every framework. `ui: false` also hides the toolbar, but it
   * turns off every built-in surface — comments, context menu, and the rest —
   * so reach for it only when the application owns the whole interface.
   *
   * This prop is the older spelling and still wins when set. @default false
   */
  hideToolbar?: boolean;

  /** Enable contained mode for fixed-height container embedding. When true, SuperDoc
   *  fits within its parent's height and scrolls internally. @default false */
  contained?: boolean;

  /** Additional CSS class name for the wrapper element */
  className?: string;

  /** Additional inline styles for the wrapper element */
  style?: CSSProperties;
}

/**
 * Props for SuperDocEditor component.
 *
 * Extends SuperDocConfig (minus internal props) with React-specific additions.
 * When new props are added to SuperDoc core, they're automatically available here.
 *
 * Callback props are explicitly typed to ensure proper TypeScript inference.
 */
export interface SuperDocEditorProps
  extends
    Omit<SuperDocConfig, InternalProps | OptionalInReact | ExplicitCallbackProps>,
    Partial<Pick<SuperDocConfig, OptionalInReact>>,
    CallbackProps,
    ReactProps {}

/**
 * Ref interface for SuperDocEditor component
 */
export interface SuperDocRef {
  /** Get the underlying SuperDoc instance. Returns null if not yet initialized. */
  getInstance(): SuperDocInstance | null;
}
