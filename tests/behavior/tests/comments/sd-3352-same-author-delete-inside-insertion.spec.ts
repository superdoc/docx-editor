import { test, expect, type SuperDocFixture } from '../../fixtures/superdoc.js';

// SD-3352 / TC-SAME-001: deleting text wholly inside your OWN pending tracked
// insertion must refine the insertion in place — one shrunken suggestion, the
// way Word handles it (overlap case 11_same_insert_delete_inside_control) —
// not stack an overlapping deletion on top of your own insertion.
//
// The regression trigger was an anonymous session (integrator passes no
// `user`): typing recognized the anonymous user as itself, but the delete
// path classified the same user as a different reviewer and minted a nested
// tracked deletion over their own suggestion.

test.use({ config: { toolbar: 'full', comments: 'off', trackChanges: true } });

// Mirror of SuperDoc's DEFAULT_USER when the integrator passes no `user`.
const ANONYMOUS_DEFAULT = { id: null, name: 'Default SuperDoc user', email: null };
const REVIEWER = { name: 'Guest Reviewer', email: 'track@example.com' };

const setUser = (superdoc: SuperDocFixture, user: Record<string, unknown>): Promise<void> =>
  superdoc.page.evaluate((u) => {
    (window as any).editor.setOptions({ user: u });
  }, user);

/**
 * Snapshot tracked-change state: text grouped by logical change id per mark
 * kind, plus the public document-api read model.
 */
const snapshotTrackedState = (
  superdoc: SuperDocFixture,
): Promise<{
  insertById: Record<string, string>;
  deleteById: Record<string, string>;
  docText: string;
  listItems: Array<{ type: string; text: string }>;
}> =>
  superdoc.page.evaluate(async () => {
    const editor = (window as any).editor;
    const insertById: Record<string, string> = {};
    const deleteById: Record<string, string> = {};
    editor.state.doc.descendants((node: any) => {
      if (!node.isText || !node.text) return;
      for (const mark of node.marks ?? []) {
        if (mark.type?.name === 'trackInsert') {
          const id = String(mark.attrs?.id ?? '');
          insertById[id] = (insertById[id] ?? '') + node.text;
        } else if (mark.type?.name === 'trackDelete') {
          const id = String(mark.attrs?.id ?? '');
          deleteById[id] = (deleteById[id] ?? '') + node.text;
        }
      }
    });
    const list = await editor.doc.trackChanges.list();
    return {
      insertById,
      deleteById,
      docText: editor.state.doc.textContent,
      listItems: (list?.items ?? []).map((item: any) => ({
        type: String(item.type),
        text: String(item.insertedText ?? item.deletedText ?? ''),
      })),
    };
  });

/** Type a pending insertion in suggesting mode, then delete "HELLO" inside it. */
async function typeThenDeleteInsideOwnInsertion(superdoc: SuperDocFixture): Promise<void> {
  await superdoc.setDocumentMode('suggesting');
  await superdoc.waitForStable();
  await superdoc.type('ABCHELLOXYZ');
  await superdoc.waitForStable();

  const pos = await superdoc.findTextPos('HELLO');
  await superdoc.setTextSelection(pos, pos + 'HELLO'.length);
  await superdoc.waitForStable();
  await superdoc.press('Backspace');
  await superdoc.waitForStable();
}

const expectSingleRefinedInsertion = (state: Awaited<ReturnType<typeof snapshotTrackedState>>) => {
  expect(state.docText).toBe('ABCXYZ');
  // No overlapping deletion was minted over the user's own suggestion.
  expect(Object.keys(state.deleteById)).toHaveLength(0);
  // One logical insertion remains, refined to the surviving text.
  const insertIds = Object.keys(state.insertById);
  expect(insertIds).toHaveLength(1);
  expect(state.insertById[insertIds[0]]).toBe('ABCXYZ');
  // Public read model agrees: exactly one reviewable insert item.
  expect(state.listItems).toEqual([{ type: 'insert', text: 'ABCXYZ' }]);
};

test('anonymous session: deleting inside own pending insertion refines it in place (SD-3352)', async ({ superdoc }) => {
  await setUser(superdoc, ANONYMOUS_DEFAULT);
  await typeThenDeleteInsideOwnInsertion(superdoc);
  expectSingleRefinedInsertion(await snapshotTrackedState(superdoc));
});

test('identified user: deleting inside own pending insertion refines it in place', async ({ superdoc }) => {
  await setUser(superdoc, REVIEWER);
  await typeThenDeleteInsideOwnInsertion(superdoc);
  expectSingleRefinedInsertion(await snapshotTrackedState(superdoc));
});

test('anonymous session: typing over a selection inside own insertion refines it in place (SD-3352)', async ({
  superdoc,
}) => {
  // Replace-path variant: selecting inside your own pending insertion and
  // typing must refine the insertion under its original id — not collapse the
  // deleted half while minting the replacement text as a nested child
  // insertion (overlapParentId) under your own suggestion.
  await setUser(superdoc, ANONYMOUS_DEFAULT);
  await superdoc.setDocumentMode('suggesting');
  await superdoc.waitForStable();
  await superdoc.type('ABCHELLOXYZ');
  await superdoc.waitForStable();

  const pos = await superdoc.findTextPos('HELLO');
  await superdoc.setTextSelection(pos, pos + 'HELLO'.length);
  await superdoc.waitForStable();
  await superdoc.type('Q');
  await superdoc.waitForStable();

  const state = await snapshotTrackedState(superdoc);
  expect(state.docText).toBe('ABCQXYZ');
  expect(Object.keys(state.deleteById)).toHaveLength(0);
  const insertIds = Object.keys(state.insertById);
  expect(insertIds).toHaveLength(1);
  expect(state.insertById[insertIds[0]]).toBe('ABCQXYZ');
  expect(state.listItems).toEqual([{ type: 'insert', text: 'ABCQXYZ' }]);
});

test('anonymous session: backspacing char-by-char through own insertion stays one refined insertion', async ({
  superdoc,
}) => {
  await setUser(superdoc, ANONYMOUS_DEFAULT);
  await superdoc.setDocumentMode('suggesting');
  await superdoc.waitForStable();
  await superdoc.type('ABCHELLOXYZ');
  await superdoc.waitForStable();

  // Caret after the final "O" of HELLO, then one Backspace per character.
  const pos = await superdoc.findTextPos('HELLO');
  await superdoc.setTextSelection(pos + 'HELLO'.length);
  await superdoc.waitForStable();
  for (let i = 0; i < 'HELLO'.length; i += 1) {
    await superdoc.press('Backspace');
    await superdoc.waitForStable();
  }

  expectSingleRefinedInsertion(await snapshotTrackedState(superdoc));
});
