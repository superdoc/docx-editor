/* @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as xmljs from 'xml-js';
import { bootstrapPartSync } from '../../../super-editor/src/editors/v1/extensions/collaboration/part-sync/bootstrap.js';
import { mutateParts } from '../../../super-editor/src/editors/v1/core/parts/index.js';
import { DOCX } from '@superdoc/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSuperdocVueApp } from './create-app.js';
import { SuperDoc } from './SuperDoc.js';
import useComment from '../components/CommentsLayer/use-comment.js';
import { initTestEditor } from '../../../super-editor/src/editors/v1/tests/helpers/helpers.js';
import { SuperConverter } from '../../../super-editor/src/editors/v1/core/super-converter/SuperConverter.js';
import { Editor } from '../../../super-editor/src/editors/v1/core/Editor.js';
import DocxZipper from '../../../super-editor/src/editors/v1/core/DocxZipper.js';
import { clearExecutorRegistry } from '../../../super-editor/src/editors/v1/document-api-adapters/plan-engine/executor-registry.js';
import { registerBuiltInExecutors } from '../../../super-editor/src/editors/v1/document-api-adapters/plan-engine/register-executors.js';

// Keep real SuperDoc export, Pinia stores, comment composables and Editor conversion.
// Only omit mounting the visible app; this regression concerns the public package output.
vi.mock('./create-app.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./create-app.js')>();
  return {
    ...actual,
    createSuperdocVueApp: (...args: Parameters<typeof createSuperdocVueApp>) => {
      const runtime = actual.createSuperdocVueApp(...args);
      runtime.app.mount = vi.fn();
      runtime.app.unmount = vi.fn();
      return runtime;
    },
  };
});

const P = 'http://schemas.microsoft.com/office/word/2012/wordml';
const R = 'http://schemas.microsoft.com/office/2011/relationships/people';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
const originalPair = { providerId: 'AD', userId: 'original-account' };
const alexPair = { providerId: 'AD', userId: 'alex-account' };
const otherPair = { providerId: 'AD', userId: 'other-account' };

async function associationByText(blob: Blob, expectedBody: string) {
  const entries = await new DocxZipper().getDocxData(blob, true);
  const parts = Object.fromEntries(entries.map((entry) => [entry.name, entry.content]));
  const body = [...parse(parts['word/document.xml']).getElementsByTagNameNS(W, 't')]
    .map((node) => node.textContent)
    .join('');
  expect(body).toBe(expectedBody);
  const relationship = [
    ...parse(parts['word/_rels/document.xml.rels']).getElementsByTagNameNS('*', 'Relationship'),
  ].find((node) => node.getAttribute('Type') === R)!;
  const path = new URL(relationship.getAttribute('Target')!, 'https://package/word/document.xml').pathname.slice(1);
  const people = [...parse(parts[path]).getElementsByTagNameNS(P, 'person')];
  expect(people[0].getElementsByTagNameNS('urn:vendor', 'extra')[0].textContent).toBe('   \t   ');
  expect(people[0].getElementsByTagNameNS('urn:vendor', 'extra')[0].childNodes).toHaveLength(5);
  const accounts = new Map(
    people.map((person) => {
      const presence = person.getElementsByTagNameNS(P, 'presenceInfo')[0];
      return [
        person.getAttributeNS(P, 'author'),
        {
          providerId: presence.getAttributeNS(P, 'providerId'),
          userId: presence.getAttributeNS(P, 'userId'),
        },
      ];
    }),
  );
  return [...parse(parts['word/comments.xml']).getElementsByTagNameNS(W, 'comment')].map((comment) => ({
    text: comment.textContent,
    label: comment.getAttributeNS(W, 'author'),
    identity: accounts.get(comment.getAttributeNS(W, 'author')),
  }));
}

describe('SuperDoc repeated Word identity exports with imported people', () => {
  beforeAll(() => {
    clearExecutorRegistry();
    registerBuiltInExecutors();
  });
  let superdoc: SuperDoc | undefined;
  let editor: Editor | undefined;
  afterEach(() => {
    editor?.destroy();
    superdoc?.destroy();
    document.body.innerHTML = '';
  });

  it('keeps whitespace-name accounts distinct through the real store and repeated public exports', async () => {
    const input = await readFile(
      resolve(__dirname, '../../../super-editor/src/editors/v1/tests/data/docxbench-comment-reply-001.docx'),
    );
    const [docx, media, mediaFiles, fonts] = await Editor.loadXmlData(input, true);
    const synthetic = docx.map((file) => ({
      ...file,
      content:
        file.name === 'word/comments.xml'
          ? file.content.replace(/w:author="[^"]*"/g, 'w:author="Imported Reviewer"')
          : file.name === 'word/_rels/document.xml.rels'
            ? file.content.replace(
                '</Relationships>',
                `<Relationship Id="people" Type="${R}" Target="people.xml"/></Relationships>`,
              )
            : file.content,
    }));
    synthetic.push({
      name: 'word/people.xml',
      content: `<p:people xmlns:p="${P}" xmlns:v="urn:vendor"><p:person p:author="Imported Reviewer"><p:presenceInfo p:providerId="AD" p:userId="${originalPair.userId}"/><v:extra xml:space="preserve">  <v:child/> \t <v:child/>  </v:extra></p:person></p:people>`,
    });
    document.body.innerHTML = '<div id="identity-host"></div>';
    const a = { name: 'Alex\tReviewer', email: 'a@example.com', wordIdentity: alexPair };
    const b = { name: 'Alex Reviewer', email: 'b@example.com', wordIdentity: otherPair };
    superdoc = new SuperDoc({
      selector: '#identity-host',
      documents: [{ id: 'identity-document', type: DOCX, data: new File([input], 'synthetic.docx', { type: DOCX }) }],
      modules: { toolbar: false, comments: {} },
      user: a,
    });
    await vi.waitFor(() => expect(superdoc!.superdocStore?.documents[0]?.id).toBe('identity-document'));
    ({ editor } = initTestEditor({
      content: synthetic,
      media,
      mediaFiles,
      fonts,
      useImmediateSetTimeout: false,
      documentId: 'identity-document',
      user: superdoc.user,
    }));
    superdoc.superdocStore.documents = [{ id: 'identity-document', type: DOCX, getEditor: () => editor }];
    const store = superdoc.commentsStore;
    const original = editor.converter.comments[0];
    store.addComment({
      superdoc,
      comment: useComment({
        ...original,
        fileId: 'identity-document',
        isInternal: false,
        docxCommentJSON: original.elements,
        commentText: 'Original synthetic comment',
      }),
    });
    editor.on('commentsUpdate', (event) => {
      if (event.type === 'add' && event.comment) store.addComment({ superdoc, comment: useComment(event.comment) });
    });
    const body = editor.state.doc.textContent;
    const target = editor.doc.query.match({ select: { type: 'text', pattern: body.trim().split(/\s+/)[0] } }).items[0]
      .target;
    const rootA = editor.doc.comments.create({ target, text: 'Store whitespace root A' });
    expect(rootA.success).toBe(true);
    editor.setOptions({ user: b });
    const rootB = editor.doc.comments.create({ target, text: 'Store whitespace root B' });
    expect(rootB.success).toBe(true);
    expect(editor.doc.comments.create({ parentCommentId: rootA.id, text: 'Store whitespace reply B' }).success).toBe(
      true,
    );
    editor.setOptions({ user: a });
    expect(editor.doc.comments.create({ parentCommentId: rootB.id, text: 'Store whitespace reply A' }).success).toBe(
      true,
    );
    const canonical = JSON.stringify(store.translateCommentsForExport());
    let first;
    for (let repeat = 0; repeat < 2; repeat++) {
      const blob = (await superdoc.export({
        triggerDownload: false,
        isFinalDoc: false,
        commentsType: 'external',
      })) as Blob;
      const rows = await associationByText(blob, body);
      expect(rows).toHaveLength(5);
      expect(rows.find((row) => row.label === 'Imported Reviewer')?.identity).toEqual(originalPair);
      for (const [text, user] of [
        ['root A', a],
        ['reply A', a],
        ['root B', b],
        ['reply B', b],
      ] as const) {
        const row = rows.find((row) => row.text?.includes(`Store whitespace ${text}`))!;
        expect.soft(row.identity, text).toEqual(user.wordIdentity);
        expect.soft(row.label, text).toBe(user.name);
      }
      if (first) expect(rows).toEqual(first);
      else first = rows;
      expect(JSON.stringify(store.translateCommentsForExport())).toBe(canonical);
    }
  });

  it('retains four creator pairs through early bootstrap and first people arrival on public SuperDoc export', async () => {
    const input = await readFile(
      resolve(__dirname, '../../../super-editor/src/editors/v1/tests/data/docxbench-comment-reply-001.docx'),
    );
    const [docx, media, mediaFiles, fonts] = await Editor.loadXmlData(input, true);
    document.body.innerHTML = '<div id="identity-host"></div>';
    superdoc = new SuperDoc({
      selector: '#identity-host',
      documents: [{ id: 'identity-document', type: DOCX, data: new File([input], 'synthetic.docx', { type: DOCX }) }],
      modules: { toolbar: false, comments: {} },
      user: { name: 'New', email: 'new@example.com', wordIdentity: alexPair },
    });
    await vi.waitFor(() => expect(superdoc!.superdocStore?.documents[0]?.id).toBe('identity-document'));
    ({ editor } = initTestEditor({
      content: docx,
      media,
      mediaFiles,
      fonts,
      useImmediateSetTimeout: false,
      documentId: 'identity-document',
      user: superdoc.user,
    }));
    superdoc.superdocStore.documents = [{ id: 'identity-document', type: DOCX, getEditor: () => editor }];
    const store = superdoc.commentsStore;
    const original = editor.converter.comments[0];
    store.addComment({
      superdoc,
      comment: useComment({
        ...original,
        fileId: 'identity-document',
        isInternal: false,
        docxCommentJSON: original.elements,
        commentText: 'Original synthetic comment',
      }),
    });
    editor.on('commentsUpdate', (event) => {
      if (event.type === 'add' && event.comment) store.addComment({ superdoc, comment: useComment(event.comment) });
    });
    const room = new Y.Doc();
    editor.options.ydoc = room;
    const handle = bootstrapPartSync(editor, room);
    try {
      const body = editor.state.doc.textContent;
      const target: any = editor.doc.query.match({ select: { type: 'text', pattern: body.trim().split(/\s+/)[0] } })
        .items[0].target;
      const a: any = editor.doc.comments.create({ target, text: 'Arrival root A' });
      editor.options.user!.wordIdentity = otherPair;
      const b: any = editor.doc.comments.create({ target, text: 'Arrival root B' });
      editor.doc.comments.create({ parentCommentId: a.id, text: 'Arrival reply B' });
      editor.options.user!.wordIdentity = alexPair;
      editor.doc.comments.create({ parentCommentId: b.id, text: 'Arrival reply A' });
      const canonical = JSON.stringify(store.translateCommentsForExport());
      const exportBlob = async (commentsType = 'external') =>
        (await superdoc!.export({ triggerDownload: false, isFinalDoc: false, commentsType })) as Blob;
      // Warm actual public exports before the first authoritative people part exists.
      for (let i = 0; i < 2; i++) {
        const blob = await exportBlob();
        const entries = await new DocxZipper().getDocxData(blob, true);
        expect(entries.find((file) => file.name === 'word/people.xml')).toBeTruthy();
      }
      expect(room.getMap('parts').toJSON()['word/people.xml']).toBeUndefined();
      mutateParts({
        editor,
        source: 'test:first-people',
        operations: [
          {
            editor,
            partId: 'word/people.xml' as any,
            operation: 'create',
            initial: xmljs.xml2js(
              `<p:people xmlns:p="${P}" xmlns:v="urn:vendor"><p:person p:author="${original.creatorName}"><p:presenceInfo p:providerId="vendor" p:userId="old-account"/><v:extra xml:space="preserve">  <v:child/> \t <v:child/>  </v:extra></p:person></p:people>`,
              { captureSpacesBetweenElements: true },
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
                attributes: { Id: 'firstPeople', Type: R, Target: 'people.xml' },
              }),
          },
        ] as any,
      });
      const envelopes = JSON.stringify(room.getMap('parts').toJSON());
      let first;
      for (let i = 0; i < 2; i++) {
        const rows = await associationByText(await exportBlob(), body);
        expect(rows).toHaveLength(5);
        for (const [text, pair] of [
          ['root A', alexPair],
          ['root B', otherPair],
          ['reply A', alexPair],
          ['reply B', otherPair],
        ] as const) {
          expect.soft(rows.find((row) => row.text?.includes(`Arrival ${text}`))?.identity).toEqual(pair);
        }
        if (first) expect(rows).toEqual(first);
        else first = rows;
      }
      await exportBlob('clean');
      const rows = await associationByText(await exportBlob(), body);
      expect(rows).toEqual(first);
      expect(JSON.stringify(store.translateCommentsForExport())).toBe(canonical);
      expect(JSON.stringify(room.getMap('parts').toJSON())).toBe(envelopes);
    } finally {
      handle.destroy();
      room.destroy();
    }
  });

  it.each([false, true])(
    'retains imported/new/root/reply mappings across three public exports (late failure: %s)',
    async (lateFailure) => {
      const input = await readFile(
        resolve(__dirname, '../../../super-editor/src/editors/v1/tests/data/docxbench-comment-reply-001.docx'),
      );
      const [docx, media, mediaFiles, fonts] = await Editor.loadXmlData(input, true);
      const synthetic = docx.map((file) => ({
        ...file,
        content:
          file.name === 'word/comments.xml'
            ? file.content.replace(/w:author="[^"]*"/g, 'w:author="Imported Reviewer"')
            : file.name === 'word/_rels/document.xml.rels'
              ? file.content.replace(
                  '</Relationships>',
                  `<Relationship Id="people" Type="${R}" Target="people.xml"/></Relationships>`,
                )
              : file.content,
      }));
      synthetic.push({
        name: 'word/people.xml',
        content: `<p:people xmlns:p="${P}" xmlns:v="urn:vendor">\n <p:person p:author="Imported Reviewer"><p:presenceInfo p:providerId="AD" p:userId="${originalPair.userId}"/><v:extra xml:space="preserve">  <v:child/> \t <v:child/>  </v:extra></p:person>\n</p:people>`,
      });
      document.body.innerHTML = '<div id="identity-host"></div>';
      superdoc = new SuperDoc({
        selector: '#identity-host',
        documents: [{ id: 'identity-document', type: DOCX, data: new File([input], 'synthetic.docx', { type: DOCX }) }],
        modules: { toolbar: false, comments: {} },
        user: { id: 'alex-app', name: 'Alex', email: 'alex@example.com', wordIdentity: alexPair },
      });
      await vi.waitFor(() => expect(superdoc!.superdocStore?.documents[0]?.id).toBe('identity-document'));
      ({ editor } = initTestEditor({
        content: synthetic,
        media,
        mediaFiles,
        fonts,
        useImmediateSetTimeout: false,
        documentId: 'identity-document',
        user: superdoc.user,
      }));
      superdoc.superdocStore.documents = [
        {
          id: 'identity-document',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          getEditor: () => editor,
        },
      ];
      const store = superdoc.commentsStore;
      const original = editor.converter.comments[0];
      store.addComment({
        superdoc,
        comment: useComment({
          ...original,
          fileId: 'identity-document',
          isInternal: false,
          docxCommentJSON: original.elements,
          commentText: 'Original synthetic comment',
        }),
      });
      editor.on('commentsUpdate', (event) => {
        if (event.type === 'add' && event.comment) store.addComment({ superdoc, comment: useComment(event.comment) });
      });
      const bodyBefore = editor.state.doc.textContent;
      const exportPublic = async () =>
        associationByText(
          (await superdoc!.export({ triggerDownload: false, isFinalDoc: false, commentsType: 'external' })) as Blob,
          bodyBefore,
        );
      expect((await exportPublic())[0].identity).toEqual(originalPair);
      const word = editor.state.doc.textContent.trim().split(/\s+/)[0];
      const match: any = editor.doc.query.match({ select: { type: 'text', pattern: word } }).items[0];
      const root = editor.doc.comments.create({ target: match.target, text: 'Added Alex root' });
      expect(root.success).toBe(true);
      editor.doc.comments.create({ parentCommentId: original.commentId!, text: 'Added Alex reply' });
      editor.commands.setTextSelection({ from: 2, to: 6 });
      editor.commands.addComment({
        content: 'Added other account',
        author: 'Imported Reviewer',
        authorIdentity: otherPair,
      });
      editor.commands.addComment({
        content: 'Added fallback',
        author: 'Imported Reviewer',
        authorEmail: 'original@example.com',
      });
      const before = JSON.stringify(store.translateCommentsForExport());
      let expected;
      for (let index = 0; index < 3; index++) {
        const result = await exportPublic();
        expect(result).toHaveLength(5);
        expect(result.find((comment) => comment.label === 'Imported Reviewer')?.identity).toEqual(originalPair);
        expect(result.find((c) => c.text?.includes('Added Alex root'))?.identity, `public export ${index + 1}`).toEqual(
          alexPair,
        );
        expect(result.find((c) => c.text?.includes('Added Alex reply'))?.identity).toEqual(alexPair);
        expect(result.find((c) => c.text?.includes('Added other account'))?.identity).toEqual(otherPair);
        expect(result.find((c) => c.text?.includes('Added fallback'))?.identity).toBeUndefined();
        if (expected) expect(result).toEqual(expected);
        else expected = result;
        if (lateFailure && index === 0) {
          const failure = vi.spyOn(SuperConverter, 'setStoredSuperdocVersion').mockImplementationOnce(() => {
            throw new Error('synthetic late failure with imported people');
          });
          try {
            await expect(editor!.exportDocx({ comments: store.translateCommentsForExport() })).rejects.toThrow(
              'synthetic late failure with imported people',
            );
          } finally {
            failure.mockRestore();
          }
        }
      }
      expect(JSON.stringify(store.translateCommentsForExport())).toBe(before);
    },
  );
});
