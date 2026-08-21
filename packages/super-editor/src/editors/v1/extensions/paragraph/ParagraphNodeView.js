import { Attribute } from '@core/Attribute.js';
import { twipsToPixels } from '@converter/helpers.js';
import { extractParagraphContext, calculateTabStyle } from '../tab/helpers/tabDecorations.js';
import { resolveRunProperties, encodeCSSFromRPr, encodeCSSFromPPr } from '@converter/styles.js';
import { isList } from '@core/commands/list-helpers';
import { getResolvedParagraphProperties, calculateResolvedParagraphProperties } from './resolvedPropertiesCache.js';

/**
 * A map to keep track of paragraph node views for quick access.
 * @type {WeakMap<import('prosemirror-model').Node, ParagraphNodeView>}
 */
const nodeViewMap = new WeakMap();

/**
 * Pattern 1 fallback for header/footer PM DOM:
 * infer RTL paragraph direction only when all explicit-direction runs are RTL
 * and no explicit LTR run exists.
 * @param {import('prosemirror-model').Node} node
 * @returns {boolean}
 */
function inferParagraphRtlFromRuns(node) {
  const fragment = node?.content;
  if (!fragment || !fragment.childCount) return false;
  let hasExplicitRtl = false;

  for (let i = 0; i < fragment.childCount; i++) {
    const child = fragment.child(i);
    if (child.type.name !== 'run') continue;
    const runProperties = child.attrs?.runProperties || {};
    const isRtl = runProperties.rightToLeft === true || runProperties.rtl === true;
    const isLtr = runProperties.rightToLeft === false || runProperties.rtl === false;
    if (isLtr) return false;
    if (isRtl) hasExplicitRtl = true;
  }

  return hasExplicitRtl;
}

/**
 * ProseMirror node view that renders paragraphs, including special handling for
 * numbered/bulleted lists so marker/separator elements stay in sync with docx
 * layout expectations.
 */
export class ParagraphNodeView {
  /**
   * @param {import('prosemirror-model').Node} node Current paragraph node.
   * @param {import('../../core/Editor').Editor} editor Editor instance providing schema/helpers.
   * @param {() => number} getPos Position getter provided by ProseMirror.
   * @param {import('prosemirror-view').Decoration[]} decorations Decorations applied to this node.
   * @param {Record<string, unknown>} extensionAttrs Extra attributes declared by the paragraph extension.
   */
  constructor(node, editor, getPos, decorations, extensionAttrs) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;
    this.decorations = decorations;
    this.extensionAttrs = extensionAttrs;
    this._animationFrameRequest = null;
    this.surroundingContext = {};
    nodeViewMap.set(this.node, this);

    calculateResolvedParagraphProperties(this.editor, this.node, this.editor.state.doc.resolve(this.getPos()));

    this.dom = document.createElement('p');
    const contentEl = document.createElement('span');
    contentEl.classList.add('sd-paragraph-content');

    this.contentDOM = contentEl;
    this.dom.appendChild(this.contentDOM);
    if (this.#checkIsList()) {
      this.#initList(node.attrs.listRendering);
      this.#scheduleAnimation(() => {
        if (!this.#checkIsList()) {
          return;
        }
        this.#updateListStyles();
      });
    }
    this.#updateHTMLAttributes();
    this.#updateDOMStyles();
  }

  /**
   * @param {import('prosemirror-model').Node} node
   * @param {import('prosemirror-view').Decoration[]} decorations
   * @param {import('prosemirror-view').Decoration[]} innerDecorations
   * @param {boolean} [forceUpdate=false]
   * @returns {boolean}
   */
  update(node, decorations, innerDecorations, forceUpdate = false) {
    // Remove cached reference for old node
    if (nodeViewMap.get(this.node) === this) {
      nodeViewMap.delete(this.node);
    }
    const oldProps = getResolvedParagraphProperties(this.node);
    const oldAttrs = this.node.attrs;
    this.node = node;
    this.decorations = decorations;
    this.innerDecorations = innerDecorations;
    nodeViewMap.set(this.node, this);

    if (!forceUpdate && !this.#checkShouldUpdate(oldProps, oldAttrs, this.surroundingContext)) {
      return true;
    }

    calculateResolvedParagraphProperties(this.editor, this.node, this.editor.state.doc.resolve(this.getPos()));

    this.#updateHTMLAttributes();
    this.#updateDOMStyles(oldProps);

    if (!this.#checkIsList()) {
      this.#removeList();
      return true;
    }
    this.#initList(node.attrs.listRendering);
    this.#scheduleAnimation(() => {
      this.#initList(node.attrs.listRendering);
      this.#updateListStyles();
    });
    return true;
  }

  /**
   * Checks whether the node view should update based on changes to props, attrs, or surrounding context.
   * @param {Record<string, unknown>} oldProps
   * @param {Record<string, unknown>} oldAttrs
   * @param {Record<string, unknown>} oldSurroundingContext
   * @returns {boolean}
   */
  #checkShouldUpdate(oldProps, oldAttrs, oldSurroundingContext) {
    this.#resolveNeighborParagraphProperties();
    return (
      JSON.stringify(oldAttrs) !== JSON.stringify(this.node.attrs) ||
      JSON.stringify(oldProps) !== JSON.stringify(getResolvedParagraphProperties(this.node)) ||
      JSON.stringify(oldSurroundingContext) !== JSON.stringify(this.surroundingContext)
    );
  }

  /**
   * Updates the HTML attributes of the paragraph DOM element based on node attributes and properties.
   */
  #updateHTMLAttributes() {
    const htmlAttributes = Attribute.getAttributesToRender(this.node, this.extensionAttrs);
    htmlAttributes.style = htmlAttributes.style || '';
    for (const [key, value] of Object.entries(htmlAttributes || {})) {
      if (value == null) {
        this.dom.removeAttribute(key);
        continue;
      }
      this.dom.setAttribute(key, value);
    }
    const paragraphProperties = getResolvedParagraphProperties(this.node);
    if (this.#checkIsList()) {
      this.dom.setAttribute('data-num-id', paragraphProperties.numberingProperties.numId);
      this.dom.setAttribute('data-level', paragraphProperties.numberingProperties.ilvl);
    } else {
      this.dom.removeAttribute('data-num-id');
      this.dom.removeAttribute('data-level');
    }
    if (paragraphProperties.framePr?.dropCap) {
      this.dom.classList.add('sd-editor-dropcap');
    } else {
      this.dom.classList.remove('sd-editor-dropcap');
    }

    if (paragraphProperties.styleId) {
      this.dom.setAttribute('styleid', paragraphProperties.styleId);
    }

    if (
      paragraphProperties.rightToLeft === true ||
      (paragraphProperties.rightToLeft !== false && inferParagraphRtlFromRuns(this.node))
    ) {
      // Explicit RTL, or run-inferred RTL (header/footer fallback) — hard.
      this.dom.setAttribute('dir', 'rtl');
    } else if (paragraphProperties.rightToLeft === false) {
      // Explicit LTR (e.g. user toolbar choice) — hard override, never auto-detects.
      this.dom.setAttribute('dir', 'ltr');
    } else {
      // Unset: hand base-direction selection to the browser. `dir="auto"`
      // resolves from the first strong character typed (Arabic → RTL, Latin →
      // LTR) and places the caret accordingly — Google-Docs-style. An absent
      // `dir` would instead inherit the container's direction, which is the
      // behaviour this replaces.
      this.dom.setAttribute('dir', 'auto');
    }
  }

  /**
   * Updates the CSS styles of the paragraph DOM element based on resolved paragraph properties.
   * @param {Record<string, unknown> | null} oldParagraphProperties
   */
  #updateDOMStyles(oldParagraphProperties = null) {
    this.dom.style.cssText = '';
    const paragraphProperties = getResolvedParagraphProperties(this.node);
    this.#resolveNeighborParagraphProperties();

    const style = encodeCSSFromPPr(
      paragraphProperties,
      this.surroundingContext.hasPreviousParagraph,
      this.surroundingContext.nextParagraphProps,
    );
    Object.entries(style).forEach(([k, v]) => {
      this.dom.style[k] = v;
    });

    // Check if spacing-related props changed and if so, trigger update on previous paragraph so it can adjust its bottom spacing
    if (
      JSON.stringify(paragraphProperties.spacing) !== JSON.stringify(oldParagraphProperties?.spacing) ||
      paragraphProperties.styleId !== oldParagraphProperties?.styleId ||
      paragraphProperties.contextualSpacing !== oldParagraphProperties?.contextualSpacing
    ) {
      const previousNodeView = this.surroundingContext.previousParagraph
        ? nodeViewMap.get(this.surroundingContext.previousParagraph)
        : null;
      if (previousNodeView) {
        // Check if the previous node view is still valid
        try {
          previousNodeView.getPos();
        } catch {
          return;
        }
        previousNodeView.update(
          previousNodeView.node,
          previousNodeView.decorations,
          previousNodeView.innerDecorations,
          true,
        );
      }
    }
  }

  /**
   * Resolves properties of neighboring paragraphs to determine surrounding context.
   */
  #resolveNeighborParagraphProperties() {
    const $pos = this.editor.state.doc.resolve(this.getPos());
    const parent = $pos.parent;
    const index = $pos.index();
    let hasPreviousParagraph = false;
    let previousParagraph = null;
    let nextParagraphProps = null;
    if (index > 0) {
      const previousNode = parent.child(index - 1);
      hasPreviousParagraph =
        previousNode.type.name === 'paragraph' && !getResolvedParagraphProperties(previousNode)?.framePr?.dropCap;
      if (hasPreviousParagraph) {
        previousParagraph = previousNode;
      }
    }
    if (parent) {
      if (index < parent.childCount - 1) {
        const nextNode = parent.child(index + 1);
        if (nextNode.type.name === 'paragraph') {
          nextParagraphProps = getResolvedParagraphProperties(nextNode);
        }
      }
    }

    this.surroundingContext = {
      hasPreviousParagraph,
      previousParagraph,
      nextParagraphProps,
    };
  }

  /**
   * Updates the styles of the list marker and separator based on current node attributes.
   * @returns {boolean}
   */
  #updateListStyles() {
    const listRendering = this.node.attrs.listRendering;
    // When listRendering is null (can happen transiently during certain
    // transactions, e.g. after a setDocAttribute + paragraph delete), leave
    // the existing marker/separator untouched. Forcing a default `suffix` here
    // would risk writing tab-style CSS onto a text-node separator created by
    // a prior 'space'/'nothing' suffix and scheduled RAF pass.
    if (!listRendering) {
      return true;
    }
    let { suffix, justification } = listRendering;
    suffix = suffix ?? 'tab';
    this.#calculateMarkerStyle(justification);
    if (suffix === 'tab') {
      const paragraphProperties = getResolvedParagraphProperties(this.node);
      this.#calculateTabSeparatorStyle(justification, paragraphProperties.indent);
    } else {
      this.separator.textContent = suffix === 'space' ? '\u00A0' : '';
    }

    return true;
  }

  /**
   * @param {MutationRecord} mutation
   */
  ignoreMutation(mutation) {
    // Ignore mutations to the list marker and separator}
    if (this.marker && (mutation.target === this.marker || this.marker.contains(mutation.target))) {
      return true;
    }
    if (this.separator && (mutation.target === this.separator || this.separator.contains(mutation.target))) {
      return true;
    }
    // Ignore style attribute changes on the paragraph DOM element
    if (mutation.type === 'attributes' && mutation.target === this.dom && mutation.attributeName === 'style') {
      return true;
    }
    // Ignore addition/removal of marker/separator nodes
    if (mutation.type === 'childList') {
      if (this.marker && Array.from(mutation.removedNodes).includes(this.marker)) {
        return true;
      }

      if (this.marker && Array.from(mutation.addedNodes).includes(this.marker)) {
        return true;
      }
      if (this.separator && Array.from(mutation.removedNodes).includes(this.separator)) {
        return true;
      }
      if (this.separator && Array.from(mutation.addedNodes).includes(this.separator)) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {{ markerText: string, suffix?: string } | null} listRendering
   */
  #initList(listRendering) {
    // See #updateListStyles: when listRendering is null the previous marker/
    // separator are left in place; avoid invoking the create helpers with
    // undefined values.
    if (!listRendering) {
      return;
    }
    this.#createMarker(listRendering.markerText);
    this.#createSeparator(listRendering.suffix);
  }

  #checkIsList() {
    return isList(this.node);
  }

  /**
   * @param {string} markerText
   */
  #createMarker(markerText) {
    if (!this.marker) {
      this.marker = document.createElement('span');
      this.dom.insertBefore(this.marker, this.contentDOM);
    }
    this.marker.contentEditable = 'false';
    this.marker.className = 'list-marker';
    this.marker.textContent = markerText;
  }

  /**
   * @param {'tab' | 'space' | 'nothing'} [suffix]
   */
  #createSeparator(suffix) {
    if (suffix === 'tab' || suffix == null) {
      if (this.separator == null || this.separator.tagName?.toLowerCase() !== 'span') {
        this.separator?.parentNode?.removeChild(this.separator);
        this.separator = document.createElement('span');
        this.marker.after(this.separator);
      }
      this.separator.className = 'sd-editor-tab';
      this.separator.contentEditable = 'false';
    } else if (suffix === 'space') {
      if (this.separator == null || this.separator.nodeType !== Node.TEXT_NODE) {
        this.separator?.parentNode?.removeChild(this.separator);
        this.separator = document.createTextNode('\u00A0');
        this.marker.after(this.separator);
      }
      this.separator.textContent = '\u00A0';
    } else if (suffix === 'nothing') {
      if (this.separator == null || this.separator.nodeType !== Node.TEXT_NODE) {
        this.separator?.parentNode?.removeChild(this.separator);
        this.separator = document.createTextNode('');
        this.marker.after(this.separator);
      }
      this.separator.textContent = '';
    }
  }

  /**
   * This is the logic behind the calculation:
   *
   * For left alignment:
   *   - The tab character extends to the next tab stop
   *
   * For right alignment:
   *   When: hanging is defined OR hanging is not defined and neither is firstLine
   *     - The tab character extends to the hanging position only and never goes beyond it.
   *
   *   When: firstLine is defined
   *       - The tab character extends to the next tab stop
   *
   * For center alignment:
   *   - The tab character extends to the next tab stop
   */
  /**
   * @param {'left' | 'right' | 'center'} justification
   * @param {{ hanging?: number, firstLine?: number } | null} indent
   */
  #calculateTabSeparatorStyle(justification, indent) {
    const markerWidth = this.marker.getBoundingClientRect().width;
    let tabStyle;
    let { paragraphContext, start } = this.#getParagraphContext();

    if (justification === 'right') {
      if (indent?.hanging || (!indent?.hanging && !indent?.firstLine)) {
        const hanging = indent?.hanging ? twipsToPixels(indent.hanging) : 0;
        tabStyle = `width: ${hanging}px;`;
      } else {
        const tabNode = this.editor.schema.nodes.tab.create(null);
        tabStyle = calculateTabStyle(tabNode.nodeSize, this.editor.view, start, this.node, paragraphContext);
      }
    } else if (justification === 'center') {
      // Half the marker width takes up space in the paragraph
      paragraphContext.accumulatedTabWidth = markerWidth / 2;
      const tabNode = this.editor.schema.nodes.tab.create(null);
      tabStyle = calculateTabStyle(tabNode.nodeSize, this.editor.view, start, this.node, paragraphContext);
      // Since the marker uses absolute position, we need to offset the tab by half the marker width
      tabStyle += `margin-left: ${markerWidth / 2}px;`;
    } else {
      paragraphContext.accumulatedTabWidth = markerWidth;
      const tabNode = this.editor.schema.nodes.tab.create(null);
      tabStyle = calculateTabStyle(tabNode.nodeSize, this.editor.view, start, this.node, paragraphContext);
    }
    this.separator.style.cssText = tabStyle;
  }

  /**
   * This is the logic behind the calculation:
   *  For left alignment:
   *    - The marker text STARTS at the left indent
   *
   *  For right alignment:
   *    - The marker text ENDS at the left indent
   *
   * For center alignment:
   *   - The marker text is centered around the left indent (pulled back by half its width)
   *
   * The left/center/right alignment positioning uses the left indent (+ firstLine if present) as the anchor point.
   */
  /**
   * @param {'left' | 'right' | 'center'} justification
   */
  #calculateMarkerStyle(justification) {
    // START: modify after CSS styles
    const paragraphProperties = getResolvedParagraphProperties(this.node);
    const runProperties = resolveRunProperties(
      {
        translatedNumbering: this.editor.converter.translatedNumbering,
        translatedLinkedStyles: this.editor.converter.translatedLinkedStyles,
      },
      paragraphProperties.runProperties || {},
      paragraphProperties,
      true,
      Boolean(this.node.attrs.paragraphProperties.numberingProperties),
    );
    const style = encodeCSSFromRPr(runProperties, this.editor.converter.convertedXml);
    this.marker.style.cssText = Object.entries(style)
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ');
    // END: modify after CSS styles

    let markerStyle = {
      position: '',
      left: '',
      bottom: '',
    };

    let domStyle = {
      position: '',
    };

    const calculateTop = () => {
      let top = '0';
      if (globalThis) {
        const computedStyle = globalThis.getComputedStyle(this.dom);
        const markerComputedStyle = globalThis.getComputedStyle(this.marker);
        const lineHeight = parseFloat(computedStyle.lineHeight);
        const markerLineHeight = parseFloat(markerComputedStyle.lineHeight);
        top = `${lineHeight - markerLineHeight}px`;
      }
      return top;
    };

    const rect = this.marker.getBoundingClientRect();
    const markerWidth = rect.width;
    if (justification === 'right') {
      markerStyle.position = 'absolute';
      markerStyle.left = `${-markerWidth}px`;
      markerStyle.top = calculateTop();
      domStyle.position = 'relative';
    } else if (justification === 'center') {
      markerStyle.position = 'absolute';
      markerStyle.left = `${-markerWidth / 2}px`;
      markerStyle.top = calculateTop();
      domStyle.position = 'relative';
    }
    Object.entries(markerStyle).forEach(([k, v]) => {
      this.marker.style[k] = v;
    });
    Object.entries(domStyle).forEach(([k, v]) => {
      this.dom.style[k] = v;
    });
  }

  #removeList() {
    if (this.marker) {
      this.dom.removeChild(this.marker);
      this.marker = null;
    }
    if (this.separator) {
      this.dom.removeChild(this.separator);
      this.separator = null;
    }
    this.dom.style.position = '';
  }

  #getParagraphContext() {
    const $pos = this.editor.state.doc.resolve(this.getPos());
    const start = $pos.start($pos.depth + 1);
    const paragraphContext = extractParagraphContext(this.node, start, this.editor.helpers);
    return { paragraphContext, start };
  }

  /**
   * @param {() => void} fn
   */
  #scheduleAnimation(fn) {
    if (typeof globalThis === 'undefined') {
      return;
    }

    this.#cancelScheduledAnimation();

    this._animationFrameRequest = globalThis.requestAnimationFrame(() => {
      fn();
      this._animationFrameRequest = null;
    });
  }

  #cancelScheduledAnimation() {
    if (typeof globalThis === 'undefined' || !this._animationFrameRequest) {
      return;
    }
    globalThis.cancelAnimationFrame(this._animationFrameRequest);
    this._animationFrameRequest = null;
  }

  destroy() {
    this.#cancelScheduledAnimation();
    if (nodeViewMap.get(this.node) === this) {
      nodeViewMap.delete(this.node);
    }
  }
}
