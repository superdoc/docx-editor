/* @vitest-environment jsdom */
import { closeHistory } from 'prosemirror-history';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import * as xmljs from 'xml-js';
import * as Y from 'yjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initTestEditor, loadTestDataForEditorTests } from '@tests/helpers/helpers.js';
import DocxZipper from '@core/DocxZipper.js';
import { SuperConverter } from '../core/super-converter/SuperConverter.js';
import { Editor } from '../core/Editor.js';
import { clearExecutorRegistry } from './plan-engine/executor-registry.js';
import { registerBuiltInExecutors } from './plan-engine/register-executors.js';
import { bootstrapPartSync } from '../extensions/collaboration/part-sync/bootstrap.js';
import { seedPartsFromEditor } from '../extensions/collaboration/part-sync/seed-parts.js';
import { stableHexHash } from '../core/utilities/hash.js';
import { importedWordIdentity, readPeoplePart } from '../core/super-converter/comment-author-identity.js';
import { registerPartDescriptor } from '../core/parts/registry/part-registry.js';
import { mutateParts } from '../core/parts/index.js';
import { encodeEnvelopeToYjs } from '../extensions/collaboration/part-sync/json-crdt.js';
import { TrackChanges } from '../extensions/track-changes/track-changes.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const P = 'http://schemas.microsoft.com/office/word/2012/wordml';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PEOPLE_REL = 'http://schemas.microsoft.com/office/2011/relationships/people';
const pair = { providerId: 'AD', userId: 'S::synthetic@example.com::opaque' };
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
async function files(editor: Editor, options = {}) {
  const entries = await new DocxZipper().getDocxData(await editor.exportDocx(options), true);
  return Object.fromEntries((entries as { name: string; content: string }[]).map((f) => [f.name, f.content]));
}
function audit(parts: Record<string, string>) {
  const rels = [...parse(parts['word/_rels/document.xml.rels']).getElementsByTagNameNS(R, 'Relationship')];
  const peopleRels = rels.filter((r) => r.getAttribute('Type') === PEOPLE_REL);
  expect(peopleRels).toHaveLength(1);
  expect(new Set(rels.map((r) => r.getAttribute('Id'))).size).toBe(rels.length);
  const path = new URL(peopleRels[0].getAttribute('Target')!, 'https://package/word/document.xml').pathname.slice(1);
  expect(parts[path]).toBeTruthy();
  const overrides = [...parse(parts['[Content_Types].xml']).getElementsByTagNameNS(CT, 'Override')];
  expect(overrides.filter((n) => n.getAttribute('PartName') === `/${path}`)).toHaveLength(1);
  expect(overrides.find((n) => n.getAttribute('PartName') === `/${path}`)?.getAttribute('ContentType')).toBe(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml',
  );
  const people = [...parse(parts[path]).getElementsByTagNameNS(P, 'person')];
  const associations = new Map(
    people.map((person) => {
      const presence = person.getElementsByTagNameNS(P, 'presenceInfo')[0];
      return [
        person.getAttributeNS(P, 'author'),
        presence && {
          providerId: presence.getAttributeNS(P, 'providerId'),
          userId: presence.getAttributeNS(P, 'userId'),
        },
      ];
    }),
  );
  const comments = [...parse(parts['word/comments.xml']).getElementsByTagNameNS(W, 'comment')];
  return { path, people, associations, comments };
}

// Frozen pre-fix capture algorithm: produce the actual polluted legacy input, never a pruned map.
const WORD_NAMESPACE = W;
const scopeFor = (node, parent = {}) => {
  const scope = { ...parent };
  for (const [key, value] of Object.entries(node.attributes || {})) {
    if (key === 'xmlns') scope[''] = value;
    else if (key.startsWith('xmlns:')) scope[key.slice(6)] = value;
  }
  return scope;
};
const isName = (name, local, namespace, scope, attribute = false) => {
  const split = name?.split(':') || [];
  return split.at(-1) === local && (split.length === 2 ? scope[split[0]] : attribute ? '' : scope['']) === namespace;
};
const attribute = (node, local, namespace, scope) =>
  Object.entries(node.attributes || {}).find(([name]) => isName(name, local, namespace, scope, true))?.[1];
const children = (node, local, namespace, scope) =>
  (node.elements || []).filter((child) => isName(child.name, local, namespace, scopeFor(child, scope)));
function walk(node, callback, parent = {}) {
  const scope = scopeFor(node, parent);
  callback(node, scope);
  for (const child of node.elements || []) walk(child, callback, scope);
}
function captureLegacyCommentAuthorSource(convertedXml, comments = []) {
  const names = new Set();
  for (const tree of Object.values(convertedXml)) {
    if (!tree || typeof tree !== 'object') continue;
    walk(tree, (node, scope) => {
      const author = attribute(node, 'author', WORD_NAMESPACE, scope);
      if (author !== undefined) names.add(author);
    });
  }
  const importedComments = new Map();
  const people = readPeoplePart(convertedXml).people;
  walk(convertedXml['word/comments.xml'] || {}, (node, scope) => {
    if (!isName(node.name, 'comment', WORD_NAMESPACE, scope)) return;
    const name = attribute(node, 'author', WORD_NAMESPACE, scope);
    const importedId = attribute(node, 'id', WORD_NAMESPACE, scope);
    const time = new Date(attribute(node, 'date', WORD_NAMESPACE, scope)).getTime();
    const internalId = attribute(node, 'internalId', WORD_NAMESPACE, scope);
    const id =
      internalId ??
      (importedId != null && Number.isFinite(time) ? `imported-${stableHexHash(`${importedId}-${time}`)}` : undefined);
    if (id !== undefined) importedComments.set(String(id), { name, identity: importedWordIdentity(people, name) });
  });
  return {
    names,
    comments: new Map([
      ...importedComments,
      ...comments.map((comment) => [
        String(comment.commentId),
        {
          name: comment.wordAuthorName,
          identity: comment.creatorIdentity && { ...comment.creatorIdentity },
        },
      ]),
    ]),
  };
}

describe('Word comment author identity through public editor.doc', () => {
  let data: Awaited<ReturnType<typeof loadTestDataForEditorTests>>;
  const editors: Editor[] = [];
  const open = (docData = data, identity: any = pair) => {
    const { editor } = initTestEditor({
      content: docData.docx,
      media: docData.media,
      mediaFiles: docData.mediaFiles,
      fonts: docData.fonts,
      useImmediateSetTimeout: false,
      user: { id: 'app-user', name: 'Alex Reviewer', email: 'synthetic@example.com', wordIdentity: identity },
    });
    editors.push(editor);
    return editor;
  };
  const create = (editor: Editor, text = 'Identity root') => {
    const word = editor.state.doc.textContent.trim().split(/\s+/)[0];
    const matches: any = editor.doc.query.match({ select: { type: 'text', pattern: word } });
    const target = matches.items[0].target;
    const receipt = editor.doc.comments.create({ target, text });
    expect(receipt.success).toBe(true);
    return (receipt as any).id;
  };
  beforeAll(async () => {
    data = await loadTestDataForEditorTests('docxbench-comment-reply-001.docx');
    clearExecutorRegistry();
    registerBuiltInExecutors();
  });
  afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy());
  });

  it.each(['hydration', 'committed ingress'])(
    'retains generated root/reply identities on a fresh peer after %s',
    async (mode) => {
      const a = open();
      const b = open();
      const roomA = new Y.Doc();
      const roomB = new Y.Doc();
      a.options.ydoc = roomA;
      b.options.ydoc = roomB;
      let handleA: ReturnType<typeof bootstrapPartSync> | undefined;
      let handleB: ReturnType<typeof bootstrapPartSync> | undefined;
      try {
        if (mode === 'committed ingress') {
          handleA = bootstrapPartSync(a, roomA);
          Y.applyUpdate(roomB, Y.encodeStateAsUpdate(roomA));
          handleB = bootstrapPartSync(b, roomB);
        }
        const root = create(a, 'Fresh peer root');
        expect(a.doc.comments.create({ parentCommentId: root, text: 'Fresh peer reply' }).success).toBe(true);
        const canonical = structuredClone(a.converter.comments);
        audit(await files(a, { comments: canonical })); // A exports before seeding; B has never exported.
        if (mode === 'hydration') {
          handleA = bootstrapPartSync(a, roomA);
          Y.applyUpdate(roomB, Y.encodeStateAsUpdate(roomA));
          handleB = bootstrapPartSync(b, roomB);
        } else {
          mutateParts({
            editor: a,
            source: 'test:publish-generated-comments',
            operations: [
              {
                editor: a,
                partId: 'word/comments.xml' as any,
                operation: 'mutate',
                mutate: ({ part }: any) => {
                  part.elements[0].attributes['xmlns:test'] = 'urn:test';
                },
              },
            ] as any,
          });
          Y.applyUpdate(roomB, Y.encodeStateAsUpdate(roomA));
        }
        const snapshot = JSON.stringify(canonical);
        // Imported caller labels and identities must still not replace source ownership.
        const old = canonical[0];
        const supplied = canonical.map((c: any) =>
          c.commentId === old.commentId ? { ...c, wordAuthorName: 'Caller spoof', creatorIdentity: pair } : c,
        );
        for (let repeat = 0; repeat < 2; repeat++) {
          const result = audit(await files(b, { comments: supplied }));
          for (const text of ['Fresh peer root', 'Fresh peer reply']) {
            const row = result.comments.find((node) => node.textContent!.includes(text))!;
            expect(result.associations.get(row.getAttributeNS(W, 'author'))).toEqual(pair);
          }
          expect(result.comments.find((node) => node.getAttributeNS(W, 'author') === old.wordAuthorName)).toBeTruthy();
          expect(result.associations.has(old.wordAuthorName)).toBe(false);
        }
        expect(JSON.stringify(canonical)).toBe(snapshot);
        expect(roomB.getMap('parts').has('word/people.xml')).toBe(false);
      } finally {
        handleA?.destroy();
        handleB?.destroy();
        roomA.destroy();
        roomB.destroy();
      }
    },
  );

  it.each(['configured', 'explicit'].flatMap((mode) => ['public', 'raw'].map((invocation) => ({ mode, invocation }))))(
    'rejects an invalid $mode tracked-change reply identity before changing document or comments ($invocation)',
    ({ mode, invocation }) => {
      const editor = open();
      const invalidUser = { name: 'Other reviewer', wordIdentity: { providerId: 'vendor', userId: '' } };
      if (mode === 'configured') editor.options.user = invalidUser;
      const before = editor.state.doc.toJSON();
      const comments = structuredClone(editor.converter.comments);
      const events: any[] = [];
      editor.on('commentsUpdate', (event) => events.push(event));
      const input = {
        from: 2,
        to: 2,
        text: 'Inserted ',
        comment: 'Invalid identity reason',
        ...(mode === 'explicit' ? { user: invalidUser } : {}),
      };
      expect(() =>
        invocation === 'public'
          ? editor.commands.insertTrackedChange(input)
          : TrackChanges.config.addCommands().insertTrackedChange(input)({
              editor,
              state: editor.state,
              dispatch: (tr: typeof editor.state.tr) => editor.view.dispatch(tr),
            }),
      ).toThrow(TypeError);
      expect(editor.state.doc.toJSON()).toEqual(before);
      expect(editor.converter.comments).toEqual(comments);
      expect(events).toEqual([]);
    },
  );

  it.each(['configured', 'explicit', 'explicit without identity'])(
    'exports the resolved %s tracked-change reply identity',
    async (mode) => {
      const editor = open();
      const events: any[] = [];
      editor.on('commentsUpdate', (event) => {
        if (event.comment) events.push(event.comment);
      });
      const explicit = {
        id: 'other',
        name: 'Other reviewer',
        email: 'other@example.com',
        ...(mode === 'explicit' ? { wordIdentity: { providerId: 'vendor', userId: 'other-account' } } : {}),
      };
      expect(
        editor.commands.insertTrackedChange({
          from: 2,
          to: 2,
          text: 'Inserted ',
          comment: 'Tracked reason',
          ...(mode === 'configured' ? {} : { user: explicit }),
        }),
      ).toBe(true);
      const reply = events.find((event) => event.commentText === 'Tracked reason');
      expect(reply).toBeTruthy();
      const expected = mode === 'configured' ? pair : mode === 'explicit' ? explicit.wordIdentity : undefined;
      expect(reply.creatorIdentity).toEqual(expected);
      const output = await files(editor, { comments: [...editor.converter.comments, reply] });
      const rows = [...parse(output['word/comments.xml']).getElementsByTagNameNS(W, 'comment')];
      const row = rows.find((node) => node.textContent!.includes('Tracked reason'))!;
      if (expected) expect(audit(output).associations.get(row.getAttributeNS(W, 'author'))).toEqual(expected);
      else expect(output['word/people.xml']).toBeUndefined();
    },
  );
  it.each([
    'healthy',
    'healthy no carrier',
    'missing',
    'invalid',
    'degraded',
    'later envelope',
    'uncorroborated',
    'rejected compound',
    'generated seed',
  ])('initializes a retained legacy cache only from corroborated initial room source: %s', async (mode) => {
    const editor = open();
    const room = new Y.Doc();
    editor.options.ydoc = room;
    const handle = bootstrapPartSync(editor, room);
    try {
      editor.options.user!.name = 'New';
      const ids = [
        { providerId: 'vendor', userId: 'a' },
        { providerId: 'vendor', userId: 'b' },
      ];
      editor.options.user!.wordIdentity = ids[0];
      const a = create(editor, 'Legacy root A');
      editor.options.user!.wordIdentity = ids[1];
      const b = create(editor, 'Legacy root B');
      editor.doc.comments.create({ parentCommentId: a, text: 'Legacy reply B' });
      editor.options.user!.wordIdentity = ids[0];
      editor.doc.comments.create({ parentCommentId: b, text: 'Legacy reply A' });
      const canonical = structuredClone(editor.converter.comments);
      for (let i = 0; i < 2; i++) audit(await files(editor, { comments: canonical }));
      // Actual first-arrival source mutation, with generated people remaining export-only.
      mutateParts({
        editor,
        source: 'test:legacy-arrival',
        operations: [
          {
            editor,
            partId: 'word/people.xml' as any,
            operation: 'create',
            initial: xmljs.xml2js(
              `<p:people xmlns:p="${P}"><p:person p:author="${canonical[0].creatorName}"><p:presenceInfo p:providerId="vendor" p:userId="old-account"/></p:person></p:people>`,
            ),
          },
          {
            editor,
            partId: 'word/_rels/document.xml.rels',
            operation: 'mutate',
            mutate: ({ part }: any) =>
              part.elements[0].elements.push({
                type: 'element',
                name: 'Relationship',
                attributes: { Id: 'legacyPeople', Type: PEOPLE_REL, Target: 'people.xml' },
              }),
          },
        ] as any,
      });
      const old = editor.converter;
      old.commentAuthorSource = captureLegacyCommentAuthorSource(old.convertedXml);
      old.commentAuthorSourcePart = old.convertedXml['word/comments.xml'];
      old.commentAuthorPeopleSource = readPeoplePart(old.convertedXml).tree;
      expect(old.commentAuthorSource.comments.size).toBe(5);
      expect(old.commentAuthorAssignments.size).toBe(2);
      const map = old.commentAuthorSource;
      const assignments = old.commentAuthorAssignments;
      const snapshots = JSON.stringify(canonical);
      editor.options.originalDocxFile = undefined;
      const envelope: any = room.getMap('parts').get('word/comments.xml');
      if (mode === 'healthy no carrier') {
        old.docx = [];
        editor.options.content = undefined;
        // Actual retained B has only its own local rows in this convenience list.
        old.comments = canonical.filter((comment: any) => comment.creatorIdentity?.userId === 'b');
      }
      if (mode === 'uncorroborated' || mode === 'rejected compound') {
        const raw = structuredClone(envelope.data);
        raw.elements[0].elements[0].attributes['w:author'] = 'Unaccepted source name';
        if (mode === 'rejected compound') {
          registerPartDescriptor({
            id: 'word/test-rejected.xml' as any,
            validatePart() {
              throw new Error('synthetic compound rejection');
            },
          });
          const remote = new Y.Doc();
          Y.applyUpdate(remote, Y.encodeStateAsUpdate(room));
          remote.transact(() => {
            remote.getMap('parts').set('word/comments.xml', { ...envelope, v: 2, data: raw });
            remote.getMap('parts').set('word/test-rejected.xml', { v: 1, clientId: remote.clientID, data: {} });
          });
          const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
          try {
            Y.applyUpdate(room, Y.encodeStateAsUpdate(remote));
          } finally {
            failure.mockRestore();
            remote.destroy();
          }
          expect(old.commentAuthorSource).toBe(map);
          expect(old.convertedXml['word/comments.xml'].elements[0].elements[0].attributes['w:author']).not.toBe(
            'Unaccepted source name',
          );
        } else room.getMap('parts').set('word/comments.xml', { ...envelope, data: raw });
      }
      if (mode === 'missing') room.getMap('parts').delete('word/comments.xml');
      if (mode === 'invalid')
        room.getMap('parts').set('word/comments.xml', {
          v: 1,
          clientId: room.clientID,
          data: { elements: [{ type: 'element', name: 'wrong' }] },
        });
      if (mode === 'degraded') room.getMap('meta').set('partsFallbackMode', true);
      if (mode === 'later envelope') room.getMap('parts').set('word/comments.xml', { ...envelope, v: 2 });
      if (mode === 'generated seed')
        room
          .getMap('parts')
          .set('word/comments.xml', { ...envelope, data: structuredClone(old.convertedXml['word/comments.xml']) });
      const roomBefore = JSON.stringify(room.getMap('parts').toJSON());
      // Same descriptor/reference transfer required by actual retained owner installation.
      const candidate = new SuperConverter();
      Object.defineProperties(candidate, Object.getOwnPropertyDescriptors(old));
      (editor as any).converter = candidate;
      expect(candidate.commentAuthorSource).toBe(map);
      expect(candidate.commentAuthorAssignments).toBe(assignments);
      if (mode.startsWith('healthy')) {
        let labels;
        for (let i = 0; i < 2; i++) {
          const result = audit(await files(editor, { comments: canonical }));
          const next = [];
          for (const [text, identity] of [
            ['root A', ids[0]],
            ['root B', ids[1]],
            ['reply A', ids[0]],
            ['reply B', ids[1]],
          ] as const) {
            const row = result.comments.find((node) => node.textContent!.includes(`Legacy ${text}`))!;
            const label = row.getAttributeNS(W, 'author');
            next.push(label);
            expect.soft(result.associations.get(label)).toEqual(identity);
          }
          if (labels) expect(next).toEqual(labels);
          else labels = next;
        }
      } else {
        await expect(files(editor, { comments: canonical })).rejects.toThrow();
        expect(candidate.commentAuthorSource).toBe(map);
        expect(candidate.commentAuthorAssignments).toBe(assignments);
      }
      expect(JSON.stringify(canonical)).toBe(snapshots);
      expect(JSON.stringify(room.getMap('parts').toJSON())).toBe(roomBefore);
      expect([...assignments]).toHaveLength(2);
    } finally {
      handle.destroy();
      room.destroy();
    }
  });

  it.each([
    { root: `p:people xmlns:p="${P}"`, prefix: 'p:' },
    { root: `people xmlns="${P}" xmlns:p="${P}"`, prefix: '' },
    { root: `alt:people xmlns:alt="${P}" xmlns:p="${P}"`, prefix: 'alt:' },
  ])('keeps local roots/replies through early-bootstrap first people arrival: $root', async ({ root, prefix }) => {
    const a = open();
    const b = open();
    const roomA = new Y.Doc();
    const roomB = new Y.Doc();
    a.options.ydoc = roomA;
    b.options.ydoc = roomB;
    const handleA = bootstrapPartSync(a, roomA);
    Y.applyUpdate(roomB, Y.encodeStateAsUpdate(roomA));
    const handleB = bootstrapPartSync(b, roomB);
    const path = 'word/metadata/first-people.xml';
    const old = a.converter.comments[0];
    const body = a.state.doc.textContent;
    const identities = [
      { providerId: 'vendor', userId: 'new-account-a' },
      { providerId: 'vendor', userId: 'new-account-b' },
    ];
    try {
      expect(a.converter.convertedXml[path]).toBeUndefined();
      expect(roomA.getMap('parts').toJSON()[path]).toBeUndefined();
      a.options.user!.name = 'New';
      a.options.user!.wordIdentity = identities[0];
      const one = create(a, 'First arrival root A');
      a.options.user!.wordIdentity = identities[1];
      const two = create(a, 'First arrival root B');
      a.doc.comments.create({ parentCommentId: one, text: 'First arrival reply B' });
      a.options.user!.wordIdentity = identities[0];
      a.doc.comments.create({ parentCommentId: two, text: 'First arrival reply A' });
      const canonical = structuredClone(a.converter.comments);
      const snapshots = JSON.stringify(canonical);
      const check = (output: Record<string, string>, expectedLabels?: string[]) => {
        const result = audit(output);
        expect(result.comments).toHaveLength(5);
        const labels = [];
        for (const [text, identity] of [
          ['root A', identities[0]],
          ['root B', identities[1]],
          ['reply A', identities[0]],
          ['reply B', identities[1]],
        ] as const) {
          const row = result.comments.find((node) => node.textContent!.includes(`First arrival ${text}`))!;
          const label = row.getAttributeNS(W, 'author')!;
          labels.push(label);
          expect.soft(result.associations.get(label), text).toEqual(identity);
        }
        if (expectedLabels) expect(labels).toEqual(expectedLabels);
        return labels;
      };
      let labels: string[] | undefined;
      for (const peer of [a, b])
        for (let repeat = 0; repeat < 2; repeat++) {
          labels = check(await files(peer, { comments: canonical }), labels);
        }
      expect(roomA.getMap('parts').toJSON()[path]).toBeUndefined();
      const raw = `<${root} xmlns:v="urn:vendor"><${prefix}person p:author="${old.creatorName}"><${prefix}presenceInfo p:providerId="vendor" p:userId="old-account"/><v:extra xml:space="preserve">       <v:child/>  </v:extra><v:shadow xmlns:p="urn:shadow"><p:person p:author="ignore"/></v:shadow></${prefix}person><${prefix}person p:author="Late source"><${prefix}presenceInfo p:providerId="vendor" p:userId="late-account"/></${prefix}person></${root.split(' ')[0]}>`;
      mutateParts({
        editor: a,
        source: 'test:first-people',
        operations: [
          {
            editor: a,
            partId: path as any,
            operation: 'create',
            initial: xmljs.xml2js(raw, { captureSpacesBetweenElements: true }),
          },
          {
            editor: a,
            partId: 'word/_rels/document.xml.rels',
            operation: 'mutate',
            mutate: ({ part }: any) =>
              part.elements[0].elements.push({
                type: 'element',
                name: 'Relationship',
                attributes: { Id: 'firstPeople', Type: PEOPLE_REL, Target: 'metadata/first-people.xml' },
              }),
          },
          {
            editor: a,
            partId: '[Content_Types].xml',
            operation: 'mutate',
            mutate: ({ part }: any) =>
              part.elements[0].elements.push({
                type: 'element',
                name: 'Override',
                attributes: {
                  PartName: `/${path}`,
                  ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml',
                },
              }),
          },
        ] as any,
      });
      Y.applyUpdate(roomB, Y.encodeStateAsUpdate(roomA));
      expect(b.converter.convertedXml[path]).toEqual(a.converter.convertedXml[path]);
      const envelopes = [roomA, roomB].map((room) => JSON.stringify(room.getMap('parts').toJSON()));
      for (const [index, peer] of [a, b].entries()) {
        for (let repeat = 0; repeat < 2; repeat++) {
          const output = await files(peer, { comments: canonical });
          check(output, labels);
          expect(
            parse(output[path])
              .getElementsByTagNameNS(P, 'person')[0]
              .isEqualNode(parse(raw).getElementsByTagNameNS(P, 'person')[0]),
          ).toBe(true);
          expect(peer.state.doc.textContent).toBe(body);
        }
        expect(JSON.stringify([roomA, roomB][index].getMap('parts').toJSON())).toBe(envelopes[index]);
      }
      expect(JSON.stringify(canonical)).toBe(snapshots);

      // A committed mixed source tree must not promote our existing generated rows.
      const incoming = {
        ...old,
        elements: undefined,
        commentId: 'genuine-late-source',
        creatorName: 'Late source',
        wordAuthorName: 'Caller spoof',
        creatorIdentity: undefined,
        commentText: 'Genuine late source',
      };
      const currentTree = a.converter.convertedXml['word/comments.xml'];
      mutateParts({
        editor: a,
        source: 'test:mixed-source',
        operations: [
          {
            editor: a,
            partId: 'word/comments.xml',
            operation: 'mutate',
            mutate: ({ part }: any) => {
              part.elements[0].elements.push(
                xmljs.xml2js(
                  `<w:comment xmlns:w="${W}" w:id="77" w:internalId="genuine-late-source" w:author="Late source" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Genuine late source</w:t></w:r></w:p></w:comment>`,
                ).elements[0],
              );
            },
          },
        ] as any,
      });
      expect(a.converter.convertedXml['word/comments.xml']).toBe(currentTree);
      Y.applyUpdate(roomB, Y.encodeStateAsUpdate(roomA));
      for (const peer of [a, b]) {
        const result = audit(await files(peer, { comments: [...canonical, incoming] }));
        expect(
          result.comments
            .find((node) => node.textContent!.includes('Genuine late source'))!
            .getAttributeNS(W, 'author'),
        ).toBe('Late source');
        expect(result.associations.get('Late source')).toEqual({ providerId: 'vendor', userId: 'late-account' });
        for (const text of ['root A', 'root B', 'reply A', 'reply B']) {
          const row = result.comments.find((node) => node.textContent!.includes(`First arrival ${text}`))!;
          expect(result.associations.get(row.getAttributeNS(W, 'author'))).toEqual(
            identities[text.endsWith('A') ? 0 : 1],
          );
        }
      }
    } finally {
      handleA.destroy();
      handleB.destroy();
      roomA.destroy();
      roomB.destroy();
    }
  });

  it.each([
    { label: 'default', root: `Types xmlns="${CT}"`, childPrefix: '' },
    { label: 'prefixed with default', root: `ct:Types xmlns:ct="${CT}" xmlns="${CT}"`, childPrefix: '' },
    { label: 'prefixed only', root: `ct:Types xmlns:ct="${CT}"`, childPrefix: 'ct:' },
    {
      label: 'prefixed with foreign default',
      root: `ct:Types xmlns:ct="${CT}" xmlns="urn:vendor"`,
      childPrefix: 'ct:',
    },
  ])(
    'registers people through public Editor.open/create/ZIP export with a $label manifest',
    async ({ root, childPrefix }) => {
      const input = await readFile(resolve(__dirname, '../tests/data/docxbench-comment-reply-001.docx'));
      const zip = await JSZip.loadAsync(input);
      const source = await zip.file('[Content_Types].xml')!.async('string');
      const rootName = root.split(' ')[0];
      const types = source
        .replace(/<Types[^>]*>/, `<${root} xmlns:v="urn:vendor" v:keep="&amp;quot; &amp;amp;">`)
        .replace(/<(Default|Override)\b/g, `<${childPrefix}$1`)
        .replace(
          '</Types>',
          `<${childPrefix}Override xmlns${childPrefix ? ':ct' : ''}="urn:vendor" PartName="/word/people.xml" ContentType="vendor-shadow"/><v:extension v:keep="&amp;amp;">before &amp;quot;<v:child/>&lt;opaque&gt;&amp;literal</v:extension></${rootName}>`,
        );
      const before = parse(types);
      expect(before.querySelector('parsererror')).toBeNull();
      zip.file('[Content_Types].xml', types);
      const editor = await Editor.open(await zip.generateAsync({ type: 'nodebuffer' }), {
        user: { name: 'Alex Reviewer', email: 'synthetic@example.com', wordIdentity: pair },
        isCommentsEnabled: true,
        telemetry: { enabled: false },
      });
      editors.push(editor);
      const body = editor.state.doc.textContent;
      create(editor);
      for (let repeat = 0; repeat < 2; repeat++) {
        const parts = await files(editor);
        const result = audit(parts);
        const comment = result.comments.find((node) => node.textContent!.includes('Identity root'))!;
        expect(result.associations.get(comment.getAttributeNS(W, 'author'))).toEqual(pair);
        expect(result.path).toBe('word/people.xml');
        const after = parse(parts['[Content_Types].xml']);
        expect(after.querySelector('parsererror')).toBeNull();
        expect(after.documentElement.getAttributeNS('urn:vendor', 'keep')).toBe('&quot; &amp;');
        for (const localName of ['extension', 'Override']) {
          const actual = after.getElementsByTagNameNS('urn:vendor', localName)[0];
          const expected = before.getElementsByTagNameNS('urn:vendor', localName)[0];
          expect(actual.isEqualNode(expected), `${localName}: ${actual.outerHTML} vs ${expected.outerHTML}`).toBe(true);
        }
        for (const entry of [...before.documentElement.children].filter((node) => node.namespaceURI === CT)) {
          const key = entry.hasAttribute('PartName') ? 'PartName' : 'Extension';
          const retained = [...after.getElementsByTagNameNS(CT, entry.localName)].find(
            (node) => node.getAttribute(key) === entry.getAttribute(key),
          );
          expect(retained?.isEqualNode(entry)).toBe(true);
        }
        expect(editor.state.doc.textContent).toBe(body);
      }
    },
  );

  it.each([
    { name: 'Alex', identity: { providerId: 'AD', userId: 'opaque&account' } },
    { name: 'Alex', identity: { providerId: 'vendor <tag> "quote"', userId: 'opaque <id> "quote"' } },
    { name: 'Alex', identity: { providerId: 'vendor &quot;', userId: 'opaque &quot; &amp;' } },
    { name: 'Alex & <Reviewer> "quote" &quot; &amp;', identity: pair },
    ...[' ', '\t', '\n', '\r'].map((space) => ({ name: `Alex${space}Reviewer`, identity: pair })),
  ])(
    'round-trips exact XML-sensitive public user values through Editor.open and ZIP export: $name / $identity.userId',
    async ({ name, identity }) => {
      const input = await readFile(resolve(__dirname, '../tests/data/docxbench-comment-reply-001.docx'));
      const editor = await Editor.open(input, {
        user: { name, email: 'synthetic@example.com', wordIdentity: identity },
        isCommentsEnabled: true,
        telemetry: { enabled: false },
      });
      editors.push(editor);
      create(editor);
      for (let index = 0; index < 2; index++) {
        const parts = await files(editor);
        expect(parse(parts['word/people.xml']).querySelector('parsererror')).toBeNull();
        expect(parse(parts['word/comments.xml']).querySelector('parsererror')).toBeNull();
        const result = audit(parts);
        const root = result.comments.find((comment) => comment.textContent!.includes('Identity root'))!;
        expect.soft(root.getAttributeNS(W, 'author')).toBe(name);
        expect.soft(result.associations.get(root.getAttributeNS(W, 'author'))).toEqual(identity);
      }
    },
  );

  it.each(
    ['\t', '\n', '\r'].flatMap((space) => [
      { space, mapped: true },
      { space, mapped: false },
    ]),
  )('keeps author keys distinct from a space-name account (space: %j)', async ({ space, mapped }) => {
    const input = await readFile(resolve(__dirname, '../tests/data/docxbench-comment-reply-001.docx'));
    const name = `Alex${space}Reviewer`;
    const a = { name, email: 'a@example.com', wordIdentity: mapped ? pair : undefined };
    const b = {
      name: 'Alex Reviewer',
      email: 'b@example.com',
      wordIdentity: { providerId: 'vendor', userId: 'account-b' },
    };
    const editor = await Editor.open(input, { user: a, isCommentsEnabled: true, telemetry: { enabled: false } });
    editors.push(editor);
    const body = editor.state.doc.textContent;
    const old = structuredClone(editor.converter.comments[0]);
    const rootA = create(editor, 'Whitespace root A');
    editor.setOptions({ user: b });
    const rootB = create(editor, 'Whitespace root B');
    expect(editor.doc.comments.create({ parentCommentId: rootA, text: 'Whitespace reply B' }).success).toBe(true);
    editor.setOptions({ user: a });
    expect(editor.doc.comments.create({ parentCommentId: rootB, text: 'Whitespace reply A' }).success).toBe(true);
    const canonical = JSON.stringify(editor.converter.comments);
    let labels: (string | null)[] | undefined;
    const check = (parts: Record<string, string>) => {
      for (const content of Object.values(parts).filter((value) => value.startsWith('<?xml'))) {
        expect(parse(content).querySelector('parsererror')).toBeNull();
      }
      const result = audit(parts);
      expect(result.comments).toHaveLength(5);
      expect(result.people).toHaveLength(mapped ? 2 : 1);
      const current = [];
      const rows = new Map<string, Element>();
      for (const [text, identity, expectedName] of [
        ['root A', a.wordIdentity, name],
        ['root B', b.wordIdentity, b.name],
        ['reply A', a.wordIdentity, name],
        ['reply B', b.wordIdentity, b.name],
      ] as const) {
        const row = result.comments.find((node) => node.textContent!.includes(`Whitespace ${text}`))!;
        const label = row.getAttributeNS(W, 'author');
        rows.set(text, row);
        current.push(label);
        // Resolve decoded keys independently: a wrong account is different from a missing join.
        expect.soft(result.associations.get(label), text).toEqual(identity);
        expect.soft(label, text).toBe(expectedName);
      }
      if (labels) expect.soft(current).toEqual(labels);
      else labels = current;
      const oldRow = result.comments.find((node) => node.getAttributeNS(W, 'author') === old.creatorName)!;
      expect(oldRow.textContent).toContain('Please confirm the delivery window.');
      const document = parse(parts['word/document.xml']);
      expect([...document.getElementsByTagNameNS(W, 't')].map((node) => node.textContent).join('')).toBe(body);
      for (const row of [oldRow, rows.get('root A')!, rows.get('root B')!]) {
        for (const tag of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) {
          expect(
            [...document.getElementsByTagNameNS(W, tag)].some(
              (node) => node.getAttributeNS(W, 'id') === row.getAttributeNS(W, 'id'),
            ),
          ).toBe(true);
        }
      }
      const extended = [...parse(parts['word/commentsExtended.xml']).getElementsByTagNameNS(P, 'commentEx')];
      const paraId = (row: Element) =>
        [...row.getElementsByTagNameNS(W, 'p')]
          .at(-1)!
          .getAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml', 'paraId');
      for (const [reply, parent] of [
        ['reply A', 'root B'],
        ['reply B', 'root A'],
      ]) {
        expect(
          extended
            .find((node) => node.getAttributeNS(P, 'paraId') === paraId(rows.get(reply)!))!
            .getAttributeNS(P, 'paraIdParent'),
        ).toBe(paraId(rows.get(parent)!));
      }
    };
    for (let repeat = 0; repeat < 2; repeat++) {
      const bytes = await editor.exportDocx();
      const entries = await new DocxZipper().getDocxData(bytes, true);
      check(Object.fromEntries(entries.map((entry) => [entry.name, entry.content])));
      expect(JSON.stringify(editor.converter.comments)).toBe(canonical);
      if (repeat === 1) {
        const reopened = await Editor.open(bytes, { isCommentsEnabled: true, telemetry: { enabled: false } });
        editors.push(reopened);
        for (let again = 0; again < 2; again++) check(await files(reopened));
      }
    }
  });

  it('preserves imported character-reference author keys beside a conflicting space-name account', async () => {
    const input = await readFile(resolve(__dirname, '../tests/data/docxbench-comment-reply-001.docx'));
    const zip = await JSZip.loadAsync(input);
    const name = 'Imported\tReviewer\nLine\rEnd &quot; &amp; <tag> "quote"';
    const encoded = 'Imported&#9;Reviewer&#xA;Line&#13;End &amp;quot; &amp;amp; &lt;tag&gt; &quot;quote&quot;';
    zip.file(
      'word/comments.xml',
      (await zip.file('word/comments.xml')!.async('string')).replace(/w:author="[^"]*"/g, `w:author="${encoded}"`),
    );
    const raw = `<p:people xmlns:p="${P}" xmlns:v="urn:vendor" v:keep="&amp;quot;"><p:person p:author="${encoded}"><p:presenceInfo p:providerId="vendor" p:userId="imported-account"/><v:extra xml:space="preserve">  <v:child/> \t <![CDATA[&amp; <tag>]]></v:extra></p:person></p:people>`;
    zip.file('word/people.xml', raw);
    zip.file(
      'word/_rels/document.xml.rels',
      (await zip.file('word/_rels/document.xml.rels')!.async('string')).replace(
        '</Relationships>',
        `<Relationship Id="authorKeys" Type="${PEOPLE_REL}" Target="people.xml"/></Relationships>`,
      ),
    );
    zip.file(
      '[Content_Types].xml',
      (await zip.file('[Content_Types].xml')!.async('string')).replace(
        '</Types>',
        '<Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/></Types>',
      ),
    );
    const editor = await Editor.open(await zip.generateAsync({ type: 'nodebuffer' }), {
      user: { name: 'Imported Reviewer Line End &quot; &amp; <tag> "quote"', wordIdentity: pair },
      isCommentsEnabled: true,
      telemetry: { enabled: false },
    });
    editors.push(editor);
    const old = editor.converter.comments[0];
    expect(old.creatorName).toBe(name);
    expect(old.creatorIdentity).toEqual({ providerId: 'vendor', userId: 'imported-account' });
    const source = JSON.stringify(editor.converter.convertedXml['word/people.xml']);
    create(editor, 'Imported key new root');
    expect(
      editor.doc.comments.create({ parentCommentId: old.commentId!, text: 'Imported key new reply' }).success,
    ).toBe(true);
    const canonical = JSON.stringify(editor.converter.comments);
    const check = (parts: Record<string, string>) => {
      const result = audit(parts);
      const original = result.comments.find((row) => row.textContent!.includes('Please confirm'))!;
      const author = original.getAttributeNS(W, 'author');
      expect.soft(author).toBe(name);
      expect.soft(result.associations.get(author)).toEqual({ providerId: 'vendor', userId: 'imported-account' });
      for (const text of ['Imported key new root', 'Imported key new reply']) {
        const row = result.comments.find((node) => node.textContent!.includes(text))!;
        expect(result.associations.get(row.getAttributeNS(W, 'author'))).toEqual(pair);
      }
      expect(result.people).toHaveLength(2);
      expect(parse(parts[result.path]).documentElement.getAttributeNS('urn:vendor', 'keep')).toBe('&quot;');
      expect(result.people[0].isEqualNode(parse(raw).getElementsByTagNameNS(P, 'person')[0])).toBe(true);
    };
    for (let repeat = 0; repeat < 2; repeat++) check(await files(editor));
    expect(JSON.stringify(editor.converter.comments)).toBe(canonical);
    expect(JSON.stringify(editor.converter.convertedXml['word/people.xml'])).toBe(source);
    const reopened = await Editor.open(await editor.exportDocx(), {
      isCommentsEnabled: true,
      telemetry: { enabled: false },
    });
    editors.push(reopened);
    check(await files(reopened));
  });

  it('keeps an existing escaped external hyperlink unchanged when the public export first adds people', async () => {
    const input = await readFile(resolve(__dirname, '../tests/data/docxbench-comment-reply-001.docx'));
    const zip = await JSZip.loadAsync(input);
    const source = await zip.file('word/_rels/document.xml.rels')!.async('string');
    const target = 'https://example.com/?a=1&b=2&literal=&quot;&other=&amp;';
    zip.file(
      'word/_rels/document.xml.rels',
      source.replace(
        '</Relationships>',
        '<Relationship Id="escapedLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/?a=1&amp;b=2&amp;literal=&amp;quot;&amp;other=&amp;amp;" TargetMode="External"/></Relationships>',
      ),
    );
    const editor = await Editor.open(await zip.generateAsync({ type: 'nodebuffer' }), {
      user: { name: 'Alex Reviewer', email: 'synthetic@example.com', wordIdentity: pair },
      isCommentsEnabled: true,
      telemetry: { enabled: false },
    });
    editors.push(editor);
    create(editor);
    const parts = await files(editor);
    audit(parts);
    const doc = parse(parts['word/_rels/document.xml.rels']);
    expect(doc.querySelector('parsererror')).toBeNull();
    const hyperlink = [...doc.getElementsByTagNameNS(R, 'Relationship')].find(
      (node) => node.getAttribute('Id') === 'escapedLink',
    )!;
    expect(hyperlink.getAttribute('Target')).toBe(target);
    expect(hyperlink.getAttribute('TargetMode')).toBe('External');
    expect(hyperlink.getAttribute('Type')).toBe(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
    );
  });

  it('snapshots configured identities for roots and replies, exports and reopens the actual package', async () => {
    const editor = open();
    const id = create(editor);
    const replyPair = { providerId: 'opaque-provider', userId: ' other account ' };
    editor.options.user!.wordIdentity = replyPair;
    editor.doc.comments.create({ parentCommentId: id, text: 'Identity reply' });
    replyPair.userId = 'changed later';
    const parts = await files(editor);
    const result = audit(parts);
    const root = result.comments.find((c) => c.textContent!.includes('Identity root'))!;
    const reply = result.comments.find((c) => c.textContent!.includes('Identity reply'))!;
    expect(result.associations.get(root.getAttributeNS(W, 'author'))).toEqual(pair);
    expect(result.associations.get(reply.getAttributeNS(W, 'author'))).toEqual({
      providerId: 'opaque-provider',
      userId: ' other account ',
    });
    expect(root.getAttributeNS(W, 'author')).not.toBe(reply.getAttributeNS(W, 'author'));
    const bytes = await editor.exportDocx();
    const [docx, media, mediaFiles, fonts] = await Editor.loadXmlData(bytes, true);
    const reopened = open({ docx, media, mediaFiles, fonts });
    const again = audit(await files(reopened));
    expect(again.comments.map((c) => [c.textContent, c.getAttributeNS(W, 'author')])).toEqual(
      result.comments.map((c) => [c.textContent, c.getAttributeNS(W, 'author')]),
    );
    expect([...again.associations]).toEqual([...result.associations]);
  });

  it('preserves imported character-reference identities and vendor data across mapped append, warm exports and reopen', async () => {
    const input = await readFile(resolve(__dirname, '../tests/data/docxbench-comment-reply-001.docx'));
    const zip = await JSZip.loadAsync(input);
    const oldAuthor = parse(await zip.file('word/comments.xml')!.async('string'))
      .getElementsByTagNameNS(W, 'comment')[0]
      .getAttributeNS(W, 'author')!;
    const oldPair = { providerId: 'vendor\ttab\nline\rend', userId: 'old\taccount\nline\rend' };
    const raw = `<p:people xmlns:p="${P}" xmlns:v="urn:vendor" v:keep="root&#9;tab&#10;line&#13;end"><p:person p:author="${oldAuthor}" v:keep="person&#x9;tab&#xA;line&#xD;end"><p:presenceInfo p:providerId="vendor&#9;tab&#10;line&#13;end" p:userId="old&#x9;account&#xA;line&#xD;end"/><v:extra v:keep="extra&#9;tab&#10;line&#13;end &amp;#xD;">before&#xD;return&#xD;&#xA;line<v:child/>after&#13; &amp;#xD;<![CDATA[raw &amp; <tag>]]></v:extra></p:person><v:root>root&#13;text</v:root></p:people>`;
    zip.file('word/people.xml', raw);
    zip.file(
      'word/_rels/document.xml.rels',
      (await zip.file('word/_rels/document.xml.rels')!.async('string')).replace(
        '</Relationships>',
        `<Relationship Id="peopleWhitespace" Type="${PEOPLE_REL}" Target="people.xml"/></Relationships>`,
      ),
    );
    zip.file(
      '[Content_Types].xml',
      (await zip.file('[Content_Types].xml')!.async('string')).replace(
        '</Types>',
        '<Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/></Types>',
      ),
    );
    const newPair = { providerId: 'vendor', userId: 'new-account' };
    const editor = await Editor.open(await zip.generateAsync({ type: 'nodebuffer' }), {
      user: { name: 'New', email: 'new@example.com', wordIdentity: newPair },
      isCommentsEnabled: true,
      telemetry: { enabled: false },
    });
    editors.push(editor);
    expect(editor.converter.comments[0].creatorIdentity).toEqual(oldPair);
    const sourceTree = JSON.stringify(editor.converter.convertedXml['word/people.xml']);
    const body = editor.state.doc.textContent;
    const original = parse(raw);
    const originalComments = audit(await files(editor)).comments;
    expect((await files(editor))['word/people.xml']).toBe(raw);
    create(editor);
    const check = (parts: Record<string, string>) => {
      const result = audit(parts);
      const doc = parse(parts[result.path]);
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(result.people).toHaveLength(2);
      expect.soft(result.associations.get(oldAuthor)).toEqual(oldPair);
      expect(result.associations.get('New')).toEqual(newPair);
      expect.soft(doc.documentElement.getAttributeNS('urn:vendor', 'keep')).toBe('root\ttab\nline\rend');
      for (const [index, child] of [...original.documentElement.childNodes].entries()) {
        expect.soft(doc.documentElement.childNodes[index].isEqualNode(child)).toBe(true);
      }
      const oldPerson = result.people.find((person) => person.getAttributeNS(P, 'author') === oldAuthor)!;
      expect
        .soft(oldPerson.getElementsByTagNameNS('urn:vendor', 'extra')[0].getAttributeNS('urn:vendor', 'keep'))
        .toBe('extra\ttab\nline\rend &#xD;');
      expect
        .soft(oldPerson.getElementsByTagNameNS('urn:vendor', 'extra')[0].textContent)
        .toBe('before\rreturn\r\nlineafter\r &#xD;raw &amp; <tag>');
      expect(result.comments).toHaveLength(originalComments.length + 1);
      for (const oldComment of originalComments) {
        expect(
          result.comments.some(
            (comment) =>
              comment.textContent === oldComment.textContent &&
              comment.getAttributeNS(W, 'author') === oldComment.getAttributeNS(W, 'author'),
          ),
        ).toBe(true);
      }
      expect(
        result.comments.find((comment) => comment.textContent!.includes('Identity root'))!.getAttributeNS(W, 'author'),
      ).toBe('New');
    };
    for (let repeat = 0; repeat < 3; repeat++) {
      check(await files(editor));
      expect(editor.state.doc.textContent).toBe(body);
      expect(JSON.stringify(editor.converter.convertedXml['word/people.xml'])).toBe(sourceTree);
      expect(editor.converter.comments[0].creatorIdentity).toEqual(oldPair);
    }
    expect(newPair).toEqual({ providerId: 'vendor', userId: 'new-account' });
    const reopened = await Editor.open(await editor.exportDocx(), {
      isCommentsEnabled: true,
      telemetry: { enabled: false },
    });
    editors.push(reopened);
    expect
      .soft(reopened.converter.comments.find((comment: any) => comment.wordAuthorName === oldAuthor).creatorIdentity)
      .toEqual(oldPair);
    check(await files(reopened));
    expect(reopened.state.doc.textContent).toBe(body);
  });

  it('does not leak generated people on clean exports or mutate source comments', async () => {
    const editor = open();
    create(editor);
    const before = JSON.stringify(editor.converter.comments);
    audit(await files(editor));
    const clean = await files(editor, { commentsType: 'clean', comments: [] });
    expect(clean['word/people.xml']).toBeUndefined();
    expect(clean['word/_rels/document.xml.rels']).not.toContain(PEOPLE_REL);
    expect(JSON.stringify(editor.converter.comments)).toBe(before);
    audit(await files(editor));
  });

  it.each([
    { root: `p:people xmlns:p="${P}"`, prefix: 'p:' },
    { root: `people xmlns="${P}" xmlns:p="${P}"`, prefix: '' },
    { root: `alt:people xmlns:alt="${P}" xmlns:p="${P}"`, prefix: 'alt:' },
  ])(
    'retains all imported people text through public append, warm exports and reopen: $root',
    async ({ root, prefix }) => {
      const input = await readFile(resolve(__dirname, '../tests/data/docxbench-comment-reply-001.docx'));
      const zip = await JSZip.loadAsync(input);
      const oldAuthor = parse(await zip.file('word/comments.xml')!.async('string'))
        .getElementsByTagNameNS(W, 'comment')[0]
        .getAttributeNS(W, 'author')!;
      const path = 'word/metadata/people-custom.xml';
      const raw = `<?xml version='1.0'?><${root} xmlns:v="urn:vendor" v:keep="root&#9;tab">\n <${prefix}person p:author="${oldAuthor}"><${prefix}presenceInfo p:providerId="vendor" p:userId="old&#x9;account"/><v:extra xml:space="preserve">  <v:child/> \t <v:child/>  </v:extra><v:mixed>before&#13;<v:child/>after &amp;amp;<![CDATA[raw &amp; <tag>]]></v:mixed><v:shadow xmlns:p="urn:shadow" xml:space="preserve"> <p:person p:author="shadow"/> </v:shadow></${prefix}person>\n <![CDATA[root &amp; <tag>]]>\n <v:root xml:space="preserve"> <v:child/> </v:root>\n</${root.split(' ')[0]}>`;
      zip.file(path, raw);
      zip.file(
        'word/_rels/document.xml.rels',
        (await zip.file('word/_rels/document.xml.rels')!.async('string')).replace(
          '</Relationships>',
          `<Relationship Id="peopleSpaces" Type="${PEOPLE_REL}" Target="metadata/people-custom.xml"/></Relationships>`,
        ),
      );
      zip.file(
        '[Content_Types].xml',
        (await zip.file('[Content_Types].xml')!.async('string')).replace(
          '</Types>',
          `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/></Types>`,
        ),
      );
      const editor = await Editor.open(await zip.generateAsync({ type: 'nodebuffer' }), {
        user: { name: 'New', email: 'new@example.com', wordIdentity: { providerId: 'vendor', userId: 'new-account' } },
        isCommentsEnabled: true,
        telemetry: { enabled: false },
      });
      editors.push(editor);
      const body = editor.state.doc.textContent;
      const source = JSON.stringify(editor.converter.convertedXml[path]);
      const original = parse(raw);
      const originalComments = audit(await files(editor)).comments;
      expect((await files(editor))[path]).toBe(raw);
      const id = create(editor);
      editor.doc.comments.create({ parentCommentId: id, text: 'Whitespace reply' });
      const check = (parts: Record<string, string>) => {
        const result = audit(parts);
        expect(result.path).toBe(path);
        expect(result.people).toHaveLength(2);
        expect(result.associations.get(oldAuthor)).toEqual({ providerId: 'vendor', userId: 'old\taccount' });
        expect(result.associations.get('New')).toEqual({ providerId: 'vendor', userId: 'new-account' });
        const current = parse(parts[path]);
        expect(current.querySelector('parsererror')).toBeNull();
        expect(current.documentElement.getAttributeNS('urn:vendor', 'keep')).toBe('root\ttab');
        for (const [index, child] of [...original.documentElement.childNodes].entries()) {
          expect
            .soft(current.documentElement.childNodes[index]?.isEqualNode(child), `original child ${index}`)
            .toBe(true);
        }
        expect.soft(current.getElementsByTagNameNS('urn:vendor', 'extra')[0].textContent).toBe('   \t   ');
        expect(result.comments).toHaveLength(originalComments.length + 2);
        for (const old of originalComments) {
          expect(
            result.comments.some(
              (comment) =>
                comment.textContent === old.textContent &&
                comment.getAttributeNS(W, 'author') === old.getAttributeNS(W, 'author'),
            ),
          ).toBe(true);
        }
        for (const text of ['Identity root', 'Whitespace reply']) {
          expect(
            result.comments.find((comment) => comment.textContent!.includes(text))!.getAttributeNS(W, 'author'),
          ).toBe('New');
        }
      };
      for (let repeat = 0; repeat < 3; repeat++) {
        check(await files(editor));
        expect(editor.state.doc.textContent).toBe(body);
        expect(JSON.stringify(editor.converter.convertedXml[path])).toBe(source);
      }
      const reopened = await Editor.open(await editor.exportDocx(), {
        isCommentsEnabled: true,
        telemetry: { enabled: false },
      });
      editors.push(reopened);
      check(await files(reopened));
      expect(reopened.state.doc.textContent).toBe(body);

      // Existing room trees are authoritative, even when the local raw carrier is older.
      // This is an in-process parts test; actual transport/persistence remains owner verification.
      const room = new Y.Doc();
      const remote = new Y.Doc();
      seedPartsFromEditor(editor, room);
      const handle = bootstrapPartSync(editor, room);
      try {
        Y.applyUpdate(remote, Y.encodeStateAsUpdate(room));
        const incoming = raw.replace('>  <v:child/>', '>     <v:child/>');
        remote.getMap('parts').set(
          path,
          encodeEnvelopeToYjs({
            v: 2,
            clientId: remote.clientID,
            data: xmljs.xml2js(incoming, { captureSpacesBetweenElements: true }),
          }),
        );
        Y.applyUpdate(room, Y.encodeStateAsUpdate(remote));
        const roomPart = JSON.stringify(room.getMap('parts').toJSON()[path]);
        expect(
          parse((await files(editor))[path])
            .getElementsByTagNameNS('urn:vendor', 'extra')[0]
            .isEqualNode(parse(incoming).getElementsByTagNameNS('urn:vendor', 'extra')[0]),
        ).toBe(true);
        const late = open();
        late.options.originalDocxFile = undefined;
        const lateHandle = bootstrapPartSync(late, room);
        try {
          const before = JSON.stringify(late.converter.convertedXml[path]);
          const output = audit(await files(late));
          expect(parse((await files(late))[path]).documentElement.isEqualNode(parse(incoming).documentElement)).toBe(
            true,
          );
          expect(output.associations.get(oldAuthor)).toEqual({ providerId: 'vendor', userId: 'old\taccount' });
          expect(JSON.stringify(late.converter.convertedXml[path])).toBe(before);
        } finally {
          lateHandle.destroy();
        }
        expect(JSON.stringify(room.getMap('parts').toJSON()[path])).toBe(roomPart);
      } finally {
        handle.destroy();
        room.destroy();
        remote.destroy();
      }
    },
  );

  it.each([
    { providerId: 'AD' },
    ...['\t', '\n', '\r'].flatMap((character) => [
      { providerId: `vendor${character}end`, userId: 'new-account' },
      { providerId: 'vendor', userId: `new${character}account` },
    ]),
  ])('rejects invalid session identity %j before any document or entity mutation', (identity) => {
    const editor = open(data, identity);
    const before = editor.state.doc.toJSON();
    const comments = JSON.stringify(editor.converter.comments);
    expect(() => create(editor)).toThrow(TypeError);
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(JSON.stringify(editor.converter.comments)).toBe(comments);
  });

  it('keeps legacy fallback unmapped and rejects malformed explicit export pairs', async () => {
    const editor = open(data, undefined);
    editor.options.user!.wordIdentity = undefined;
    create(editor);
    const parts = await files(editor);
    expect(parts['word/people.xml']).toBeUndefined();
    await expect(
      editor.exportDocx({
        comments: [
          {
            commentId: 'invalid',
            creatorName: 'Alex',
            commentText: 'Invalid identity',
            creatorIdentity: { providerId: 'AD', userId: '\n' },
          } as any,
        ],
      }),
    ).rejects.toThrow(TypeError);
  });
  it('preserves imported alternate-namespace people and separates same-name accounts and fallback authors', async () => {
    const imported = structuredClone(data);
    const author = 'Alex Reviewer';
    const oldPair = { providerId: 'AD', userId: 'S::original@example.com::original' };
    const sourcePeople = `<people xmlns="${P}" xmlns:p="${P}" xmlns:v="urn:vendor" v:keep="root"><person p:author="${author}" v:keep="person"><presenceInfo p:providerId="AD" p:userId="${oldPair.userId}"/><v:extra xmlns:p="urn:shadow"><p:presenceInfo p:userId="ignore"/><v:text>keep &amp; text<![CDATA[<opaque>]]></v:text></v:extra></person><v:extra>root data</v:extra></people>`;
    imported.docx = imported.docx.map((f: any) => ({
      ...f,
      content:
        f.name === 'word/comments.xml'
          ? f.content.replace(/w:author="[^"]*"/g, `w:author="${author}"`)
          : f.name === '[Content_Types].xml'
            ? f.content.replace(
                '</Types>',
                '<Override PartName="/word/people-custom.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/></Types>',
              )
            : f.name === 'word/_rels/document.xml.rels'
              ? f.content.replace(
                  '</Relationships>',
                  `<Relationship Id="peopleId" Type="${PEOPLE_REL}" Target="metadata/../people-custom.xml"/></Relationships>`,
                )
              : f.content,
    }));
    imported.docx.push({ name: 'word/people-custom.xml', content: sourcePeople });
    const editor = open(imported);
    const original = editor.converter.comments[0];
    create(editor);
    const fallback = {
      commentId: 'fallback',
      creatorName: author,
      creatorEmail: 'original@example.com',
      commentText: 'Fallback author',
      wordAuthorName: author,
      importedId: 'spoofed',
      isInternal: false,
    };
    const parts = await files(editor, { comments: [...editor.converter.comments, fallback] });
    const result = audit(parts);
    expect(result.path).toBe('word/people-custom.xml');
    expect(parts['word/people.xml']).toBeUndefined();
    const oldPerson = result.people.find((p) => p.getAttributeNS(P, 'author') === author)!;
    expect(oldPerson.getAttributeNS('urn:vendor', 'keep')).toBe('person');
    expect(oldPerson.getElementsByTagNameNS('urn:vendor', 'text')[0].textContent).toBe('keep & text<opaque>');
    const oldComment = result.comments.find(
      (c) => !c.textContent!.includes('Identity root') && !c.textContent!.includes('Fallback author'),
    )!;
    const newComment = result.comments.find((c) => c.textContent!.includes('Identity root'))!;
    const fallbackComment = result.comments.find((c) => c.textContent!.includes('Fallback author'))!;
    expect(oldComment.getAttributeNS(W, 'author')).toBe(author);
    expect(result.associations.get(author)).toEqual(oldPair);
    expect(newComment.getAttributeNS(W, 'author')).not.toBe(author);
    expect(original.creatorIdentity).toEqual(oldPair);
    expect(original.wordAuthorName).toBe(author);
    expect(result.associations.get(newComment.getAttributeNS(W, 'author'))).toEqual(pair);
    expect(fallbackComment.getAttributeNS(W, 'author')).not.toBe(author);
    expect(result.associations.has(fallbackComment.getAttributeNS(W, 'author'))).toBe(false);
    expect(new Set(result.comments.map((c) => c.getAttributeNS(W, 'author'))).size).toBe(3);
    const again = audit(await files(editor, { comments: [fallback, ...editor.converter.comments.slice().reverse()] }));
    expect(again.comments.find((c) => c.textContent!.includes('Identity root'))!.getAttributeNS(W, 'author')).toBe(
      newComment.getAttributeNS(W, 'author'),
    );
    expect(again.associations.get(newComment.getAttributeNS(W, 'author'))).toEqual(pair);
  });

  it('keeps identity across public patches, delete and undo and omits hidden thread identities', async () => {
    const editor = open();
    const id = create(editor);
    editor.options.user!.wordIdentity = { providerId: 'AD', userId: 'current-resolver' };
    editor.doc.comments.patch({ commentId: id, text: 'Updated identity root' });
    editor.doc.comments.patch({ commentId: id, status: 'resolved' });
    editor.doc.comments.patch({ commentId: id, status: 'active' });
    expect(editor.converter.comments.find((c: any) => c.commentId === id).creatorIdentity).toEqual(pair);
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.doc.comments.delete({ commentId: id });
    editor.doc.history.undo();
    const restored = audit(await files(editor));
    const root = restored.comments.find((c) => c.textContent!.includes('Updated identity root'))!;
    expect(restored.associations.get(root.getAttributeNS(W, 'author'))).toEqual(pair);
    editor.doc.comments.patch({ commentId: id, isInternal: true });
    editor.doc.comments.create({ parentCommentId: id, text: 'Hidden reply' });
    const external = await files(editor);
    expect(external['word/people.xml']).toBeUndefined();
    expect(external['word/comments.xml']).not.toContain('Updated identity root');
    expect(external['word/comments.xml']).not.toContain('Hidden reply');
    const all = audit(await files(editor, { commentsType: 'all' }));
    expect(all.comments.some((c) => c.textContent!.includes('Hidden reply'))).toBe(true);
    const overlay = await editor.exportDocx({ getUpdatedDocs: true, commentsType: 'all' });
    expect(overlay[all.path]).toBeTruthy();
    audit(overlay as Record<string, string>);
  });
  it('exports explicit legacy command event snapshots without inferring the session identity for other authors', async () => {
    const editor = open();
    const events: any[] = [];
    editor.on('commentsUpdate', (event) => {
      if (event.comment) events.push(event.comment);
    });
    editor.commands.setTextSelection({ from: 2, to: 6 });
    editor.commands.addComment({ content: 'Legacy identity root', author: 'Explicit Author', authorIdentity: pair });
    const root = events.at(-1);
    editor.commands.addCommentReply({
      parentId: root.commentId,
      content: 'Legacy identity reply',
      author: 'Explicit Author',
      authorIdentity: pair,
    });
    const reply = events.at(-1);
    editor.commands.setTextSelection({ from: 6, to: 9 });
    editor.commands.addComment({ content: 'Legacy other author', author: 'Other Person' });
    const fallback = events.at(-1);
    expect(fallback.creatorIdentity).toBeUndefined();
    const result = audit(await files(editor, { comments: [...editor.converter.comments, root, reply, fallback] }));
    for (const text of ['Legacy identity root', 'Legacy identity reply']) {
      const comment = result.comments.find((c) => c.textContent!.includes(text))!;
      expect(result.associations.get(comment.getAttributeNS(W, 'author'))).toEqual(pair);
    }
    const other = result.comments.find((c) => c.textContent!.includes('Legacy other author'))!;
    expect(result.associations.has(other.getAttributeNS(W, 'author'))).toBe(false);
  });

  it('reads imported author provenance when room parts hydrate after the carrier was opened', async () => {
    const editor = open();
    const old = editor.converter.comments[0];
    const sourceName = old.creatorName;
    editor.converter.convertedXml['word/room-people.xml'] = {
      elements: [
        {
          type: 'element',
          name: 'p:people',
          attributes: { 'xmlns:p': P },
          elements: [
            {
              type: 'element',
              name: 'p:person',
              attributes: { 'p:author': sourceName },
              elements: [
                {
                  type: 'element',
                  name: 'p:presenceInfo',
                  attributes: { 'p:providerId': 'AD', 'p:userId': 'room-imported-account' },
                },
              ],
            },
          ],
        },
      ],
    };
    editor.converter.convertedXml['word/_rels/document.xml.rels'].elements[0].elements.push({
      type: 'element',
      name: 'Relationship',
      attributes: { Id: 'peopleRoom', Type: PEOPLE_REL, Target: 'room-people.xml' },
    });
    // No initial File carrier is available to a restored peer. Its persisted source parts are authoritative.
    editor.options.originalDocxFile = undefined;
    const result = audit(await files(editor));
    const imported = result.comments.find((c) => !c.textContent!.includes('Identity root'))!;
    expect(imported.getAttributeNS(W, 'author')).toBe(sourceName);
    expect(result.associations.get(sourceName)).toEqual({ providerId: 'AD', userId: 'room-imported-account' });
  });
  it("does not treat a failed export's generated labels as imported provenance on retry", async () => {
    const editor = open();
    create(editor);
    const failure = vi.spyOn(SuperConverter, 'setStoredSuperdocVersion').mockImplementationOnce(() => {
      throw new Error('synthetic late export failure');
    });
    try {
      await expect(editor.exportDocx()).rejects.toThrow('synthetic late export failure');
    } finally {
      failure.mockRestore();
    }
    const result = audit(await files(editor));
    const root = result.comments.find((c) => c.textContent!.includes('Identity root'))!;
    expect(result.associations.get(root.getAttributeNS(W, 'author'))).toEqual(pair);
  });

  it('validates explicit identity input even when the chosen export mode excludes the comment', async () => {
    const editor = open();
    await expect(
      editor.exportDocx({
        commentsType: 'clean',
        comments: [
          {
            commentId: 'invalid-hidden',
            creatorName: 'Hidden author',
            commentText: 'Hidden',
            creatorIdentity: { providerId: 'AD', userId: '\n' },
            isInternal: true,
          } as any,
        ],
      }),
    ).rejects.toThrow(TypeError);
  });
});
