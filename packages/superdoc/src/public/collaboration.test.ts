import { describe, expect, it } from 'vite-plus/test';
import * as publicApi from './collaboration.js';

describe('public collaboration room names', () => {
  it('lets hosts resolve the persisted provider key through the public API', () => {
    const resolveRoomName: unknown = Reflect.get(publicApi, 'resolveCollaborationRoomName');
    expect(resolveRoomName).toBeTypeOf('function');
    if (typeof resolveRoomName !== 'function') throw new Error('Public collaboration resolver is missing');
    expect(resolveRoomName('doc-42')).toBe('sd2/v2.1/doc-42');
    expect(resolveRoomName('other-doc')).toBe('sd2/v2.1/other-doc');
  });
});
