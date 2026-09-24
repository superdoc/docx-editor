import { Plugin, PluginKey } from 'prosemirror-state';
import { Fragment, DOMParser as PMDOMParser, DOMSerializer as PmDOMSerializer, Slice } from 'prosemirror-model';
import { CommandService } from './CommandService.js';
import { chainableEditorState } from './helpers/chainableEditorState.js';
import { getHTMLFromFragment } from './helpers/getHTMLFromFragment.js';
import { warnNoDOM } from './helpers/domWarnings.js';
import { getTextContentFromNodes } from './helpers/getTextContentFromNodes.js';
import { isRegExp } from './utilities/isRegExp.js';
import { handleDocxPaste, wrapTextsInRuns } from './inputRules/docx-paste/docx-paste.js';
import { ListHelpers, createListIdAllocator } from '@helpers/list-numbering-helpers.js';
import { flattenListsInHtml, unflattenListsInHtml } from './inputRules/html/html-helpers.js';
import { handleGoogleDocsHtml } from './inputRules/google-docs-paste/google-docs-paste.js';
import {
  detectPasteUrl,
  handlePlainTextUrlPaste,
  normalizePastedLinks,
  resolveLinkProtocols,
} from './inputRules/paste-link-normalizer.js';
import { getSectPrColumns } from './super-converter/section-properties.js';
import {
  SUPERDOC_SLICE_MIME,
  SUPERDOC_MEDIA_MIME,
  SUPERDOC_SLICE_ATTR,
  SUPERDOC_BODY_SECT_PR_ATTR,
  SUPERDOC_MEDIA_ATTR,
  embedSliceInHtml,
  extractSliceFromHtml,
  stripSliceFromHtml,
  extractBodySectPrFromHtml,
  extractMediaFromHtml,
  bodySectPrShouldEmbed,
  collectReferencedImageMediaForClipboard,
  applySuperdocClipboardMedia,
} from './helpers/superdocClipboardSlice.js';
import { annotateFragmentDomWithClipboardData } from './helpers/clipboardFragmentAnnotate.js';
import { generateRandomSigned32BitIntStrId } from './helpers/generateDocxRandomId.js';

/** Heuristic: clipboard HTML from SuperDoc copy (slice attrs, list/section metadata). */
export function isSuperdocOriginClipboardHtml(html) {
  if (!html || typeof html !== 'string') return false;
  if (
    html.includes(SUPERDOC_SLICE_ATTR) ||
    html.includes(SUPERDOC_BODY_SECT_PR_ATTR) ||
    html.includes(SUPERDOC_MEDIA_ATTR)
  ) {
    return true;
  }
  if (/data-sd-sect-pr\s*=/i.test(html)) {
    return true;
  }
  if (/data-sd-block-id\s*=/i.test(html)) {
    return true;
  }
  if (
    /data-num-id\s*=/i.test(html) &&
    (/data-level\s*=/i.test(html) || /data-list-numbering-type\s*=/i.test(html) || /data-list-level\s*=/i.test(html))
  ) {
    return true;
  }
  return false;
}

/**
 * Apply pasted multi-column `bodySectPr` only when the document is still single-column.
 * Caller supplies how the clone is written (own `tr` vs dispatch).
 *
 * @param {object} editor
 * @param {object | null | undefined} bodySectPr
 * @param {import('prosemirror-model').Node} docForCurrentAttrs
 * @param {(clone: object) => void} applyClone
 */
function applyEmbeddedBodySectPrWhenAllowed(editor, bodySectPr, docForCurrentAttrs, applyClone) {
  if (!bodySectPr || typeof bodySectPr !== 'object') return;

  const incomingCols = getSectPrColumns(bodySectPr);
  if (!incomingCols?.count || incomingCols.count <= 1) return;

  const current = docForCurrentAttrs.attrs?.bodySectPr;
  const currentCols = current && getSectPrColumns(current);
  if (currentCols?.count > 1) return;

  const clone = JSON.parse(JSON.stringify(bodySectPr));
  applyClone(clone);
  if (editor?.converter) {
    editor.converter.bodySectPr = clone;
  }
}

function tryApplyEmbeddedBodySectPr(editor, view, bodySectPr) {
  applyEmbeddedBodySectPrWhenAllowed(editor, bodySectPr, view.state.doc, (clone) => {
    view.dispatch(view.state.tr.setDocAttribute('bodySectPr', clone));
  });
}

function applyEmbeddedBodySectPrToTransaction(editor, tr, bodySectPr, docBeforePaste) {
  applyEmbeddedBodySectPrWhenAllowed(editor, bodySectPr, docBeforePaste, (clone) => {
    tr.setDocAttribute('bodySectPr', clone);
  });
}

export class InputRule {
  match;
  handler;

  constructor(config) {
    this.match = config.match;
    this.handler = config.handler;
  }
}

const inputRuleMatcherHandler = (text, match) => {
  if (isRegExp(match)) {
    return match.exec(text);
  }

  const inputRuleMatch = match(text);

  if (!inputRuleMatch) {
    return null;
  }

  const result = [inputRuleMatch.text];

  result.index = inputRuleMatch.index;
  result.input = text;
  result.data = inputRuleMatch.data;

  if (inputRuleMatch.replaceWith) {
    if (!inputRuleMatch.text.includes(inputRuleMatch.replaceWith)) {
      console.warn('[super-editor warn]: "inputRuleMatch.replaceWith" must be part of "inputRuleMatch.text".');
    }

    result.push(inputRuleMatch.replaceWith);
  }

  return result;
};

const run = (config) => {
  const { editor, from, to, text, rules, plugin } = config;
  const { view } = editor;

  if (view.composing) {
    return false;
  }

  const $from = view.state.doc.resolve(from);

  if (
    $from.parent.type.spec.code ||
    !!($from.nodeBefore || $from.nodeAfter)?.marks.find((mark) => mark.type.spec.code)
  ) {
    return false;
  }

  let matched = false;
  const textBefore = getTextContentFromNodes($from) + text;

  rules.forEach((rule) => {
    if (matched) {
      return;
    }

    const match = inputRuleMatcherHandler(textBefore, rule.match);

    if (!match) {
      return;
    }

    const tr = view.state.tr;
    const state = chainableEditorState(tr, view.state);
    const range = {
      from: from - (match[0].length - text.length),
      to,
    };

    const { commands, chain, can } = new CommandService({
      editor,
      state,
    });

    const handler = rule.handler({
      state,
      range,
      match,
      commands,
      chain,
      can,
    });

    // stop if there are no changes
    if (handler === null || !tr.steps.length) {
      return;
    }

    // store transform as metadata
    // so we can undo input rules within the `undoInputRules` command
    tr.setMeta(plugin, {
      transform: tr,
      from,
      to,
      text,
    });

    view.dispatch(tr);
    matched = true;
  });

  return matched;
};

/**
 * Create an input rules plugin. When enabled, it will cause text
 * input that matches any of the given rules to trigger the rule’s
 * action.
 */
export const inputRulesPlugin = ({ editor, rules }) => {
  const plugin = new Plugin({
    key: new PluginKey('inputRulesPlugin'),

    state: {
      init() {
        return null;
      },

      apply(tr, prev, state) {
        const stored = tr.getMeta(plugin);

        if (stored) {
          return stored;
        }

        // if InputRule is triggered by insertContent()
        const simulatedInputMeta = tr.getMeta('applyInputRules');
        const isSimulatedInput = !!simulatedInputMeta;

        if (isSimulatedInput) {
          setTimeout(() => {
            let { text } = simulatedInputMeta;

            if (typeof text !== 'string') {
              const domDocument =
                editor?.options?.document ??
                editor?.options?.mockDocument ??
                (typeof document !== 'undefined' ? document : null);

              if (!domDocument) {
                warnNoDOM('HTML conversion for input rules');
                return;
              }

              text = getHTMLFromFragment(Fragment.from(text), state.schema, domDocument);
            }

            const { from } = simulatedInputMeta;
            const to = from + text.length;

            run({
              editor,
              from,
              to,
              text,
              rules,
              plugin,
            });
          });
        }

        return tr.selectionSet || tr.docChanged ? null : prev;
      },
    },

    props: {
      handleDOMEvents: {
        cut: (view, event) => handleCutEvent(view, event, editor),
      },

      handleTextInput(view, from, to, text) {
        return run({
          editor,
          from,
          to,
          text,
          rules,
          plugin,
        });
      },

      // add support for input rules to trigger on enter
      // this is useful for example for code blocks
      handleKeyDown(view, event) {
        if (event.key !== 'Enter') {
          return false;
        }

        const { $cursor } = view.state.selection;

        if ($cursor) {
          return run({
            editor,
            from: $cursor.pos,
            to: $cursor.pos,
            text: '\n',
            rules,
            plugin,
          });
        }

        return false;
      },

      // Paste handler
      handlePaste(view, event, slice) {
        const clipboard = event.clipboardData;

        // Allow specialised plugins (e.g., field-annotation) first shot.
        const fieldAnnotationContent = slice.content.content.filter((item) => item.type.name === 'fieldAnnotation');
        if (fieldAnnotationContent.length) {
          return false;
        }

        const rawHtml = clipboard.getData('text/html');
        const isSuperdocHtml = isSuperdocOriginClipboardHtml(rawHtml);
        const embeddedBodySectPr = isSuperdocHtml ? extractBodySectPrFromHtml(rawHtml) : null;
        const embeddedMedia = isSuperdocHtml ? extractMediaFromHtml(rawHtml) : '';

        let superdocSliceData = clipboard.getData(SUPERDOC_SLICE_MIME) || extractSliceFromHtml(rawHtml);
        if (isSuperdocHtml || superdocSliceData) {
          superdocSliceData = applySuperdocClipboardMedia(editor, clipboard, superdocSliceData || null, embeddedMedia);
        }
        if (superdocSliceData) {
          try {
            if (handleSuperdocSlicePaste(superdocSliceData, editor, view, embeddedBodySectPr)) return true;
          } catch (err) {
            console.warn('Failed to paste SuperDoc slice, falling back to HTML:', err);
          }
        }

        const html = stripSliceFromHtml(rawHtml);
        const plainText = clipboard.getData('text/plain');
        // SuperDoc HTML is still Word-shaped; use HTML paste, not DOCX converter.
        if (isSuperdocHtml) {
          const ok = handleHtmlPaste(html, editor);
          if (ok && embeddedBodySectPr) {
            tryApplyEmbeddedBodySectPr(editor, view, embeddedBodySectPr);
          }
          return ok;
        }
        const result = handleClipboardPaste({ editor, view }, html, plainText);
        return result;
      },
    },

    isInputRules: true,
  });
  return plugin;
};

export function isWordHtml(html) {
  return /class=["']?Mso|xmlns:o=["']?urn:schemas-microsoft-com|<!--\[if gte mso|<meta[^>]+name=["']?Generator["']?[^>]+Word/i.test(
    html,
  );
}

function isGoogleDocsHtml(html) {
  return /docs-internal-guid-/.test(html);
}

/**
 * Finds the first paragraph ancestor of a resolved position.
 *
 * @param {ResolvedPos} $from The resolved position to search from.
 * @returns {{ node: Node | null, depth: number }} The paragraph node and its depth, or null if not found.
 */
function findParagraphAncestor($from) {
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'paragraph') {
      return { node, depth: d };
    }
  }
  return { node: null, depth: -1 };
}

/**
 * @param {import('prosemirror-model').Node} tableRow
 * @returns {string}
 */
function getTableRowSignature(tableRow) {
  const parts = [];
  tableRow.forEach((cell) => {
    parts.push(`${cell.attrs?.colspan ?? 1}:${cell.attrs?.rowspan ?? 1}`);
  });
  return parts.join('|');
}

/**
 * Browser "highlight copy" can emit table-like HTML where each visual row
 * becomes an independent table element. Merge adjacent compatible tables back
 * into one table so table editing features (cell selection, resizing) work.
 *
 * @param {import('prosemirror-model').Node} doc
 * @returns {import('prosemirror-model').Node}
 */
function mergeAdjacentTableFragments(doc) {
  if (!doc?.childCount) return doc;

  /** @type {import('prosemirror-model').Node[]} */
  const mergedChildren = [];

  doc.forEach((child) => {
    const previous = mergedChildren[mergedChildren.length - 1];

    if (child.type.name !== 'table' || previous?.type.name !== 'table') {
      mergedChildren.push(child);
      return;
    }

    const previousFirstRow = previous.firstChild;
    const currentFirstRow = child.firstChild;
    if (!previousFirstRow || !currentFirstRow) {
      mergedChildren.push(child);
      return;
    }

    const previousColumnShape = getTableRowSignature(previousFirstRow);
    const currentColumnShape = getTableRowSignature(currentFirstRow);
    if (previousColumnShape !== currentColumnShape) {
      mergedChildren.push(child);
      return;
    }

    const combinedRows = [];
    previous.forEach((row) => combinedRows.push(row));
    child.forEach((row) => combinedRows.push(row));

    mergedChildren[mergedChildren.length - 1] = previous.type.create(previous.attrs, combinedRows, previous.marks);
  });

  return doc.copy(Fragment.fromArray(mergedChildren));
}

/**
 * Handle HTML paste events.
 *
 * @param {String} html The HTML string to be pasted.
 * @param {Editor} editor The editor instance.
 * @param {String} source HTML content source
 * @returns {Boolean} Returns true if the paste was handled.
 */
export function handleHtmlPaste(html, editor, source) {
  let cleanedHtml;
  if (source === 'google-docs') cleanedHtml = handleGoogleDocsHtml(html, editor);
  else cleanedHtml = htmlHandler(html, editor);

  // Mark pasted HTML as import content so table parseDOM rules can apply
  // import defaults (e.g., default table width to 100%).
  if (cleanedHtml?.dataset) {
    cleanedHtml.dataset.superdocImport = 'true';
  }

  let doc = PMDOMParser.fromSchema(editor.schema).parse(cleanedHtml);
  doc = mergeAdjacentTableFragments(doc);

  doc = wrapTextsInRuns(doc);

  const { dispatch, state } = editor.view;
  if (!dispatch) {
    return false;
  }

  doc = doc.copy(reidentifyPastedContentControls(doc.content, state.doc));

  // Check if we're pasting into an existing paragraph
  // Need to check ancestors since cursor might be inside a run node within a paragraph
  const { $from } = state.selection;

  // Find if any ancestor is a paragraph
  const { node: paragraphNode } = findParagraphAncestor($from);

  const isInParagraph = paragraphNode !== null;

  // Check if the pasted content is a single paragraph
  const isSingleParagraph = doc.childCount === 1 && doc.firstChild.type.name === 'paragraph';

  // Heading paragraphs must keep their wrapper so the styleId survives —
  // unwrapping silently strips the heading style and TOC rebuilds miss it.
  const sourceStyleId = isSingleParagraph ? (doc.firstChild.attrs?.paragraphProperties?.styleId ?? null) : null;
  const sourceIsHeading = typeof sourceStyleId === 'string' && /^Heading[1-9]$/i.test(sourceStyleId);

  if (isInParagraph && isSingleParagraph && !sourceIsHeading) {
    // Extract the contents of the paragraph and paste only those
    const paragraphContent = doc.firstChild.content;
    const tr = state.tr.replaceSelectionWith(paragraphContent, false);
    normalizePastedLinks(tr, editor);
    dispatch(tr);
  } else if (isInParagraph) {
    // For multi-paragraph paste, use replaceSelection with a proper Slice
    // This preserves the paragraph structure instead of flattening with \n
    // Create a slice from the doc's content (the paragraphs)
    const slice = new Slice(doc.content, 0, 0);

    const tr = state.tr.replaceSelection(slice);
    normalizePastedLinks(tr, editor);
    dispatch(tr);
  } else {
    // Use the original behavior for other cases
    const tr = state.tr.replaceSelectionWith(doc, true);
    normalizePastedLinks(tr, editor);
    dispatch(tr);
  }

  return true;
}
/**
 * Handle HTML content before it is inserted into the editor.
 * This function is used to clean and sanitize HTML content,
 * converting em units to pt and removing unnecessary tags.
 * @param {String} html The HTML string to be processed.
 * @param {Editor} editor The editor instance.
 * @returns {DocumentFragment} The processed HTML string.
 */
export function htmlHandler(html, editor, domDocument) {
  const resolvedDocument =
    domDocument ??
    editor?.options?.document ??
    editor?.options?.mockDocument ??
    (typeof document !== 'undefined' ? document : null);

  const flatHtml = flattenListsInHtml(html, editor, resolvedDocument);
  const htmlWithPtSizing = convertEmToPt(flatHtml);
  return sanitizeHtml(htmlWithPtSizing, undefined, resolvedDocument);
}

/**
 * Process the HTML string to convert em units to pt units in font-size
 *
 * @param {String} html The HTML string to be processed.
 * @returns {String} The processed HTML string with em units converted to pt units.
 */
export const convertEmToPt = (html) => {
  return html.replace(/font-size\s*:\s*([\d.]+)em/gi, (_, emValue) => {
    const em = parseFloat(emValue);
    const pt = Math.round(em * 12 * 100) / 100; // e.g. 1.5×12 = 18.00
    return `font-size: ${pt}pt`;
  });
};

/**
 *  Cleans and sanitizes HTML content by removing unnecessary tags, entities, and extra whitespace.
 *
 * @param {String} html The HTML string to be processed.
 * @returns {String} The processed HTML string with em units converted to pt units.
 */
export function cleanHtmlUnnecessaryTags(html) {
  return html
    .replace(/<o:p>.*?<\/o:p>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<span[^>]*>\s*<\/span>/gi, '')
    .replace(/<p[^>]*>\s*<\/p>/gi, '')
    .trim();
}

/**
 * Recursive function to sanitize HTML and remove forbidden tags.
 * @param {string} html The HTML string to be sanitized.
 * @param {string[]} forbiddenTags The list of forbidden tags to remove from the HTML.
 * @returns {DocumentFragment} The sanitized HTML as a DocumentFragment.
 */
export function sanitizeHtml(html, forbiddenTags = ['meta', 'svg', 'script', 'style', 'button'], domDocument) {
  const resolvedDocument = domDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!resolvedDocument) {
    console.warn(
      '[super-editor] HTML sanitization requires a DOM. Provide { document } (e.g. from JSDOM), set DOM globals, or run in a browser environment. Skipping sanitization.',
    );
    return null;
  }

  const container = resolvedDocument.createElement('div');
  container.innerHTML = html;
  const domNode = resolvedDocument.defaultView?.Node ?? globalThis.Node;
  const COMMENT_NODE = domNode?.COMMENT_NODE ?? 8;
  const ELEMENT_NODE = domNode?.ELEMENT_NODE ?? 1;

  // Strip Word conditional list-marker spans so paste does not duplicate markers.
  const stripWordListConditionalPrefixes = (root) => {
    const stripFromNode = (node) => {
      if (!node?.childNodes) return;

      for (let i = 0; i < node.childNodes.length; i += 1) {
        const current = node.childNodes[i];
        if (current?.nodeType === COMMENT_NODE && current.nodeValue?.includes('[if !supportLists]')) {
          const nodesToStrip = [];
          let endifComment = null;
          for (let j = i + 1; j < node.childNodes.length; j += 1) {
            const next = node.childNodes[j];
            if (next?.nodeType === COMMENT_NODE && next.nodeValue?.includes('[endif]')) {
              endifComment = next;
              break;
            }
            nodesToStrip.push(next);
          }
          if (!endifComment) {
            node.removeChild(current);
            i -= 1;
            continue;
          }
          for (const n of nodesToStrip) {
            node.removeChild(n);
          }
          node.removeChild(endifComment);
          node.removeChild(current);
          i -= 1;
          continue;
        }

        if (current?.nodeType === ELEMENT_NODE) {
          stripFromNode(current);
        }
      }
    };

    stripFromNode(root);
  };

  stripWordListConditionalPrefixes(container);

  const walkAndClean = (node) => {
    for (const child of [...node.children]) {
      if (forbiddenTags.includes(child.tagName.toLowerCase())) {
        child.remove();
        continue;
      }

      // Internal/runtime-only attributes must not be preserved across paste.
      if (child.hasAttribute('linebreaktype')) {
        child.removeAttribute('linebreaktype');
      }
      if (child.hasAttribute('data-sd-block-id')) {
        child.removeAttribute('data-sd-block-id');
      }

      walkAndClean(child);
    }
  };

  walkAndClean(container);
  return container;
}

/**
 * Handles clipboard content that was read outside the native paste event, such
 * as the context-menu Paste action.
 *
 * @param {Object}   params
 * @param {Editor}   params.editor  The SuperEditor instance.
 * @param {View}     params.view    The ProseMirror view associated with the editor.
 * @param {String}   html           HTML clipboard content (may be empty).
 * @param {String}   [plainText]    Plain-text clipboard content (may be empty).
 * @returns {Boolean}               Whether the paste was handled.
 */
export function handleClipboardPaste({ editor, view }, html, plainText) {
  const rawHtml = html || '';
  const isSuperdocHtml = isSuperdocOriginClipboardHtml(rawHtml);
  const embeddedBodySectPr = isSuperdocHtml ? extractBodySectPrFromHtml(rawHtml) : null;
  const embeddedMedia = isSuperdocHtml ? extractMediaFromHtml(rawHtml) : '';
  let pasteHtml = rawHtml;

  let superdocSliceData = extractSliceFromHtml(rawHtml);
  if (superdocSliceData) {
    superdocSliceData = applySuperdocClipboardMedia(editor, null, superdocSliceData, embeddedMedia);
    try {
      if (handleSuperdocSlicePaste(superdocSliceData, editor, view, embeddedBodySectPr)) return true;
    } catch (err) {
      console.warn('Failed to paste SuperDoc slice, falling back to HTML:', err);
    }
  }

  if (isSuperdocHtml) {
    pasteHtml = stripSliceFromHtml(rawHtml);
  }

  let source;

  if (!pasteHtml) {
    source = 'plain-text';
  } else if (isWordHtml(pasteHtml)) {
    source = 'word-html';
  } else if (isGoogleDocsHtml(pasteHtml)) {
    source = 'google-docs';
  } else {
    source = 'browser-html';
  }

  switch (source) {
    case 'plain-text': {
      const protocols = resolveLinkProtocols(editor);
      const detected = detectPasteUrl(plainText, protocols);
      if (!detected) return false;
      return handlePlainTextUrlPaste(editor, view, plainText, detected);
    }
    case 'word-html':
      if (editor.options.mode === 'docx' && !isSuperdocHtml) {
        return handleDocxPaste(pasteHtml, editor, view);
      }
      {
        const ok = handleHtmlPaste(pasteHtml, editor);
        if (ok && embeddedBodySectPr) {
          tryApplyEmbeddedBodySectPr(editor, view, embeddedBodySectPr);
        }
        return ok;
      }
    case 'google-docs': {
      const ok = handleGoogleDocsHtml(pasteHtml, editor, view);
      if (ok && embeddedBodySectPr) {
        tryApplyEmbeddedBodySectPr(editor, view, embeddedBodySectPr);
      }
      return ok;
    }
    // falls through to browser-html handling when not in DOCX mode
    case 'browser-html': {
      const ok = handleHtmlPaste(pasteHtml, editor);
      if (ok && embeddedBodySectPr) {
        tryApplyEmbeddedBodySectPr(editor, view, embeddedBodySectPr);
      }
      return ok;
    }
  }

  return false;
}

/** Cut: put slice + annotated HTML on clipboard, then delete selection (copy uses ProseMirrorRenderer). */
function handleCutEvent(view, event, editor) {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return false;

  const { from, to } = view.state.selection;
  if (from === to) return false;

  try {
    const slice = view.state.doc.slice(from, to);
    const fragment = slice.content;
    const sliceJson = JSON.stringify(slice.toJSON());

    clipboardData.setData(SUPERDOC_SLICE_MIME, sliceJson);
    const mediaJson = collectReferencedImageMediaForClipboard(sliceJson, editor);
    if (mediaJson) {
      clipboardData.setData(SUPERDOC_MEDIA_MIME, mediaJson);
    }

    const div = document.createElement('div');
    const serializer = PmDOMSerializer.fromSchema(view.state.schema);
    div.appendChild(serializer.serializeFragment(fragment));

    annotateFragmentDomWithClipboardData(div, fragment, editor);

    const html = unflattenListsInHtml(div.innerHTML);
    const bodySectPr = view.state.doc.attrs?.bodySectPr;
    const bodySectPrJson = bodySectPr && bodySectPrShouldEmbed(bodySectPr) ? JSON.stringify(bodySectPr) : '';
    clipboardData.setData('text/html', embedSliceInHtml(html, sliceJson, bodySectPrJson, mediaJson));
    clipboardData.setData('text/plain', fragment.textBetween(0, fragment.size, '\n\n'));

    event.preventDefault();
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    return true;
  } catch (error) {
    console.warn('Failed to handle cut:', error);
    return false;
  }
}

const BULLET_MARKER_CHARS = new Set(['•', '◦', '▪', '\u2022', '\u25E6', '\u25AA']);

function numberingFmtForSliceRemap(lr) {
  if (lr?.numberingType) {
    return lr.numberingType;
  }
  const marker = (lr?.markerText || '').trim();
  if (marker && BULLET_MARKER_CHARS.has(marker)) {
    return 'bullet';
  }
  return 'decimal';
}

function lvlTextForRemap(fmt, ilvl, lr) {
  if (fmt === 'bullet') {
    return lr?.markerText?.trim() || '•';
  }
  const stored = lr?.markerText;
  if (stored?.includes?.('%')) {
    return stored;
  }
  return `%${ilvl + 1}.`;
}

/** Remap pasted list numIds and rebuild defs so target doc’s abstract ids don’t clash. */
function remapPastedListNumberingInFragment(fragment, editor) {
  if (!editor?.converter || !fragment.size) {
    return fragment;
  }

  /** @type {Array<{ oldId: number, ilvl: number, fmt: string, lr: object | null | undefined, path: number[] | null }>} */
  const paragraphMeta = [];

  const collect = (node) => {
    if (node.type.name === 'paragraph') {
      const np = node.attrs.paragraphProperties?.numberingProperties;
      if (np?.numId != null) {
        const oldId = Number(np.numId);
        if (Number.isFinite(oldId)) {
          const rawIlvl = Number(np.ilvl ?? 0);
          const ilvl = Number.isFinite(rawIlvl) ? rawIlvl : 0;
          const lr = node.attrs.listRendering;
          const fmt = numberingFmtForSliceRemap(lr);
          const path = Array.isArray(lr?.path) ? lr.path.map((n) => Number(n)) : null;
          paragraphMeta.push({ oldId, ilvl, fmt, lr, path });
        }
      }
    }
    if (node.content?.size) {
      node.content.forEach((child) => collect(child));
    }
  };

  fragment.forEach((node) => collect(node));

  if (paragraphMeta.length === 0) {
    return fragment;
  }

  const oldToNew = new Map();
  const allocateListId = createListIdAllocator(editor);
  for (const { oldId } of paragraphMeta) {
    if (!oldToNew.has(oldId)) {
      oldToNew.set(oldId, allocateListId());
    }
  }

  const generatedLevels = new Set();

  for (const { oldId, ilvl, fmt, lr, path } of paragraphMeta) {
    const newId = oldToNew.get(oldId);
    const genKey = `${newId}:${ilvl}`;
    if (generatedLevels.has(genKey)) {
      continue;
    }

    const listType = fmt === 'bullet' ? 'bulletList' : 'orderedList';
    let start = 1;
    if (Array.isArray(path) && path.length) {
      const atLevel = path[ilvl];
      const parsedAt = Number(atLevel);
      if (Number.isFinite(parsedAt)) {
        start = parsedAt;
      } else {
        const tail = Number(path[path.length - 1]);
        if (Number.isFinite(tail)) {
          start = tail;
        }
      }
    }

    const lvlText = lvlTextForRemap(fmt, ilvl, lr);

    ListHelpers.generateNewListDefinition({
      numId: newId,
      listType,
      level: String(ilvl),
      start: String(start),
      text: lvlText,
      fmt,
      editor,
    });

    if (start > 1) {
      ListHelpers.setLvlOverride(editor, newId, ilvl, { startOverride: start });
    }

    generatedLevels.add(genKey);
  }

  const rewriteFragment = (frag) => {
    const out = [];
    frag.forEach((node) => {
      out.push(rewriteNode(node));
    });
    return Fragment.fromArray(out);
  };

  const rewriteNode = (node) => {
    if (node.type.name === 'paragraph') {
      const np = node.attrs.paragraphProperties?.numberingProperties;
      if (np?.numId != null) {
        const oldId = Number(np.numId);
        if (oldToNew.has(oldId)) {
          const nextNp = { ...np, numId: oldToNew.get(oldId) };
          const pp = { ...node.attrs.paragraphProperties, numberingProperties: nextNp };
          const attrs = { ...node.attrs, paragraphProperties: pp };
          return node.type.create(attrs, node.content, node.marks);
        }
      }
      return node;
    }

    if (node.content?.size) {
      const nextContent = rewriteFragment(node.content);
      if (nextContent !== node.content) {
        return node.copy(nextContent);
      }
    }

    return node;
  };

  return rewriteFragment(fragment);
}

function handleSuperdocSlicePaste(sliceData, editor, view, embeddedBodySectPr = null) {
  const sliceJson = JSON.parse(sliceData);
  const slice = Slice.fromJSON(editor.schema, sliceJson);

  if (!slice.content.size) return false;

  const { dispatch, state } = view;
  if (!dispatch) return false;

  const stripped = stripSuperdocSliceBlockIdentities(slice.content);
  const reidentified = reidentifyPastedContentControls(stripped, state.doc);
  const cleanContent = remapPastedListNumberingInFragment(reidentified, editor);
  const cleanSlice = new Slice(cleanContent, slice.openStart, slice.openEnd);

  const tr = state.tr.replaceSelection(cleanSlice);
  tr.setMeta('superdocSlicePaste', true);
  normalizePastedLinks(tr, editor);
  if (embeddedBodySectPr) {
    applyEmbeddedBodySectPrToTransaction(editor, tr, embeddedBodySectPr, state.doc);
  }
  dispatch(tr.scrollIntoView());

  return true;
}

/**
 * Attrs cleared per node type when pasting a SuperDoc slice. Import uses
 * {@link ./super-converter/v2/importer/normalizeDuplicateBlockIdentitiesInContent.js}
 * so in-doc IDs are unique; slice paste must not keep `paraId` / legacy table ids /
 * structured `id` from the copy source or `resolveBlockNodeId` will expose duplicate
 * public block IDs (paragraphs prefer `paraId` over `sdBlockId`).
 *
 * @type {Record<string, Record<string, null | number>>}
 */
const SUPERDOC_SLICE_PASTE_IDENTITY_RESETS = {
  paragraph: { paraId: null, sdBlockId: null, sdBlockRev: 0 },
  table: { paraId: null, sdBlockId: null },
  tableRow: { paraId: null, sdBlockId: null },
  tableCell: { paraId: null, sdBlockId: null },
  tableHeader: { sdBlockId: null },
  structuredContentBlock: { id: null },
  documentSection: { id: null, sdBlockId: null },
  documentPartObject: { id: null, sdBlockId: null },
  tableOfContents: { sdBlockId: null },
};

/**
 * @param {import('prosemirror-model').Fragment} fragment
 */
function stripSuperdocSliceBlockIdentities(fragment) {
  const children = [];
  fragment.forEach((node) => {
    const resets = SUPERDOC_SLICE_PASTE_IDENTITY_RESETS[node.type.name];
    let newContent = node.content;
    if (node.childCount) {
      const strippedChildren = stripSuperdocSliceBlockIdentities(node.content);
      if (strippedChildren !== node.content) {
        newContent = strippedChildren;
      }
    }

    let newNode = node;
    if (resets) {
      const cleanAttrs = { ...node.attrs, ...resets };
      newNode = node.type.create(cleanAttrs, newContent, node.marks);
    } else if (newContent !== node.content) {
      newNode = node.copy(newContent);
    }

    children.push(newNode);
  });

  return Fragment.fromArray(children);
}

function reidentifyPastedContentControls(fragment, document) {
  const usedIds = new Set();
  let collectedDocumentIds = false;

  const nextId = () => {
    if (!collectedDocumentIds) {
      document.descendants((node) => {
        if (node.type.name === 'structuredContent' || node.type.name === 'structuredContentBlock') {
          if (node.attrs.id != null) usedIds.add(String(node.attrs.id));
        }
      });
      collectedDocumentIds = true;
    }
    let candidate = generateRandomSigned32BitIntStrId();
    while (usedIds.has(candidate)) {
      candidate = String((Number(candidate) + 1) % 2147483647);
    }
    usedIds.add(candidate);
    return candidate;
  };

  const remap = (content) => {
    const children = [];
    let changed = false;
    content.forEach((node) => {
      const nextContent = node.childCount ? remap(node.content) : node.content;
      const isControl = node.type.name === 'structuredContent' || node.type.name === 'structuredContentBlock';
      if (isControl) {
        children.push(node.type.create({ ...node.attrs, id: nextId() }, nextContent, node.marks));
        changed = true;
      } else if (nextContent !== node.content) {
        children.push(node.copy(nextContent));
        changed = true;
      } else {
        children.push(node);
      }
    });
    return changed ? Fragment.fromArray(children) : content;
  };

  return remap(fragment);
}
