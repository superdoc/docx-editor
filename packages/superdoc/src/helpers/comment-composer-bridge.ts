export type CommentComposerResult = { ok: boolean; reason?: string };

export type CommentComposerBridge = {
  open(): Promise<CommentComposerResult>;
  close(): void;
};

const commentComposerBridges = new WeakMap<object, CommentComposerBridge>();

export const registerCommentComposerBridge = (owner: object, bridge: CommentComposerBridge): void => {
  commentComposerBridges.set(owner, bridge);
};

export const getCommentComposerBridge = (owner: object): CommentComposerBridge | undefined =>
  commentComposerBridges.get(owner);

export const releaseCommentComposerBridge = (owner: object, bridge: CommentComposerBridge): void => {
  if (commentComposerBridges.get(owner) === bridge) commentComposerBridges.delete(owner);
};
