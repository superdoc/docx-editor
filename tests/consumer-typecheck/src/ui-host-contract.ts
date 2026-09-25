/**
 * Consumer typecheck: the structural host contract accepts the real class.
 *
 * `SuperDocLike` / `SuperDocEditorLike` are duck-typed stand-ins the controller
 * reads through, so nothing inside the package forces them to stay compatible
 * with the concrete `SuperDoc`. This pins that they do, from a consumer's
 * position and against the published declarations.
 *
 * The event members are the fragile part. They are declared with handlers typed
 * `(...args: unknown[]) => void` while `SuperDoc` implements event-specific
 * tuple callbacks, so this is what proves the two still line up under
 * `strict` (which includes `strictFunctionTypes`) and `skipLibCheck: false`.
 * Widening them back to `any[]` would pass here but reintroduce an any-leak the
 * deep-type audit rejects; narrowing them to `never[]` fails outright. This
 * file is the guard on that middle ground.
 */
import { SuperDoc } from 'superdoc';
import { createSuperDocUI } from 'superdoc/ui';
import type { SuperDocLike, SuperDocEditorLike, SuperDocUI, ViewportEntityHit } from 'superdoc/ui';
// `superdoc/ui` is a named-exports-only facade, so a type declared in
// `ui/types.ts` is not importable until it is listed in `public/ui.ts` too.
// These three annotate the doc facade on both sides of the contract, so a
// consumer must be able to name them; adding one without the facade entry fails
// here with TS2305 rather than silently shipping an unreferenceable annotation.
import type { BrowserDocumentApi, DocumentApi, PartialBrowserDocumentApi } from 'superdoc/ui';

const instance = new SuperDoc({ selector: '#editor' });

// A real instance satisfies the host contract by assignment.
const asHost: SuperDocLike = instance;
void asHost;

// And where it actually matters: handed to the factory that takes the contract.
const built: SuperDocUI = createSuperDocUI({ superdoc: instance });
void built;

// Entity hit kinds are extensible because integrations may add their own
// painted entities alongside SuperDoc's built-in kinds.
const customEntityHit: ViewportEntityHit = { type: 'integrationEntity', id: 'custom-1' };
void customEntityHit;
const textboxControlHit: ViewportEntityHit = {
  type: 'contentControl',
  id: '7',
  story: { kind: 'story', storyType: 'textbox', textboxId: 'tb-1' },
};
void textboxControlHit;

// The active editor satisfies the editor-shaped contract the same way.
declare const activeEditor: NonNullable<typeof instance.activeEditor>;
const asEditor: SuperDocEditorLike = activeEditor;
void asEditor;

// A narrow, event-specific callback still typechecks on the concrete class.
instance.on('ready', (payload) => void payload);

// The browser doc facade is nameable, and a full one satisfies the host field.
declare const browserDoc: BrowserDocumentApi;
const editorDoc: SuperDocEditorLike['doc'] = browserDoc;
void editorDoc;

// A duck-typed host carries only the operations it implements. This is the
// documented contract for `SuperDocEditorLike`, and requiring the whole facade
// here would reject the adapters and test stubs it exists to accept.
createSuperDocUI({ superdoc: { activeEditor: { doc: { getText: () => 'hi' } } } });
createSuperDocUI({ superdoc: { activeEditor: { doc: {} } } });

// Partial, not permissive: a declared operation is still shape-checked. Both
// lines below must stay errors, so they are asserted via `@ts-expect-error`
// rather than omitted — deleting the guard would otherwise look like a pass.
// @ts-expect-error `list` must be callable, not a number.
createSuperDocUI({ superdoc: { activeEditor: { doc: { comments: { list: 42 } } } } });
// @ts-expect-error `getTxt` is not an operation on the facade.
createSuperDocUI({ superdoc: { activeEditor: { doc: { getTxt: () => 'x' } } } });

// What a custom command receives as `doc` is the host's own object, so it can
// promise no more than the host contract does. Typing it as the complete facade
// would hand a consumer 50-odd operations a partial host never defines.
built.commands.register({
  id: 'host-contract-doc-shape',
  getState: () => ({ enabled: true, disabled: false, active: false, supported: true }),
  execute: (context) => {
    const partial: PartialBrowserDocumentApi | null = context.doc;
    // @ts-expect-error `doc` is not the complete facade; guard before calling.
    const complete: BrowserDocumentApi | null = context.doc;

    // The borrowed contract has to hold on this path too. A command registered
    // through `superdoc.ui.commands.register(...)` runs against the
    // instance-owned singleton, so an owned `context.ui` would let a callback
    // destroy the controller the built-in toolbar is reading.
    const borrowedFromContext: PartialBrowserDocumentApi | null = context.doc;
    void borrowedFromContext;
    // @ts-expect-error `context.ui` is borrowed; only the owner may destroy.
    context.ui.destroy();

    // Parts of the Document API are callable *and* carry properties:
    // `capabilities` is a function with a `get()` alias. A partial type that
    // rebuilt only the call signature would reject this on a value that
    // supports it, so both forms have to stay reachable.
    void context.doc?.capabilities?.();
    void context.doc?.capabilities?.get?.();

    void [partial, complete];
    return true as never;
  },
});

// Its synchronous SDK counterpart is nameable from the same subpath.
declare const syncDoc: DocumentApi;
void syncDoc;
