import type { Comment, Config, Editor, User } from 'superdoc';

const identity: NonNullable<User['wordIdentity']> = { providerId: 'AD', userId: 'S::synthetic@example.com::opaque' };
const user: User = { id: 'app-id', name: 'Alex', email: 'synthetic@example.com', wordIdentity: identity };
const config: Partial<Config> = {
  user,
  onReady: async ({ superdoc }) => {
    const editor = superdoc.activeEditor;
    if (!editor) return;
    const { items } = editor.doc.query.match({ select: { type: 'text', pattern: 'agreement' } });
    const match = items[0];
    if (match && 'target' in match) {
      const root = editor.doc.comments.create({ target: match.target, text: 'Please review.' });
      if (root.success) {
        editor.doc.comments.create({ parentCommentId: root.id, text: 'Additional context.' });
      }
    }
    await superdoc.export({ isFinalDoc: false, commentsType: 'external' });
  },
};
declare const editor: Editor;
editor.setOptions({ user });
editor.doc.comments.create({ parentCommentId: 'root', text: 'Reply from configured user' });
editor.commands.addComment({ content: 'Legacy root', authorIdentity: identity });
editor.commands.addCommentReply({ parentId: 'root', content: 'Legacy reply', authorIdentity: null });
editor.on('commentsUpdate', (event) => {
  if (event.comment) {
    const asserted: User['wordIdentity'] = event.comment.creatorIdentity;
    void asserted;
  }
});
const comment: Partial<Comment> = { creatorIdentity: identity, wordAuthorName: 'Original author' };
void editor.exportDocx({ comments: [comment as Comment] });
// @ts-expect-error Both provider fields are required.
const partial: User = { wordIdentity: { providerId: 'AD' } };
// @ts-expect-error Provider identifiers are strings.
editor.commands.addComment({ authorIdentity: { providerId: 'AD', userId: 5 } });
void [config, partial];
