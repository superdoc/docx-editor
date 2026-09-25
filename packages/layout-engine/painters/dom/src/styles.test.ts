import { describe, expect, it } from 'vite-plus/test';
import {
  ensureDocumentSurfaceStyles,
  ensureFootnoteStyles,
  ensureLinkStyles,
  ensureSdtContainerStyles,
  ensureSurfaceStylePreflight,
  ensureTrackChangeStyles,
  lineStyles,
  pageStyles,
} from './styles.js';

describe('pageStyles', () => {
  it('keeps page chrome out of the physical page coordinate space (SD-3550)', () => {
    const styles = pageStyles(793.7333333333, 1122.5333333333);
    expect(styles.boxSizing).toBe('border-box');
    expect(styles.width).toBe('793.7333333333px');
    expect(styles.height).toBe('1122.5333333333px');
    expect(styles.border).toBe('none');
    expect(styles.outline).toBe('1px solid rgba(15, 23, 42, 0.08)');
  });

  it('establishes a document foreground on the page root', () => {
    const styles = pageStyles(612, 792);
    expect(styles.color).toBe('var(--sd-layout-page-color, #000000)');
  });

  it('allows callers to override the document foreground token', () => {
    const styles = pageStyles(612, 792, { color: '#123456' });
    expect(styles.color).toBe('#123456');
  });
});

describe('lineStyles', () => {
  it('sets height and lineHeight from the argument', () => {
    const styles = lineStyles(24);
    expect(styles.height).toBe('24px');
    expect(styles.lineHeight).toBe('24px');
  });

  it('sets fontSize to 0 to eliminate the CSS strut', () => {
    const styles = lineStyles(20);
    expect(styles.fontSize).toBe('0');
  });
});

describe('ensureFootnoteStyles', () => {
  it('renders a text cursor over footnote and endnote note content (SD-3400)', () => {
    ensureFootnoteStyles(document);

    const styleEl = document.querySelector('[data-superdoc-footnote-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    // Note fragments are generic .superdoc-fragment elements keyed by block-id prefix.
    expect(cssText).toContain('[data-block-id^="footnote-"]');
    expect(cssText).toContain('[data-block-id^="endnote-"]');
    expect(cssText).toContain('[data-block-id^="__sd_semantic_footnote-"]');
    expect(cssText).toContain('cursor: text;');
  });
  it('signals clickability on body reference markers and highlights the active note (SD-3400)', () => {
    ensureFootnoteStyles(document);

    const styleEl = document.querySelector('[data-superdoc-footnote-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    expect(cssText).toContain('[data-note-reference]');
    expect(cssText).toContain('cursor: pointer;');
    expect(cssText).toContain('[data-note-reference]:hover');
    expect(cssText).toContain('.sd-note-session-active');
    expect(cssText).toContain('sd-note-activate-pulse');
  });
});

describe('ensureDocumentSurfaceStyles', () => {
  it('injects scoped foreground isolation without using important overrides', () => {
    ensureDocumentSurfaceStyles(document);

    const styleEl = document.querySelector('[data-superdoc-document-surface-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    expect(cssText).toContain('color: var(--sd-layout-page-color, #000000);');
    expect(cssText).toContain('.superdoc-layout .superdoc-page .superdoc-text-run');
    expect(cssText).toContain(':not([data-bookmark-marker])');
    expect(cssText).toContain('.superdoc-layout .superdoc-thin-double-border');
    expect(cssText).toContain('background-image: none;');
    expect(cssText).not.toContain('!important');
  });
});

describe('style injection', () => {
  it('deduplicates by document instead of module-global state', () => {
    const firstDoc = document.implementation.createHTMLDocument('first');
    const secondDoc = document.implementation.createHTMLDocument('second');

    ensureLinkStyles(firstDoc);
    ensureLinkStyles(firstDoc);
    ensureLinkStyles(secondDoc);
    ensureFootnoteStyles(secondDoc);
    ensureFootnoteStyles(secondDoc);

    expect(firstDoc.head.querySelectorAll('[data-superdoc-link-styles="true"]')).toHaveLength(1);
    expect(secondDoc.head.querySelectorAll('[data-superdoc-link-styles="true"]')).toHaveLength(1);
    expect(secondDoc.head.querySelectorAll('[data-superdoc-footnote-styles="true"]')).toHaveLength(1);
  });

  it('applies one nonce to every document-level painter stylesheet', () => {
    const doc = document.implementation.createHTMLDocument('nonce');

    ensureSurfaceStylePreflight(doc, 'page-nonce');

    const styles = Array.from(doc.head.querySelectorAll<HTMLStyleElement>('style'));
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.every((style) => style.nonce === 'page-nonce')).toBe(true);
  });
});

describe('ensureSdtContainerStyles', () => {
  it('exposes hover border tokens for structured content overrides', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    expect(cssText).toContain('border-color: var(--sd-content-controls-block-hover-border, transparent);');
    expect(cssText).toContain('border-color: var(--sd-content-controls-inline-hover-border, transparent);');
  });

  it('keeps block SDT chrome paint-only so it does not change fragment geometry', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const blockRule = cssText.match(/\.superdoc-structured-content-block\s*\{([^}]*)\}/)?.[1] ?? '';
    const hoverRule =
      cssText.match(
        /\.superdoc-structured-content-block:not\(.ProseMirror-selectednode\):hover::before\s*\{([^}]*)\}/,
      )?.[1] ?? '';
    const backgroundRule = cssText.match(/\.superdoc-structured-content-block::before\s*\{([^}]*)\}/)?.[1] ?? '';
    const chromeRule = cssText.match(/\.superdoc-structured-content-block::after\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(blockRule).not.toContain('padding:');
    expect(blockRule).not.toContain('border:');
    expect(blockRule).toContain('background-color: transparent;');
    expect(blockRule).toContain('--sd-sdt-chrome-left: 0px;');
    expect(blockRule).toContain('--sd-sdt-chrome-width: 100%;');
    expect(blockRule).toContain('--sd-sdt-chrome-bottom-extension: 0px;');
    expect(blockRule).toContain('z-index: 0;');
    expect(backgroundRule).toContain('width: var(--sd-sdt-chrome-width, 100%);');
    expect(backgroundRule).toContain('bottom: calc(0px - var(--sd-sdt-chrome-bottom-extension, 0px));');
    expect(backgroundRule).toContain('background-color: var(--sd-content-controls-block-bg, transparent);');
    expect(backgroundRule).toContain('z-index: -1;');
    expect(hoverRule).toContain('background-color: var(--sd-content-controls-block-hover-bg, #f2f2f2);');
    expect(chromeRule).toContain('position: absolute;');
    expect(chromeRule).toContain('width: var(--sd-sdt-chrome-width, 100%);');
    expect(chromeRule).toContain('bottom: calc(0px - var(--sd-sdt-chrome-bottom-extension, 0px));');
    expect(chromeRule).toContain('border: 1px solid transparent;');
    expect(chromeRule).toContain('z-index: 1;');
    expect(chromeRule).toContain('pointer-events: none;');
  });

  it('keeps top chrome on adjacent complete block SDTs', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    expect(cssText).not.toContain('.superdoc-structured-content-block + .superdoc-structured-content-block');
    expect(cssText).toContain(
      '.superdoc-structured-content-block[data-sdt-container-end="true"]:not([data-sdt-container-start="true"])::after',
    );
    expect(cssText).toContain(
      '.superdoc-structured-content-block:not([data-sdt-container-start="true"]):not([data-sdt-container-end="true"])::after',
    );
  });

  it('paints an empty inline SDT border only while the control is selected', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const selectedRule = cssText.match(
      /\.superdoc-structured-content-inline\.ProseMirror-selectednode\s*\{([^}]*)\}/,
    )?.[1];

    expect(cssText).not.toContain(
      ".superdoc-structured-content-inline[data-empty='true']:not([data-appearance='hidden'])",
    );
    expect(selectedRule).toContain('border-color: var(--sd-content-controls-inline-border, #629be7);');
  });

  it('does not paint placeholder text for an emptied inline control', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const hiddenPlaceholder = cssText.match(
      /\.superdoc-structured-content-inline\[data-empty='true'\] \.superdoc-empty-sdt-placeholder::before\s*\{([^}]*)\}/,
    )?.[1];

    expect(hiddenPlaceholder).toContain('content: none;');
  });

  it('colors deleted content-control chrome with the tracked deletion color', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    expect(cssText).toContain(".superdoc-structured-content-inline[data-track-change-content-control-deletion='true']");
    expect(cssText).toContain(
      ".superdoc-structured-content-block[data-track-change-content-control-deletion='true']::after",
    );
    expect(cssText).toContain('border-color: var(--sd-tracked-changes-delete-border, #cb0e47);');
    expect(cssText).toContain(
      ".superdoc-structured-content-inline[data-track-change-content-control-deletion='true'] .superdoc-structured-content-inline__label",
    );
    expect(cssText).toContain('background-color: var(--sd-tracked-changes-delete-border, #cb0e47);');
  });

  it('promotes only image-bearing inline SDT wrappers to inline-block geometry', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const baseInlineRule = cssText.match(/\.superdoc-structured-content-inline\s*\{([^}]*)\}/)?.[1] ?? '';
    const imageInlineRule =
      cssText.match(
        /\.superdoc-structured-content-inline\[data-contains-inline-image='true'\]:not\(\[data-appearance='hidden'\]\)\s*\{([^}]*)\}/,
      )?.[1] ?? '';

    expect(baseInlineRule).toContain('display: inline;');
    expect(imageInlineRule).toContain('display: inline-block;');
    expect(imageInlineRule).toContain('vertical-align: top;');
  });

  it('uses the same label box model for block and inline SDTs', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const sharedLabelRule =
      cssText.match(
        /\.superdoc-structured-content__label,\s*\.superdoc-structured-content-inline__label\s*\{([^}]*)\}/,
      )?.[1] ?? '';
    const inlineSelectedRule =
      cssText.match(
        /\.superdoc-structured-content-inline\.ProseMirror-selectednode \.superdoc-structured-content-inline__label\s*\{([^}]*)\}/,
      )?.[1] ?? '';
    const sharedLabelDragHandleRule =
      cssText.match(
        /\.superdoc-structured-content__label::before,\s*\.superdoc-structured-content-inline__label::before\s*\{([^}]*)\}/,
      )?.[1] ?? '';
    const inlineLabelRule =
      [...cssText.matchAll(/\.superdoc-structured-content-inline__label\s*\{([^}]*)\}/g)]
        .map((match) => match[1] ?? '')
        .find((rule) => rule.includes('bottom: calc(100% + 1px);')) ?? '';
    const blockLabelRule = cssText.match(/\.superdoc-structured-content__label\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(sharedLabelRule).toContain('height: 18px;');
    expect(sharedLabelRule).toContain('padding: 0 4px;');
    expect(sharedLabelRule).toContain('border: 1px solid var(--sd-content-controls-label-border, #629be7);');
    expect(sharedLabelRule).toContain('box-sizing: border-box;');
    expect(sharedLabelRule).toContain('align-items: center;');
    expect(sharedLabelRule).toContain('justify-content: center;');
    expect(sharedLabelDragHandleRule).toContain("content: '';");
    expect(sharedLabelDragHandleRule).toContain('height: 8px;');
    expect(sharedLabelDragHandleRule).toContain(
      'radial-gradient(circle, currentColor 1px, transparent 1px) center 0 / 2px 2px no-repeat,',
    );
    expect(sharedLabelDragHandleRule).toContain('center 3px / 2px 2px no-repeat,');
    expect(sharedLabelDragHandleRule).toContain('center 6px / 2px 2px no-repeat;');
    expect(inlineSelectedRule).toContain('display: inline-flex;');
    expect(inlineLabelRule).toContain('inset-inline-start: 2px;');
    expect(inlineLabelRule).toContain('transform: none;');
    expect(inlineLabelRule).not.toContain('left: 50%;');
    expect(inlineLabelRule).not.toContain('translateX(-50%)');
    expect(inlineLabelRule).toContain('border-radius: 4px 4px 0 0;');
    expect(blockLabelRule).toContain('white-space: nowrap;');
    expect(blockLabelRule).toContain('top: -18px;');
    expect(blockLabelRule).toContain('width: max-content;');
    expect(blockLabelRule).toContain('max-width: 130px;');
    expect(blockLabelRule).toContain('min-width: 0;');
    expect(blockLabelRule).not.toContain('width: calc(var(--sd-sdt-chrome-width, 100%) - 4px);');
    expect(cssText).toContain('.superdoc-structured-content__label span');
    expect(cssText).toContain('flex: 1 1 auto;');
    expect(cssText).toContain('bottom: calc(100% + 1px);');
  });

  it('renders empty SDT placeholder text and active selection styling', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const placeholderRule = cssText.match(/\.superdoc-empty-sdt-placeholder\s*\{([^}]*)\}/)?.[1] ?? '';
    const placeholderBeforeRule =
      cssText.match(/(?:^|\n)\.superdoc-empty-sdt-placeholder::before\s*\{([^}]*)\}/)?.[1] ?? '';
    const selectedRule =
      cssText.match(
        /\.superdoc-structured-content-inline\.ProseMirror-selectednode \.superdoc-empty-sdt-placeholder::before,\s*\.superdoc-structured-content-block\.ProseMirror-selectednode \.superdoc-empty-sdt-placeholder::before\s*\{([^}]*)\}/,
      )?.[1] ?? '';

    expect(placeholderRule).toContain('display: inline-block;');
    expect(placeholderRule).toContain('line-height: normal;');
    expect(placeholderRule).toContain('vertical-align: baseline;');
    expect(placeholderRule).toContain('white-space: nowrap;');
    expect(placeholderBeforeRule).toContain('content: attr(data-placeholder-text);');
    expect(placeholderBeforeRule).toContain('color: var(--sd-content-controls-placeholder-text, #a6a6a6);');
    expect(selectedRule).toContain('background-color: var(--sd-content-controls-placeholder-selected-bg, Highlight);');
    expect(selectedRule).not.toMatch(/(^|\n)\s*color\s*:/);
  });

  it('suppresses empty block SDT placeholder text when the SDT appearance is hidden', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const hiddenPlaceholderRule =
      cssText.match(
        /\.superdoc-structured-content-inline\[data-appearance='hidden'\] \.superdoc-empty-inline-sdt-placeholder,\s*\.superdoc-structured-content-block\[data-appearance='hidden'\] \.superdoc-empty-block-sdt-placeholder,\s*\.superdoc-empty-sdt-placeholder\[data-appearance='hidden'\]\s*\{([^}]*)\}/,
      )?.[1] ?? '';
    const hiddenPlaceholderBeforeRule =
      cssText.match(
        /\.superdoc-structured-content-inline\[data-appearance='hidden'\] \.superdoc-empty-inline-sdt-placeholder::before,\s*\.superdoc-structured-content-block\[data-appearance='hidden'\] \.superdoc-empty-block-sdt-placeholder::before,\s*\.superdoc-empty-sdt-placeholder\[data-appearance='hidden'\]::before\s*\{([^}]*)\}/,
      )?.[1] ?? '';

    expect(hiddenPlaceholderRule).toContain('width: 0;');
    expect(hiddenPlaceholderRule).toContain('min-width: 0;');
    expect(hiddenPlaceholderRule).toContain('overflow: hidden;');
    expect(hiddenPlaceholderBeforeRule).toContain("content: '';");
  });

  it('keeps empty SDT placeholder text visible in viewing mode', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const viewingPlaceholderRule =
      cssText.match(/\.presentation-editor--viewing \.superdoc-empty-sdt-placeholder::before\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(viewingPlaceholderRule).toBe('');
    expect(viewingPlaceholderRule).not.toContain('visibility: hidden;');
  });

  it('keeps empty SDT placeholder text visible in print mode', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const printPlaceholderRule =
      cssText.match(/@media print\s*\{[\s\S]*?\.superdoc-empty-sdt-placeholder::before\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(printPlaceholderRule).toBe('');
    expect(printPlaceholderRule).not.toContain('visibility: hidden;');
  });

  it('suppresses structured-content hover backgrounds in viewing mode, including grouped hover', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const beforeRule =
      cssText.match(
        /\.presentation-editor--viewing \.superdoc-structured-content-block(?:\:hover|\.sdt-group-hover|\[data-lock-mode\]\.sdt-group-hover)::before\s*\{([^}]*)\}/,
      )?.[1] ?? '';

    expect(cssText).toContain('.presentation-editor--viewing .superdoc-structured-content-block.sdt-group-hover');
    expect(cssText).toContain(
      '.presentation-editor--viewing .superdoc-structured-content-block[data-lock-mode].sdt-group-hover',
    );
    expect(cssText).toContain(
      '.presentation-editor--viewing .superdoc-structured-content-inline[data-lock-mode]:hover',
    );
    expect(cssText).toContain('background: none;');
    expect(beforeRule).toContain('background: none;');
  });

  it('suppresses block SDT resting background paint in viewing and print modes', () => {
    ensureSdtContainerStyles(document);

    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const viewingBeforeRule =
      cssText.match(
        /\.presentation-editor--viewing \.superdoc-structured-content-block::before,[\s\S]*?\{([^}]*)\}/,
      )?.[1] ?? '';
    const printBeforeRule =
      cssText.match(/@media print\s*\{[\s\S]*?\.superdoc-structured-content-block::before\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(cssText).toContain('.presentation-editor--viewing .superdoc-structured-content-block::before,');
    expect(viewingBeforeRule).toContain('background: none;');
    expect(printBeforeRule).toContain('background: none;');
  });

  it('keeps hidden-appearance inline SDTs transparent at rest', () => {
    ensureSdtContainerStyles(document);
    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    expect(cssText).toContain(".superdoc-structured-content-inline[data-appearance='hidden'] {");
    expect(cssText).toContain('background-color: transparent;');
  });

  it('includes global content-controls chrome-none suppression selectors', () => {
    ensureSdtContainerStyles(document);
    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    expect(cssText).toContain('.superdoc-cc-chrome-none .superdoc-structured-content-inline');
    expect(cssText).toContain('.superdoc-cc-chrome-none .superdoc-structured-content-block');
    expect(cssText).toContain('.superdoc-cc-chrome-none .superdoc-structured-content-block.sdt-group-hover');
  });

  it('suppresses block SDT pseudo-element chrome (::before/::after) under chrome-none', () => {
    // Block chrome is painted through ::before (background) and ::after
    // (border) pseudo-elements, so element-level rules cannot reach it. These
    // selectors must exist or block chrome leaks under contentControlsChrome=none.
    ensureSdtContainerStyles(document);
    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    // Selected-node blue border (the case viewing mode has no equivalent for).
    expect(cssText).toContain(
      '.superdoc-cc-chrome-none .superdoc-structured-content-block.ProseMirror-selectednode::after',
    );
    // Direct hover (single-fragment) border and background.
    expect(cssText).toContain('.superdoc-cc-chrome-none .superdoc-structured-content-block:hover::after');
    expect(cssText).toContain('.superdoc-cc-chrome-none .superdoc-structured-content-block:hover::before');
    // Group hover (multi-fragment, JS-coordinated) border and background.
    expect(cssText).toContain('.superdoc-cc-chrome-none .superdoc-structured-content-block.sdt-group-hover::after');
    expect(cssText).toContain('.superdoc-cc-chrome-none .superdoc-structured-content-block.sdt-group-hover::before');
    // Lock-hover background lives on ::before; must be suppressed too.
    expect(cssText).toContain(
      '.superdoc-cc-chrome-none .superdoc-structured-content-block[data-lock-mode].sdt-group-hover::before',
    );
  });

  it('declares chrome-none block pseudo suppression after the chrome-showing rules', () => {
    // The hover/group-hover suppression selectors are the same specificity as
    // the rules they override, so source order is load-bearing: the chrome-none
    // block must come after the last chrome-showing block pseudo rule (the
    // lock-hover ::before background) or hover chrome leaks under chrome-none.
    ensureSdtContainerStyles(document);
    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    const lastChromeShowing = cssText.indexOf(
      '.superdoc-structured-content-block[data-lock-mode].sdt-group-hover:not(.ProseMirror-selectednode)::before',
    );
    const chromeNoneSuppression = cssText.indexOf(
      '.superdoc-cc-chrome-none .superdoc-structured-content-block.sdt-group-hover::before',
    );
    expect(lastChromeShowing).toBeGreaterThan(-1);
    expect(chromeNoneSuppression).toBeGreaterThan(lastChromeShowing);
  });

  it('exposes a --sd-content-controls-custom-* styling surface under chrome-none (SD-3322)', () => {
    ensureSdtContainerStyles(document);
    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    // Inline rest reads the custom vars; the default-preserving fallbacks
    // (0-width transparent border, no background/radius/padding) keep
    // chrome-none visually empty when no variable is set.
    expect(cssText).toContain('background: var(--sd-content-controls-custom-inline-bg, none);');
    expect(cssText).toContain('border: var(--sd-content-controls-custom-inline-border, 0 solid transparent);');
    expect(cssText).toContain('padding: var(--sd-content-controls-custom-inline-padding, 0);');
    expect(cssText).toContain('border-radius: var(--sd-content-controls-custom-inline-radius, 0);');

    // Hover and selected re-assert the SAME border var (constant box, no jitter)
    // and read the background vars, which cascade from the rest background.
    expect(cssText).toContain(
      'background: var(--sd-content-controls-custom-inline-hover-bg, var(--sd-content-controls-custom-inline-bg, none));',
    );
    expect(cssText).toContain(
      'background: var(--sd-content-controls-custom-inline-selected-bg, var(--sd-content-controls-custom-inline-hover-bg, var(--sd-content-controls-custom-inline-bg, none)));',
    );

    // Block exposes the same set plus an accent rail (-border-left) that falls
    // back to the regular border.
    expect(cssText).toContain('background: var(--sd-content-controls-custom-block-bg, none);');
    expect(cssText).toContain(
      'border-left: var(--sd-content-controls-custom-block-border-left, var(--sd-content-controls-custom-block-border, 0 solid transparent));',
    );
  });

  it('locked-hover under chrome-none follows the custom hover background, not the built-in lock-hover (SD-3322)', () => {
    ensureSdtContainerStyles(document);
    const styleEl = document.querySelector('[data-superdoc-sdt-container-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    // The base lock-hover rules (built-in tint on inline, transparent on block)
    // come first and have equal specificity to the plain custom hover rules, so
    // they would otherwise win for locked controls.
    const baseInlineLockHover = cssText.indexOf('background-color: var(--sd-content-controls-lock-hover-bg');
    const baseBlockLockHover = cssText.indexOf(
      '.superdoc-structured-content-block[data-lock-mode].sdt-group-hover:not(.ProseMirror-selectednode) {',
    );
    expect(baseInlineLockHover).toBeGreaterThan(-1);
    expect(baseBlockLockHover).toBeGreaterThan(-1);

    // The chrome-none lock-hover reset re-asserts the custom hover background
    // AFTER them (extra .superdoc-cc-chrome-none class + later source order wins),
    // so a locked control under chrome:'none' uses the custom variable.
    const customInlineHoverReassert = cssText.lastIndexOf('--sd-content-controls-custom-inline-hover-bg');
    const customBlockHoverReassert = cssText.lastIndexOf('--sd-content-controls-custom-block-hover-bg');
    expect(customInlineHoverReassert).toBeGreaterThan(baseInlineLockHover);
    expect(customBlockHoverReassert).toBeGreaterThan(baseBlockLockHover);
  });
});

describe('ensureTrackChangeStyles', () => {
  it('renders paragraph-property tracked-change markers as paint-only gutter bars', () => {
    ensureTrackChangeStyles(document);

    const styleEl = document.querySelector('[data-superdoc-track-change-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const markerRule =
      cssText.match(/\.superdoc-layout \.superdoc-paragraph-property-review-marker\s*\{([^}]*)\}/)?.[1] ?? '';
    const formatRule =
      [
        ...cssText.matchAll(
          /\.superdoc-layout \.superdoc-paragraph-property-review-marker\.track-format-dec\.highlighted\s*\{([^}]*)\}/g,
        ),
      ]
        .map((match) => match[1] ?? '')
        .find((rule) => rule.includes('gold')) ?? '';
    const framePseudoRule =
      cssText.match(
        /\.superdoc-layout\s*\n\s*\.superdoc-fragment\[data-track-change-anchor='paragraph-property'\]\[data-track-change-id\]\[data-track-change-marker-visible='true'\]::before\s*\{([^}]*)\}/,
      )?.[1] ?? '';
    const frameFormatPseudoRule =
      cssText.match(
        /\.superdoc-layout\s*\n\s*\.superdoc-fragment\[data-track-change-anchor='paragraph-property'\]\[data-track-change-id\]\[data-track-change-marker-visible='true'\]\[data-track-change-kind='format'\]::before\s*\{([^}]*)\}/,
      )?.[1] ?? '';

    expect(markerRule).toContain('position: absolute;');
    expect(markerRule).toContain('left: var(--sd-tracked-changes-paragraph-property-marker-left, -10px);');
    expect(markerRule).toContain('width: var(--sd-tracked-changes-paragraph-property-marker-width, 2px);');
    expect(markerRule).toContain('border: 0;');
    expect(markerRule).toContain('cursor: pointer;');
    expect(formatRule).toContain('background: var(--sd-tracked-changes-format-border, gold);');
    expect(formatRule).not.toContain('border-bottom:');
    expect(framePseudoRule).toContain("content: '';");
    expect(framePseudoRule).toContain('position: absolute;');
    expect(framePseudoRule).toContain('pointer-events: none;');
    expect(frameFormatPseudoRule).toContain('background: var(--sd-tracked-changes-format-border, gold);');
  });

  it('keeps focused tracked-change emphasis paint-only so selection does not change inline geometry', () => {
    ensureTrackChangeStyles(document);

    const styleEl = document.querySelector('[data-superdoc-track-change-styles="true"]');
    const cssText = styleEl?.textContent ?? '';

    expect(cssText).toContain('.superdoc-layout .track-insert-dec.highlighted.track-change-focused');
    expect(cssText).toContain('.superdoc-layout .track-delete-dec.highlighted.track-change-focused');
    expect(cssText).toContain('.superdoc-layout .track-format-dec.highlighted.track-change-focused');
    expect(cssText).toContain('border-top-style: solid;');
    expect(cssText).toContain('border-bottom-style: solid;');
    expect(cssText).toContain('border-left: none;');
    expect(cssText).toContain('border-right: none;');
    expect(cssText).not.toMatch(
      /track-(insert|delete)-dec\.highlighted\.track-change-focused\s*\{[\s\S]*border-style:/,
    );
    expect(cssText).not.toMatch(
      /track-(insert|delete)-dec\.highlighted\.track-change-focused\s*\{[\s\S]*border-width:/,
    );
    expect(cssText).not.toMatch(
      /track-(insert|delete)-dec\.highlighted\.track-change-focused\s*\{[\s\S]*border-left-width:/,
    );
    expect(cssText).not.toMatch(
      /track-(insert|delete)-dec\.highlighted\.track-change-focused\s*\{[\s\S]*border-right-width:/,
    );
    expect(cssText).not.toMatch(/track-format-dec\.highlighted\.track-change-focused\s*\{[\s\S]*border-bottom-width:/);
  });

  it('keeps tracked-move list markers legible without decorating the bullet glyph', () => {
    ensureTrackChangeStyles(document);

    const styleEl = document.querySelector('[data-superdoc-track-change-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const moveMarkerRule =
      cssText.match(
        /\.superdoc-layout \.track-list-marker-dec\.highlighted\[data-track-change-semantic-color-key='move-from'\],[\s\S]*?\.superdoc-layout \.track-list-marker-dec\.highlighted\[data-track-change-semantic-color-key='move-to'\]\s*\{([^}]*)\}/,
      )?.[1] ?? '';

    expect(moveMarkerRule).toContain('text-decoration: none !important;');
  });

  it('gives each focused tracked-move side visible emphasis', () => {
    ensureTrackChangeStyles(document);

    const styleEl = document.querySelector('[data-superdoc-track-change-styles="true"]');
    const cssText = styleEl?.textContent ?? '';
    const moveToFocusedRule =
      cssText.match(
        /\.superdoc-layout \.track-insert-dec\.highlighted\.track-change-focused\[data-track-change-semantic-color-key='move-to'\]\s*\{([^}]*)\}/,
      )?.[1] ?? '';
    const moveFromFocusedRule =
      cssText.match(
        /\.superdoc-layout \.track-delete-dec\.highlighted\.track-change-focused\[data-track-change-semantic-color-key='move-from'\]\s*\{([^}]*)\}/,
      )?.[1] ?? '';

    expect(moveToFocusedRule).toContain(
      'background-color: var(--sd-tracked-changes-move-to-background-focused, #00853d44);',
    );
    expect(moveFromFocusedRule).toContain(
      'background-color: var(--sd-tracked-changes-move-from-background-focused, #00853d44);',
    );
  });
});
