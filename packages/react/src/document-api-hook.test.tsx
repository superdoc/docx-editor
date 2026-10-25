import { describe, it, expect } from 'vite-plus/test';
import { act, render } from '@testing-library/react';
import { startTransition, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  SuperDocUIProvider,
  useSetSuperDoc,
  useSuperDocDocumentApi,
  useSuperDocHost,
  type SuperDocHost,
} from '../../superdoc/dist/public/ui-react.es.js';

type Api = { name: string };

function swappableHost(initial: Api | null, complete = true) {
  const listeners = new Set<() => void>();
  let doc = initial;
  const host = {
    activeEditor: doc ? { doc } : null,
    getDocumentApi: complete ? () => doc : undefined,
    on: (_event: string, handler: () => void) => listeners.add(handler),
    off: (_event: string, handler: () => void) => listeners.delete(handler),
    listeners,
    swap(next: Api | null) {
      doc = next;
      host.activeEditor = next ? { doc: next } : null;
      for (const handler of [...listeners]) handler();
    },
  };
  return host;
}

function renderWithHost(initialHost: ReturnType<typeof swappableHost> | null) {
  const seen: Array<string | null> = [];
  function Bind({ host }: { host: ReturnType<typeof swappableHost> | null }) {
    const setSuperDoc = useSetSuperDoc();
    useLayoutEffect(() => {
      if (host) setSuperDoc(host as unknown as SuperDocHost);
    }, [host, setSuperDoc]);
    return null;
  }
  function Consumer() {
    const doc = useSuperDocDocumentApi() as unknown as Api | null;
    useLayoutEffect(() => {
      seen.push(doc?.name ?? null);
    });
    return null;
  }
  function App() {
    const [host] = useState(initialHost);
    return (
      <SuperDocUIProvider>
        <Bind host={host} />
        <Consumer />
      </SuperDocUIProvider>
    );
  }

  const view = render(<App />);
  return { seen, view };
}

describe('useSuperDocDocumentApi', () => {
  it('is null without a host and follows the active editor as it changes and closes', async () => {
    const { seen } = renderWithHost(null);
    expect(seen.at(-1)).toBeNull();

    const host = swappableHost({ name: 'first' });
    const bound = renderWithHost(host);
    await act(async () => {});
    expect(bound.seen.at(-1)).toBe('first');

    await act(async () => host.swap({ name: 'second' }));
    expect(bound.seen.at(-1)).toBe('second');

    await act(async () => host.swap(null));
    expect(bound.seen.at(-1)).toBeNull();
  });

  it('serves the bound host in every commit, including the one that binds a new host', async () => {
    const first = swappableHost({ name: 'first' });
    const second = swappableHost({ name: 'second' });
    const committed: Array<{ observed: string | null; bound: string | null }> = [];
    let bindHost!: (host: ReturnType<typeof swappableHost>) => void;

    function Bind({ host }: { host: ReturnType<typeof swappableHost> }) {
      const setSuperDoc = useSetSuperDoc();
      useLayoutEffect(() => setSuperDoc(host as unknown as SuperDocHost), [host, setSuperDoc]);
      return null;
    }
    function Consumer() {
      const doc = useSuperDocDocumentApi() as unknown as Api | null;
      const host = useSuperDocHost() as unknown as ReturnType<typeof swappableHost> | null;
      useLayoutEffect(() => {
        committed.push({ observed: doc?.name ?? null, bound: host?.getDocumentApi?.()?.name ?? null });
      });
      return null;
    }
    function App() {
      const [host, setHost] = useState(first);
      bindHost = setHost;
      return (
        <SuperDocUIProvider>
          <Bind host={host} />
          <Consumer />
        </SuperDocUIProvider>
      );
    }

    render(<App />);
    await act(async () => {});
    await act(async () => bindHost(second));
    expect(committed.filter((entry) => entry.observed !== entry.bound)).toEqual([]);
    expect(committed.at(-1)).toEqual({ observed: 'second', bound: 'second' });
  });

  it('is null for a host without getDocumentApi, whose API may be partial', async () => {
    const { seen } = renderWithHost(swappableHost({ name: 'partial' }, false));
    await act(async () => {});
    expect(seen.at(-1)).toBeNull();
  });

  it('stops listening when it unmounts', async () => {
    const host = swappableHost({ name: 'first' });
    const { view } = renderWithHost(host);
    await act(async () => {});
    const listening = host.listeners.size;
    view.unmount();
    expect(host.listeners.size).toBeLessThan(listening);
  });

  it('never commits the previous document API after an editor swap in a transition', async () => {
    const host = swappableHost({ name: 'A' });
    const committed: Array<{ observed: string | null; active: string | null }> = [];
    let tick!: (n: number) => void;

    function Bind() {
      const setSuperDoc = useSetSuperDoc();
      useLayoutEffect(() => setSuperDoc(host as unknown as SuperDocHost), [setSuperDoc]);
      return null;
    }
    function Consumer() {
      const doc = useSuperDocDocumentApi() as unknown as Api | null;
      useLayoutEffect(() => {
        committed.push({ observed: doc?.name ?? null, active: host.getDocumentApi?.()?.name ?? null });
      });
      return null;
    }
    function App() {
      const [n, setN] = useState(0);
      tick = setN;
      return (
        <SuperDocUIProvider>
          <Bind />
          <span>{n}</span>
          <Consumer />
        </SuperDocUIProvider>
      );
    }

    render(<App />);
    await act(async () => {});
    committed.length = 0;
    await act(async () => {
      startTransition(() => host.swap({ name: 'B' }));
      flushSync(() => tick(1));
    });
    expect(committed.filter((entry) => entry.observed !== entry.active)).toEqual([]);
    expect(committed.at(-1)).toEqual({ observed: 'B', active: 'B' });
  });
});
