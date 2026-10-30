import type { Config, SuperDoc, SuperDocEditorPayload } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

type Editor = SuperDocEditorPayload['editor'];
type GetHtml = (options?: Record<string, unknown>) => unknown;

const _getHtmlOptional: AssertEqual<Editor['getHTML'], GetHtml | undefined> = true;
const _getHtmlParameters: AssertEqual<
  Parameters<NonNullable<Editor['getHTML']>>,
  [options?: Record<string, unknown>]
> = true;
const _getHtmlReturn: AssertEqual<ReturnType<NonNullable<Editor['getHTML']>>, unknown> = true;
const _activeEditorIsEditor: AssertEqual<SuperDoc['activeEditor'], Editor | null> = true;
const _superdocGetHtmlParameters: AssertEqual<
  Parameters<SuperDoc['getHTML']>,
  [_options?: Record<string, unknown> | undefined]
> = true;

const v2Facade: Editor = { editorVersion: 2 };
void v2Facade;

const config: Config = {
  selector: '#editor',
  onEditorCreate: async ({ editor }) => {
    // @ts-expect-error The superdoc@2 active editor has no getHTML; guard the call.
    editor.getHTML();
    const legacyHtml: unknown = editor.getHTML?.();
    void legacyHtml;
    const doc = editor.doc;
    if (!doc) return;
    const html = await doc.getHtml({});
    const _replacementReturnsHtml: AssertEqual<typeof html, string> = true;
    void _replacementReturnsHtml;
  },
};
void config;
