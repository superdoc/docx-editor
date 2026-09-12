// @ts-check

/**
 * Inline atoms treated like text for tracked-change deletion (SD-3376).
 *
 * `tab` uses `content: 'inline*'`, so `isLeaf` is false despite being an atom.
 * Deletion walks only consider leaves unless listed here.
 *
 * @type {ReadonlySet<string>}
 */
export const TEXT_LIKE_INLINE_ATOMS = new Set(['tab', 'noBreakHyphen']);

/**
 * Returns true when a node is an inline atom that should be treated like text
 * for tracked-change deletion (see {@link TEXT_LIKE_INLINE_ATOMS}).
 *
 * @param {import('prosemirror-model').Node} node
 * @returns {boolean}
 */
export const isTextLikeInlineAtom = (node) =>
  Boolean(node?.isInline && node.isAtom && TEXT_LIKE_INLINE_ATOMS.has(node.type.name));
