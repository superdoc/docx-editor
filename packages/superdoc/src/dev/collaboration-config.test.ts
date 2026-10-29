import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, test } from 'vite-plus/test';
import {
  createDevCollaborationAutoUrl,
  createDevDocumentConfig,
  createDevV2CollaborationConfig,
  resolveDevCollaborationProvider,
  resolveDevCollaborationRoomMode,
  resolveDevCollaborationServerUrl,
} from './collaboration-config';

describe('dev v2 collaboration config', () => {
  test('treats the bare collab URL as an auto room open', () => {
    expect(resolveDevCollaborationRoomMode(null)).toBe('auto');
  });

  test('accepts explicit room intents and rejects ambiguous values', () => {
    expect(resolveDevCollaborationRoomMode('auto')).toBe('auto');
    expect(resolveDevCollaborationRoomMode('create')).toBe('create');
    expect(resolveDevCollaborationRoomMode('join')).toBe('join');
    expect(() => resolveDevCollaborationRoomMode('open-or-create')).toThrow('Expected "auto", "create", or "join"');
  });

  test('allows an isolated collaboration server URL while preserving the default', () => {
    expect(resolveDevCollaborationServerUrl(null)).toBe('ws://localhost:8081/v2/collaboration');
    expect(resolveDevCollaborationServerUrl('ws://127.0.0.1:8181/v2/collaboration')).toBe(
      'ws://127.0.0.1:8181/v2/collaboration',
    );
  });

  test('promotes a successful creator URL back to auto mode for reloads', () => {
    expect(createDevCollaborationAutoUrl('http://localhost:9094/?collab=1&room=room-1&collabRoomMode=create')).toBe(
      'http://localhost:9094/?collab=1&room=room-1',
    );
  });

  test('puts the provider target on document.v2Collaboration', () => {
    const v2Collaboration = createDevV2CollaborationConfig({
      enabled: true,
      serverUrl: 'ws://localhost:8081/v2/collaboration',
      documentId: 'room-1',
      roomMode: 'create',
      userId: 'dev-user',
    });
    const source = new Blob(['docx']);

    expect(createDevDocumentConfig({ source, id: 'document-123', v2Collaboration })).toEqual({
      data: source,
      id: 'document-123',
      v2Collaboration: {
        providerType: 'y-websocket',
        serverUrl: 'ws://localhost:8081/v2/collaboration',
        documentId: 'room-1',
        roomMode: 'create',
        params: { userId: 'dev-user' },
      },
    });
  });

  test('selects the provider from the URL and rejects unknown ones', () => {
    expect(resolveDevCollaborationProvider(null)).toBe('y-websocket');
    expect(resolveDevCollaborationProvider('liveblocks')).toBe('liveblocks');
    expect(() => resolveDevCollaborationProvider('hocuspocus')).toThrow('Expected "y-websocket" or "liveblocks"');
  });

  test('targets the local Liveblocks dev server with its public key', () => {
    expect(
      createDevV2CollaborationConfig({
        enabled: true,
        provider: 'liveblocks',
        serverUrl: 'ws://localhost:8081/v2/collaboration',
        documentId: 'room-1',
        roomMode: 'join',
        userId: 'dev-user',
      }),
    ).toEqual({
      providerType: 'liveblocks',
      baseUrl: 'http://localhost:1153',
      publicApiKey: 'pk_localdev',
      documentId: 'room-1',
      roomMode: 'join',
    });
  });

  test('does not create a legacy collaboration config when collaboration is disabled', () => {
    expect(
      createDevV2CollaborationConfig({
        enabled: false,
        serverUrl: 'ws://localhost:8081/v2/collaboration',
        documentId: 'room-1',
        roomMode: null,
      }),
    ).toBeNull();
  });

  test('keeps the auto room policy out of runtime collaboration config', () => {
    expect(() =>
      createDevV2CollaborationConfig({
        enabled: true,
        serverUrl: 'ws://localhost:8081/v2/collaboration',
        documentId: 'room-1',
        roomMode: 'auto' as never,
      }),
    ).toThrow('requires an explicit create or join room mode');
  });

  test('keeps provider ownership in the v2 runtime', () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const devAppSource = readFileSync(resolve(testDirectory, 'components/SuperdocDev.vue'), 'utf8');

    expect(devAppSource).toContain('createDevV2CollaborationConfig');
    expect(devAppSource).toContain('createDevDocumentConfig');
    expect(devAppSource).not.toContain("from 'y-websocket'");
    expect(devAppSource).not.toContain("from 'yjs'");
    expect(devAppSource).not.toContain('modules.collaboration');
    expect(devAppSource).not.toContain('new EventSource');
    expect(devAppSource).not.toContain('legacyCollab');
  });

  test('keeps dev collaboration vite wiring v2-only', () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const packageRoot = resolve(testDirectory, '../..');

    for (const configFile of ['vite.config.js', 'vite.config.devapp.js']) {
      const configSource = readFileSync(resolve(packageRoot, configFile), 'utf8');
      expect(configSource).not.toContain('y-prosemirror');
      expect(configSource).not.toContain('prosemirror-');
      const syntax = ts.createSourceFile(configFile, configSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const dedupeLists: string[][] = [];
      const visit = (node: ts.Node) => {
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText(syntax) === 'dedupe' &&
          ts.isArrayLiteralExpression(node.initializer)
        ) {
          dedupeLists.push(node.initializer.elements.filter(ts.isStringLiteralLike).map((element) => element.text));
        }
        ts.forEachChild(node, visit);
      };
      visit(syntax);
      expect(dedupeLists).toEqual([expect.arrayContaining(['yjs'])]);
    }
  });
});
