/**
 * Node names the reduced rich-text schema registers, derived from the extension
 * objects themselves (each carries `.type === 'node'` and `.name`). ProseMirror adds
 * no implicit nodes, so this set equals the schema's node set. Used to strip nodes
 * that would make `nodeFromJSON` throw when rendering comment HTML. (#3828)
 *
 * @param {Array<{ type?: string, name?: string }>} [extensions] Editor extensions.
 * @returns {Set<string>} Registered node type names.
 */
export const getRichTextSupportedNodeNames = (extensions = []) =>
  new Set(
    (Array.isArray(extensions) ? extensions : [])
      .filter((ext) => ext?.type === 'node')
      .map((ext) => ext?.name)
      .filter(Boolean),
  );

/**
 * Visible whitespace-only leaf nodes that the reduced rich-text schema can't
 * represent. Rather than dropping them (which would silently join surrounding
 * words), map them to text so the separation survives in the rendered HTML.
 */
const VISIBLE_LEAF_NODE_TEXT = {
  lineBreak: '\n',
  hardBreak: '\n',
  tab: '\t',
};

/**
 * Normalize imported DOCX comment JSON into content the reduced rich-text schema can
 * load. Unwraps `run` nodes, strips font attrs from `textStyle` marks, and drops any
 * node the rich-text schema does not register (e.g. `bookmarkStart`/`bookmarkEnd`),
 * preserving inline content those nodes wrap so the visible text survives. The caller's
 * original `docxCommentJSON` is untouched, so exported metadata (bookmarks, etc.) is
 * retained.
 *
 * When `supportedNodeNames` is empty/undefined (schema unavailable) it falls back to
 * stripping only the invisible bookmark boundary nodes. (#3828)
 *
 * @param {*} node A ProseMirror JSON node, array of nodes, or primitive.
 * @param {Set<string>} [supportedNodeNames] Node names the target schema supports.
 * @returns {*} Normalized node(s), or `null` for a dropped leaf node.
 */
export const normalizeCommentForEditor = (node, supportedNodeNames) => {
  if (Array.isArray(node)) {
    return node
      .map((child) => normalizeCommentForEditor(child, supportedNodeNames))
      .flat()
      .filter(Boolean);
  }

  if (!node || typeof node !== 'object') return node;

  // Drop invisible bookmark boundary nodes and any node absent from the rich-text
  // schema used to render comment HTML, preserving inline content they wrap so the
  // visible text survives. Visible whitespace leaves (line breaks, tabs) are mapped
  // to text so the separation is not lost. Falls back to stripping only bookmark
  // boundary nodes when the supported-node set can't be determined (size 0). (#3828)
  const isBoundaryNode = node.type === 'bookmarkStart' || node.type === 'bookmarkEnd';
  const isUnsupported = supportedNodeNames && supportedNodeNames.size > 0 && !supportedNodeNames.has(node.type);
  if (isBoundaryNode || isUnsupported) {
    if (Array.isArray(node.content)) {
      return node.content
        .map((child) => normalizeCommentForEditor(child, supportedNodeNames))
        .flat()
        .filter(Boolean);
    }
    const visibleText = VISIBLE_LEAF_NODE_TEXT[node.type];
    return visibleText !== undefined ? { type: 'text', text: visibleText } : null;
  }

  const stripTextStyleAttrs = (attrs) => {
    if (!attrs) return attrs;
    const rest = { ...attrs };
    delete rest.fontSize;
    delete rest.fontFamily;
    delete rest.eastAsiaFontFamily;
    return Object.keys(rest).length ? rest : undefined;
  };

  const normalizeMark = (mark) => {
    if (!mark) return mark;
    const typeName = typeof mark.type === 'string' ? mark.type : mark.type?.name;
    const attrs = mark?.attrs ? { ...mark.attrs } : undefined;
    if (typeName === 'textStyle' && attrs) {
      return { ...mark, attrs: stripTextStyleAttrs(attrs) };
    }
    return { ...mark, attrs };
  };

  const cloneMarks = (marks) =>
    Array.isArray(marks) ? marks.filter(Boolean).map((mark) => normalizeMark(mark)) : undefined;

  const cloneAttrs = (attrs) => (attrs && typeof attrs === 'object' ? { ...attrs } : undefined);

  if (!Array.isArray(node.content)) {
    return {
      type: node.type,
      ...(node.text !== undefined ? { text: node.text } : {}),
      ...(node.attrs ? { attrs: cloneAttrs(node.attrs) } : {}),
      ...(node.marks ? { marks: cloneMarks(node.marks) } : {}),
    };
  }

  const normalizedChildren = node.content
    .map((child) => normalizeCommentForEditor(child, supportedNodeNames))
    .flat()
    .filter(Boolean);

  if (node.type === 'run') {
    return normalizedChildren;
  }

  return {
    type: node.type,
    ...(node.attrs ? { attrs: cloneAttrs(node.attrs) } : {}),
    ...(node.marks ? { marks: cloneMarks(node.marks) } : {}),
    content: normalizedChildren,
  };
};
