// @ts-check
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { generateLinkedStyleString, getLinkedStyle, stepInsertsTextIntoStyledParagraph } from './helpers.js';
import {
  calculateResolvedParagraphProperties,
  getResolvedParagraphProperties,
} from '@extensions/paragraph/resolvedPropertiesCache.js';

/**
 * Plugin key for accessing linked styles state
 */
export const LinkedStylesPluginKey = new PluginKey('linkedStyles');

/**
 * Create the linked styles ProseMirror plugin
 * @category Helper
 * @param {Object} editor - The editor instance
 * @returns {Object} The linked styles plugin
 * @example
 * const plugin = createLinkedStylesPlugin(editor);
 * @note Only activates in docx mode with converter available
 * @note Generates decorations for visual style application
 */
export const createLinkedStylesPlugin = (editor) => {
  return new Plugin({
    key: LinkedStylesPluginKey,
    state: {
      /**
       * Initialize plugin state with styles and decorations
       * @returns {Object} Initial state with styles and decorations
       * @private
       */
      init() {
        if (!editor.converter || editor.options.mode !== 'docx') return {};
        // Linked-style decorations are a VIEW concern (inline CSS painted by the
        // EditorView / PresentationEditor). A headless editor has no view, and a
        // PresentationEditor paints styles via its own resolver — in both cases
        // the decorations are never consumed, but `generateDecorations` walks the
        // WHOLE document (resolve + style-string build) on every transaction.
        // For a batch of N tracked edits that is O(N * doc) — ~50s on a 38-page
        // doc. Skip generation in those modes; `styles` is still exposed for
        // setStyleById / getStyles consumers.
        if (editor.presentationEditor || editor.options?.isHeadless) {
          return { styles: editor.converter?.linkedStyles || [], decorations: DecorationSet.empty };
        }
        const styles = editor.converter?.linkedStyles || [];
        return {
          styles,
          decorations: generateDecorations(editor.state, styles),
        };
      },
      /**
       * Update decorations when document changes
       * @param {Object} tr - The transaction
       * @param {Object} prev - Previous plugin state
       * @param {Object} oldEditorState - Old editor state
       * @param {Object} newEditorState - New editor state
       * @returns {Object} Updated state with styles and decorations
       * @private
       */
      apply(tr, prev, oldEditorState, newEditorState) {
        if (!editor.converter || editor.options.mode !== 'docx') return { ...prev };
        // See init(): headless / presentation editors never consume these
        // decorations, so skip the whole-document regeneration on every tx.
        if (editor.presentationEditor || editor.options?.isHeadless) {
          return { ...prev, decorations: DecorationSet.empty };
        }

        // Redefinition signal: a style's definition was mutated in place (no doc
        // change). Regenerate decorations from the current styles so the
        // redefinition becomes visible without faking a document edit.
        if (tr.getMeta(LinkedStylesPluginKey)?.stylesChanged) {
          const styles = editor.converter?.linkedStyles || [];
          return { ...prev, styles, decorations: generateDecorations(newEditorState, styles) };
        }

        let decorations = prev.decorations || DecorationSet.empty;

        // Only regenerate decorations when styles are affected
        if (tr.docChanged) {
          let mightAffectStyles = false;

          // Style-related mark types that affect linked styles
          const styleRelatedMarks = new Set(['textStyle', 'bold', 'italic', 'underline', 'strike']);

          tr.steps.forEach((step, index) => {
            if (step.slice) {
              step.slice.content.descendants((node, pos) => {
                if (node.type.name === 'paragraph') {
                  const paragraphProps = calculateResolvedParagraphProperties(
                    editor,
                    node,
                    newEditorState.doc.resolve(pos),
                  );
                  if (paragraphProps.styleId) {
                    mightAffectStyles = true;
                  }
                  return false;
                }
                // Check if any marks are style-related
                if (node.marks.length > 0) {
                  const hasStyleMarks = node.marks.some((mark) => styleRelatedMarks.has(mark.type.name));
                  if (hasStyleMarks) {
                    mightAffectStyles = true;
                    return false;
                  }
                }
              });
            }

            // Only check mark additions/removals for style-related marks
            if (step.jsonID === 'addMark' || step.jsonID === 'removeMark') {
              if (step.mark && styleRelatedMarks.has(step.mark.type.name)) {
                mightAffectStyles = true;
              }
            }

            if (!mightAffectStyles && stepInsertsTextIntoStyledParagraph(tr, oldEditorState, step, index)) {
              mightAffectStyles = true;
            }
          });

          if (mightAffectStyles) {
            const styles = LinkedStylesPluginKey.getState(editor.state).styles;
            decorations = generateDecorations(newEditorState, styles);
          } else {
            decorations = decorations.map(tr.mapping, tr.doc);
          }
        }

        return { ...prev, decorations };
      },
    },
    props: {
      /**
       * Provide decorations to the editor view
       * @param {Object} state - Current editor state
       * @returns {Object} The decoration set
       * @private
       */
      decorations(state) {
        return LinkedStylesPluginKey.getState(state)?.decorations;
      },
    },
  });
};

/**
 * Generate style decorations for linked styles
 * @category Helper
 * @param {Object} state - Editor state
 * @param {Array} styles - The linked styles array
 * @returns {Object} The decoration set for visual styling
 * @example
 * const decorations = generateDecorations(editorState, linkedStyles);
 * @note Creates inline decorations with CSS styles
 * @note Respects style inheritance and mark precedence
 * @private
 */
const generateDecorations = (state, styles) => {
  const decorations = [];
  const doc = state?.doc;

  // Early return if no doc or state
  if (!doc || !state) return DecorationSet.empty;

  const getParagraphStyleId = (pos) => {
    const $pos = state.doc.resolve(pos);
    for (let d = $pos.depth; d >= 0; d--) {
      const n = $pos.node(d);
      if (n?.type?.name === 'paragraph') {
        const paragraphProps = getResolvedParagraphProperties(n);
        return paragraphProps.styleId || null;
      }
    }
    return null;
  };

  doc.descendants((node, pos) => {
    const { name } = node.type;
    if (name !== 'text') return;

    const paragraphStyleId = getParagraphStyleId(pos);
    let runStyleId = null;
    let inlineTextStyleId = null;
    for (const mark of node.marks) {
      if (mark.type.name === 'run') {
        const rp = mark.attrs?.runProperties;
        if (rp && typeof rp === 'object' && !Array.isArray(rp) && rp.styleId) runStyleId = rp.styleId;
        else if (Array.isArray(rp)) {
          const ent = rp.find((e) => e?.xmlName === 'w:rStyle');
          const sid = ent?.attributes?.['w:val'];
          if (sid) runStyleId = sid;
        }
      } else if (mark.type.name === 'textStyle' && mark.attrs?.styleId) {
        inlineTextStyleId = mark.attrs.styleId;
      }
    }

    // Merge paragraph -> inlineText -> run styles
    const buildStyleMap = (sid) => {
      if (!sid) return {};
      const { linkedStyle, basedOnStyle } = getLinkedStyle(sid, styles);
      if (!linkedStyle) return {};
      const base = { ...(basedOnStyle?.definition?.styles || {}) };
      return { ...base, ...(linkedStyle.definition?.styles || {}) };
    };

    const pMap = buildStyleMap(paragraphStyleId);
    let tMap;
    if (paragraphStyleId?.startsWith('TOC')) {
      // Word ignores inline text styles for text in TOC paragraphs, so we do the same
      tMap = {};
    } else {
      tMap = buildStyleMap(inlineTextStyleId);
    }
    const rMap = buildStyleMap(runStyleId);
    const finalStyles = { ...pMap, ...tMap, ...rMap };
    if (Object.keys(finalStyles).length === 0) return;

    const mergedLinkedStyle = { definition: { styles: finalStyles, attrs: {} } };
    const basedOnStyle = null;

    const $pos = state.doc.resolve(pos);
    const parent = $pos.parent;
    const styleString = generateLinkedStyleString(mergedLinkedStyle, basedOnStyle, node, parent);
    if (!styleString) return;

    const decoration = Decoration.inline(pos, pos + node.nodeSize, { style: styleString });
    decorations.push(decoration);
  });

  return DecorationSet.create(doc, decorations);
};
