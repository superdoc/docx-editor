# @superdoc-dev/react

React wrapper for SuperDoc.

## Files

| File | Purpose |
|------|---------|
| `src/SuperDocEditor.tsx` | Main component |
| `src/types.ts` | TypeScript types (extracted from superdoc) |
| `src/utils.ts` | ID generation |
| `src/index.ts` | Public exports |

## Type System

Types are extracted from `superdoc` constructor to avoid duplication:

```typescript
type SuperDocConstructorConfig = ConstructorParameters<typeof SuperDoc>[0];

export type DocumentMode = NonNullable<SuperDocConstructorConfig['documentMode']>;
export type UserRole = NonNullable<SuperDocConstructorConfig['role']>;
export type SuperDocUser = NonNullable<SuperDocConstructorConfig['user']>;
export type SuperDocModules = NonNullable<SuperDocConstructorConfig['modules']>;
export type SuperDocConfig = SuperDocConstructorConfig;
export type SuperDocInstance = InstanceType<typeof SuperDoc>;

// Props = SuperDocConfig (minus internal) + React-specific
type InternalProps = 'selector';  // managed by component
type OptionalInReact = 'documentMode';  // defaults to 'editing'

export interface SuperDocEditorProps
  extends Omit<SuperDocConfig, InternalProps | OptionalInReact>,
    Partial<Pick<SuperDocConfig, OptionalInReact>>,
    ReactProps {}
```

## React-Specific Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | auto-generated | Custom container ID |
| `renderLoading` | `() => ReactNode` | - | Loading UI during init |
| `hideToolbar` | `boolean` | `false` | Hide the toolbar |
| `className` | `string` | - | Wrapper CSS class |
| `style` | `CSSProperties` | - | Wrapper inline styles |

## Fixed-height container embedding

Pass `contained` to scroll inside a fixed-height parent. The wrapper must have a definite height.

```tsx
<div style={{ height: 500 }}>
  <SuperDocEditor
    document={file}
    documentMode="viewing"
    contained
    style={{ height: '100%' }}
  />
</div>
```

## SSR Behavior

- Container divs are always rendered and remain measurable while loading
- No `isClient` state or extra rerender — containers exist from first render
- SuperDoc initializes in `useEffect` (client-side only) and mounts into the existing containers
- `renderLoading()` shown alongside hidden containers until initialization completes

## Ref API

```typescript
const editorRef = useRef<SuperDocRef>(null);

// Access SuperDoc instance
const instance = editorRef.current?.getInstance();

// Call methods
instance?.setDocumentMode('viewing');
instance?.export({ triggerDownload: true });
instance?.getHTML();
```

## Props That Trigger Rebuild

These props cause the SuperDoc instance to be destroyed and recreated:
- `document` - new document to load
- `user` - user identity changed
- `users` - users list changed
- `modules` - module config changed
- `role` - permission level changed
- `hideToolbar` - toolbar visibility changed

Other props like `documentMode` and callbacks are handled without rebuild.

## Commands

```bash
pnpm --filter @superdoc-dev/react build
pnpm --filter @superdoc-dev/react test
```
