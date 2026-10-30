import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createFakeV2Runtime } from './editor-runtime/conformance/fake-v2-runtime.js';
import type { EditorRuntime, EditorRuntimeUser } from './editor-runtime/index.js';
import type { Config, RuntimeDocument, User } from './types/index.js';

vi.mock('./v2-integration/v2-integration.js', () => ({
  loadDefaultV2IntegrationOrFallback: () => new Promise(() => {}),
}));

const { SuperDoc } = await import('./SuperDoc.js');
type SuperDocInstance = InstanceType<typeof SuperDoc>;

interface Harness {
  registerEditorRuntime(runtime: EditorRuntime): void;
  superdocStore?: { documents: RuntimeDocument[]; user: User };
}

const instances: SuperDocInstance[] = [];

function mountReady(config: Partial<Config> = {}) {
  const selector = document.createElement('div');
  document.body.append(selector);
  const instance = new SuperDoc({ selector, telemetry: { enabled: false }, ...config });
  instances.push(instance);
  const harness = instance as unknown as Harness;
  const storeUser = { ...(instance.config.user as User) };
  harness.superdocStore = { documents: [], user: storeUser };
  const runtime = createFakeV2Runtime({ id: 'doc-runtime', documentId: 'doc', initialDocumentMode: 'editing' });
  const setUser = vi.fn<(user: EditorRuntimeUser) => Promise<void>>(async () => {});
  runtime.setUser = setUser;
  harness.registerEditorRuntime(runtime);
  return { instance, setUser, storeUser };
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SuperDoc.setUser', () => {
  it('switches every open document and replaces the stored user in place, clearing omitted fields', async () => {
    const { instance, setUser, storeUser } = mountReady({
      user: { name: 'Jordan Lee', email: 'jordan@example.com', image: 'jordan.png' },
    });
    const configUser = instance.config.user;

    await instance.setUser({ name: 'Sam Ortiz', id: 'sam' });

    expect(setUser).toHaveBeenCalledWith({ name: 'Sam Ortiz', id: 'sam' });
    expect(instance.config.user).toBe(configUser);
    expect(instance.user).toBe(configUser);
    expect(instance.config.user).toMatchObject({ name: 'Sam Ortiz', id: 'sam' });
    expect(instance.config.user?.email ?? null).toBeNull();
    expect(instance.config.user?.image).toBeUndefined();
    expect(instance.config.user?.color).toEqual(expect.any(String));
    expect(storeUser).toMatchObject({ name: 'Sam Ortiz', id: 'sam' });
    expect(storeUser.image).toBeUndefined();
  });

  it('rejects a blank name without changing anything', async () => {
    const { instance, setUser } = mountReady({ user: { name: 'Jordan Lee' } });
    await expect(instance.setUser({ name: '   ' })).rejects.toThrow(TypeError);
    expect(setUser).not.toHaveBeenCalled();
    expect(instance.config.user?.name).toBe('Jordan Lee');
  });

  it('does nothing when the user is unchanged', async () => {
    const { instance, setUser } = mountReady({ user: { name: 'Jordan Lee', email: 'jordan@example.com' } });
    await instance.setUser({ name: 'Jordan Lee', email: 'jordan@example.com' });
    expect(setUser).not.toHaveBeenCalled();
  });

  it('keeps the previous user everywhere when one document fails to switch', async () => {
    const { instance, setUser } = mountReady({ user: { name: 'Jordan Lee' } });
    const other = createFakeV2Runtime({ id: 'other-runtime', documentId: 'other', initialDocumentMode: 'editing' });
    other.setUser = vi.fn(async () => {
      throw new Error('worker closed');
    });
    (instance as unknown as Harness).registerEditorRuntime(other);

    await expect(instance.setUser({ name: 'Sam Ortiz' })).rejects.toThrow('worker closed');
    expect(instance.config.user?.name).toBe('Jordan Lee');
    expect(setUser.mock.calls.map(([user]) => user.name)).toEqual(['Sam Ortiz', 'Jordan Lee']);
  });

  it('applies overlapping switches in order, so the latest user wins', async () => {
    const { instance, setUser } = mountReady({ user: { name: 'Jordan Lee' } });
    let release!: () => void;
    setUser.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const toSam = instance.setUser({ name: 'Sam Ortiz' });
    const backToJordan = instance.setUser({ name: 'Jordan Lee' });
    await Promise.resolve();
    release();
    await Promise.all([toSam, backToJordan]);
    expect(instance.config.user?.name).toBe('Jordan Lee');
    expect(setUser.mock.calls.map(([user]) => user.name)).toEqual(['Sam Ortiz', 'Jordan Lee']);
  });
});
