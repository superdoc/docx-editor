import { h } from 'vue';

import { sanitizeNumber } from './helpers';
import { normalizeFontOption } from './font-options.js';
import { useToolbarItem } from './use-toolbar-item';
import AlignmentButtons from './AlignmentButtons.vue';
import StyleButtonsList from './StyleButtonsList.vue';
import { bulletStyleButtons, numberedStyleButtons } from './list-style-buttons.js';
import DocumentMode from './DocumentMode.vue';
import LinkedStyle from './LinkedStyle.vue';
import LinkInput from './LinkInput.vue';
import AIWriter from './AIWriter.vue';
import { renderColorOptions } from './color-dropdown-helpers.js';
import { refocusEditorSurface } from './toolbar-focus-helpers.js';
import TableGrid from './TableGrid.vue';
import TableActions from './TableActions.vue';
import { scrollToElement } from './scroll-helpers.js';

import checkIconSvg from '@superdoc/common/icons/check.svg?raw';
import { RESPONSIVE_BREAKPOINTS, TOOLBAR_FONTS, TOOLBAR_FONT_SIZES } from './constants.js';

const closeDropdown = (dropdown) => {
  dropdown.expand.value = false;
};

const getToolbarItemWidth = (item, controlSizes) => {
  const configuredWidth = item.layoutWidth?.value;
  if (Number.isFinite(configuredWidth) && configuredWidth > 0) return configuredWidth;
  if (item.type === 'separator') return controlSizes.get('separator');
  return controlSizes.get(item.name.value) || controlSizes.get('default');
};

/**
 * Set or clear the link item's `href` without disturbing the rest of its
 * attributes. The static configuration (`ariaLabel`, and anything added later)
 * lives in the same object as the transient href, so rebuilding that object
 * from the keys a caller knows about silently drops the others.
 *
 * Exported because the built-in toolbar's `updateToolbarState()` writes the
 * href on its own path, without going through this item's handlers. Both
 * callers share this one rule so the two cannot drift apart.
 */
export function withLinkHref(attributes, href) {
  const next = { ...attributes };
  if (href) next.href = href;
  else delete next.href;
  return next;
}

function selectionTargetFromTextTarget(target) {
  const segments = Array.isArray(target?.segments) ? target.segments : [];
  if (target?.kind !== 'text' || !segments.length) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first?.blockId || !last?.blockId || !first.range || !last.range) return null;
  const story = target.story;
  return {
    kind: 'selection',
    start: {
      kind: 'text',
      blockId: first.blockId,
      offset: first.range.start ?? 0,
      ...(story ? { story } : {}),
    },
    end: {
      kind: 'text',
      blockId: last.blockId,
      offset: last.range.end ?? 0,
      ...(story ? { story } : {}),
    },
    ...(story ? { story } : {}),
  };
}

function selectionText(selection) {
  if (typeof selection?.quotedText === 'string') return selection.quotedText;
  if (typeof selection?.text === 'string') return selection.text;
  return '';
}

function currentSelectionSnapshot(superToolbar) {
  return superToolbar.ui?.selection?.get?.() ?? superToolbar.ui?.selection?.current?.() ?? null;
}

function hasAiModule(superToolbar) {
  return Boolean(superToolbar.config?.superdoc?.config?.modules?.ai || superToolbar.superdoc?.config?.modules?.ai);
}

function aiModuleConfig(superToolbar) {
  return superToolbar.config?.superdoc?.config?.modules?.ai ?? superToolbar.superdoc?.config?.modules?.ai ?? {};
}

export const makeDefaultItems = ({
  superToolbar,
  toolbarIcons,
  toolbarTexts,
  toolbarFonts,
  hideButtons,
  availableWidth,
  role,
  isDev = false,
  configuredItemNames,
  excludedItemNames,
  additionalItems = [],
} = {}) => {
  // bold
  const bold = useToolbarItem({
    type: 'button',
    name: 'bold',
    command: 'toggleBold',
    icon: toolbarIcons.bold,
    tooltip: toolbarTexts.bold,
    attributes: {
      ariaLabel: 'Bold',
    },
  });

  // font
  const fontOptions = (toolbarFonts ?? TOOLBAR_FONTS).map(normalizeFontOption);
  const fontButton = useToolbarItem({
    type: 'dropdown',
    name: 'fontFamily',
    tooltip: toolbarTexts.fontFamily,
    command: 'setFontFamily',
    defaultLabel: 'Arial',
    label: 'Arial',
    markName: 'textStyle',
    labelAttr: 'fontFamily',
    hasCaret: true,
    hasInlineTextInput: true,
    inlineTextInputVisible: true,
    isWide: true,
    style: { width: '116px' },
    suppressActiveHighlight: true,
    attributes: {
      ariaLabel: 'Font family',
    },
    options: fontOptions,
    onActivate: ({ fontFamily } = {}, isMultiple = false) => {
      if (isMultiple) {
        // A selection spanning multiple font families shows a blank field.
        fontButton.label.value = '';
        fontButton.selectedValue.value = '';
        return;
      }

      if (!fontFamily) return;
      fontFamily = fontFamily.split(',')[0]; // in case of fonts with fallbacks
      const optionValue = (option) => option.value ?? option.label;
      const defaultFont = fontOptions.find((option) => optionValue(option) === fontButton.defaultLabel.value);
      const foundFont = fontOptions.find((option) => optionValue(option) === fontFamily);
      if (foundFont) {
        fontButton.label.value = foundFont.label;
        fontButton.selectedValue.value = foundFont.key;
      } else if (defaultFont) {
        fontButton.label.value = fontFamily;
        fontButton.selectedValue.value = defaultFont.key;
      } else {
        fontButton.label.value = fontFamily;
        fontButton.selectedValue.value = '';
      }
    },
    onDeactivate: () => {
      const defaultFont = fontOptions.find(
        (option) => (option.value ?? option.label) === fontButton.defaultLabel.value,
      );
      fontButton.label.value = defaultFont?.label ?? fontButton.defaultLabel.value;
      fontButton.selectedValue.value = defaultFont?.key ?? '';
    },
  });

  const aiButton = useToolbarItem({
    type: 'dropdown',
    name: 'ai',
    dropdownStyles: {
      padding: 0,
      outline: 'none',
    },
    tooltip: toolbarTexts.ai,
    icon: toolbarIcons.ai,
    hideLabel: true,
    hasCaret: false,
    isWide: true,
    suppressActiveHighlight: true,
    attributes: {
      ariaLabel: 'AI',
    },
    options: [
      {
        type: 'render',
        key: 'ai',
        render: () => renderAiDropdown(aiButton),
      },
    ],
  });

  function renderAiDropdown(aiButton) {
    const selection = currentSelectionSnapshot(superToolbar);
    const selectionTarget = selection?.selectionTarget ?? selectionTargetFromTextTarget(selection?.target);
    const selectedText = selection?.empty ? '' : selectionText(selection);
    const config = aiModuleConfig(superToolbar);
    const close = () => closeDropdown(aiButton);
    const restoreSelection = () => {
      const capture = superToolbar.pendingSelectionCapture;
      if (capture && typeof superToolbar.ui?.selection?.restore === 'function') {
        superToolbar.ui.selection.restore(capture);
      }
    };

    return h('div', {}, [
      h(AIWriter, {
        handleClose: close,
        selectedText,
        target: selectionTarget,
        doc: superToolbar.superdoc?.activeEditor?.doc ?? null,
        apiKey: config?.apiKey || superToolbar.config?.aiApiKey || '',
        endpoint: config?.endpoint || superToolbar.config?.aiEndpoint || '',
        restoreSelection,
      }),
    ]);
  }

  // font size
  const fontSizeOptions = TOOLBAR_FONT_SIZES;
  const fontSize = useToolbarItem({
    type: 'dropdown',
    name: 'fontSize',
    defaultLabel: '12',
    label: '12',
    // Fixed width keeps the combobox (input + chevron) from collapsing and holds
    // the toolbar layout stable as the size label changes. Mirrors fontFamily's
    // `style.width`; the combobox reads `item.style` for its root sizing.
    style: { width: '56px' },
    markName: 'textStyle',
    labelAttr: 'fontSize',
    tooltip: toolbarTexts.fontSize,
    hasCaret: true,
    hasInlineTextInput: true,
    inlineTextInputVisible: true,
    suppressActiveHighlight: true,
    isWide: true,
    command: 'setFontSize',
    attributes: {
      ariaLabel: 'Font size',
    },
    options: fontSizeOptions,
    onActivate: ({ fontSize: size }, isMultiple = false) => {
      if (isMultiple) {
        // if there are multiple sizes in the selection.
        fontSize.label.value = '';
        fontSize.selectedValue.value = '';
        return;
      }

      const defaultSize = fontSizeOptions.find((i) => i.label === String(fontSize.defaultLabel.value));
      if (!size) {
        fontSize.label.value = fontSize.defaultLabel.value;
        if (defaultSize) fontSize.selectedValue.value = defaultSize.key;
        else fontSize.selectedValue.value = '';
        return;
      }

      let sanitizedValue = sanitizeNumber(size, 12);
      if (sanitizedValue < 8) sanitizedValue = 8;
      if (sanitizedValue > 96) sanitizedValue = 96;
      let sanitizedValueStr = String(sanitizedValue);

      const foundSize = fontSizeOptions.find((i) => {
        return i.label === sanitizedValueStr || i.key === sanitizedValueStr;
      });
      if (foundSize) {
        fontSize.selectedValue.value = foundSize.key;
      } else {
        fontSize.selectedValue.value = '';
      }

      // no units
      fontSize.label.value = sanitizedValueStr;
    },
    onDeactivate: () => {
      fontSize.label.value = fontSize.defaultLabel.value;
      const defaultSize = fontSizeOptions.find((i) => i.label === String(fontSize.defaultLabel.value));
      if (defaultSize) fontSize.selectedValue.value = defaultSize.key;
      else fontSize.selectedValue.value = '';
    },
  });

  // separator
  // Each usage below gets its own item -- the toolbar list is keyed on item.id,
  // and a single shared item collides with itself everywhere it appears.
  const makeSeparator = () =>
    useToolbarItem({
      type: 'separator',
      name: 'separator',
      isNarrow: true,
    });

  // italic
  const italic = useToolbarItem({
    type: 'button',
    name: 'italic',
    command: 'toggleItalic',
    icon: toolbarIcons.italic,
    active: false,
    tooltip: toolbarTexts.italic,
    attributes: {
      ariaLabel: 'Italic',
    },
  });

  // underline
  const underline = useToolbarItem({
    type: 'button',
    name: 'underline',
    command: 'toggleUnderline',
    icon: toolbarIcons.underline,
    active: false,
    tooltip: toolbarTexts.underline,
    attributes: {
      ariaLabel: 'Underline',
    },
  });

  const strikethrough = useToolbarItem({
    type: 'button',
    name: 'strike',
    command: 'toggleStrike',
    icon: toolbarIcons.strikethrough,
    active: false,
    tooltip: toolbarTexts.strikethrough,
    attributes: {
      ariaLabel: 'Strikethrough',
    },
  });

  // highlight
  const highlight = useToolbarItem({
    type: 'dropdown',
    name: 'highlight',
    icon: toolbarIcons.highlight,
    hideLabel: true,
    markName: 'highlight',
    labelAttr: 'color',
    active: false,
    tooltip: toolbarTexts.highlight,
    command: 'setHighlight',
    noArgumentCommand: 'unsetHighlight',
    suppressActiveHighlight: true,
    attributes: {
      ariaLabel: 'Highlight',
    },
    options: [
      {
        key: 'color',
        type: 'render',
        render: () => renderColorOptions(superToolbar, highlight, [], true),
      },
    ],
    onActivate: ({ color }) => {
      highlight.iconColor.value = color || '';
    },
    onDeactivate: () => (highlight.iconColor.value = ''),
  });

  // color
  const colorButton = useToolbarItem({
    type: 'dropdown',
    name: 'color',
    icon: toolbarIcons.color,
    hideLabel: true,
    markName: 'textStyle',
    labelAttr: 'color',
    active: false,
    tooltip: toolbarTexts.color,
    command: 'setColor',
    suppressActiveHighlight: true,
    attributes: {
      ariaLabel: 'Color',
    },
    options: [
      {
        key: 'color',
        type: 'render',
        render: () => renderColorOptions(superToolbar, colorButton),
      },
    ],
    onActivate: ({ color }) => {
      colorButton.iconColor.value = color;
    },
    onDeactivate: () => (colorButton.iconColor.value = '#000'),
  });

  // search — a plain button that opens the shared find/replace surface (the
  // same one Cmd/Ctrl+F opens). SuperToolbar.emitCommand routes the 'search'
  // click to a `search:open` event on the SuperDoc instance, which the shell
  // handles by opening the surface. This replaces the older inline toolbar
  // search popover so there is a single search UI.
  const search = useToolbarItem({
    type: 'button',
    name: 'search',
    allowWithoutEditor: true,
    active: false,
    icon: toolbarIcons.search,
    tooltip: toolbarTexts.search,
    group: 'right',
    attributes: {
      ariaLabel: 'Search',
    },
  });

  // link
  const link = useToolbarItem({
    type: 'dropdown',
    name: 'link',
    markName: 'link',
    icon: toolbarIcons.link,
    active: false,
    tooltip: toolbarTexts.link,
    attributes: {
      ariaLabel: 'Link dropdown',
    },
    options: [
      {
        type: 'render',
        key: 'linkDropdown',
        render: () => renderLinkDropdown(link),
      },
    ],
    // `attributes` mixes the transient `href` with everything static the item
    // was configured with, `ariaLabel` among it. These handlers replaced the
    // whole object to record an href, dropping the rest; because the toolbar
    // calls `deactivate()` on every state sync, the control lost its accessible
    // name on the first refresh and the live region announced "undefined unset".
    // Carry the existing attributes forward so this stays correct for whatever
    // the item is configured with, not just the two keys it has today.
    onActivate: ({ href }) => {
      link.attributes.value = withLinkHref(link.attributes.value, href);
    },
    onDeactivate: () => {
      link.attributes.value = withLinkHref(link.attributes.value, null);
      link.expand.value = false;
    },
  });

  function renderLinkDropdown(link) {
    // Capture the selection the user had before opening the dropdown so the link
    // command wraps the highlighted text, not a stale/collapsed selection. Mirrors
    // the AI dropdown: `textTarget` pins the range explicitly and `restoreSelection`
    // re-applies the toolbar's pre-interaction capture before the command runs.
    const selection = currentSelectionSnapshot(superToolbar);
    const selectionTarget = selection?.selectionTarget ?? selectionTargetFromTextTarget(selection?.target);
    const restoreSelection = () => {
      const capture = superToolbar.pendingSelectionCapture;
      if (capture && typeof superToolbar.ui?.selection?.restore === 'function') {
        superToolbar.ui.selection.restore(capture);
      }
    };

    return h('div', {}, [
      h(LinkInput, {
        ui: superToolbar.ui,
        linkItem: link,
        textTarget: selectionTarget,
        restoreSelection,
        closePopover: () => {
          closeDropdown(link);
          refocusEditorSurface(superToolbar);
        },
        goToAnchor: () => {
          closeDropdown(link);
          const href = link.attributes.value?.href;
          if (!href) return;
          const anchorName = href.slice(1);
          // Best-effort in-document anchor navigation through the public host
          // viewport surface; no-ops when the host element is unavailable.
          const container = superToolbar.ui?.viewport?.getHost?.() ?? null;
          const anchor = container?.querySelector?.(`a[name='${anchorName}']`);
          if (anchor) scrollToElement(anchor);
        },
      }),
    ]);
  }

  const linkInput = useToolbarItem({
    type: 'options',
    name: 'linkInput',
    command: 'toggleLink',
    active: false,
  });
  link.childItem = linkInput;
  linkInput.parentItem = link;

  // image
  const image = useToolbarItem({
    type: 'button',
    name: 'image',
    command: 'startImageUpload',
    icon: toolbarIcons.image,
    active: false,
    tooltip: toolbarTexts.image,
    disabled: false,
    attributes: {
      ariaLabel: 'Image',
    },
  });

  const tableOfContents = useToolbarItem({
    type: 'button',
    name: 'tableOfContents',
    command: 'insertTableOfContents',
    icon: toolbarIcons.tableOfContents,
    active: false,
    tooltip: toolbarTexts.tableOfContents,
    disabled: false,
    attributes: {
      ariaLabel: 'Table of contents',
    },
  });

  const watermark = useToolbarItem({
    type: 'button',
    name: 'watermark',
    icon: toolbarIcons.watermark,
    tooltip: toolbarTexts.watermark,
    allowWithoutEditor: true,
    disabled: true,
    attributes: { ariaLabel: toolbarTexts.watermark },
  });

  // table
  const tableItem = useToolbarItem({
    type: 'dropdown',
    name: 'table',
    icon: toolbarIcons.table,
    hideLabel: true,
    labelAttr: 'table',
    active: false,
    tooltip: toolbarTexts.table,
    command: 'insertTable',
    suppressActiveHighlight: true,
    attributes: {
      ariaLabel: 'Table',
    },
    options: [
      {
        key: 'table',
        type: 'render',
        render: () => renderTableGrid(tableItem),
      },
    ],
  });

  function renderTableGrid(tableItem) {
    const handleSelect = (e) => {
      superToolbar.emitCommand({ item: tableItem, argument: e });
      closeDropdown(tableItem);
      refocusEditorSurface(superToolbar);
    };

    return h('div', {}, [
      h(TableGrid, {
        onSelect: handleSelect,
      }),
    ]);
  }

  // table actions
  const tableActionsItem = useToolbarItem({
    type: 'dropdown',
    name: 'tableActions',
    command: 'executeTableCommand',
    tooltip: toolbarTexts.tableActions,
    icon: toolbarIcons.tableActions,
    hideLabel: true,
    disabled: true,
    attributes: {
      ariaLabel: 'Table actions',
    },
    options: [
      {
        type: 'render',
        render: () => renderTableActions(tableActionsItem),
      },
    ],
  });

  const tableActionsOptions = [
    {
      label: toolbarTexts.addRowBefore,
      command: 'addRowBefore',
      icon: toolbarIcons.addRowBefore,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Add row before',
      },
    },
    {
      label: toolbarTexts.addRowAfter,
      command: 'addRowAfter',
      icon: toolbarIcons.addRowAfter,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Add row after',
      },
    },
    {
      label: toolbarTexts.addColumnBefore,
      command: 'addColumnBefore',
      icon: toolbarIcons.addColumnBefore,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Add column before',
      },
    },
    {
      label: toolbarTexts.addColumnAfter,
      command: 'addColumnAfter',
      icon: toolbarIcons.addColumnAfter,
      bottomBorder: true,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Add column after',
      },
    },
    {
      label: toolbarTexts.deleteRow,
      command: 'deleteRow',
      icon: toolbarIcons.deleteRow,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Delete row',
      },
    },
    {
      label: toolbarTexts.deleteColumn,
      command: 'deleteColumn',
      icon: toolbarIcons.deleteColumn,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Delete column',
      },
    },
    {
      label: toolbarTexts.deleteTable,
      command: 'deleteTable',
      icon: toolbarIcons.deleteTable,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Delete table',
      },
    },
    {
      label: toolbarTexts.removeBorders,
      command: 'deleteCellAndTableBorders',
      icon: toolbarIcons.deleteBorders,
      bottomBorder: true,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Delete cell and table borders',
      },
    },
    {
      label: toolbarTexts.mergeCells,
      command: 'mergeCells',
      icon: toolbarIcons.mergeCells,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Merge cells',
      },
    },
    {
      label: toolbarTexts.splitCell,
      command: 'splitCell',
      icon: toolbarIcons.splitCell,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Split cells',
      },
    },
    {
      label: toolbarTexts.fixTables,
      command: 'fixTables',
      icon: toolbarIcons.fixTables,
      props: {
        'data-item': 'btn-tableActions-option',
        ariaLabel: 'Fix tables',
      },
    },
  ];

  function renderTableActions(tableActionsItem) {
    return h(TableActions, {
      options: tableActionsOptions,
      onSelect: (event) => {
        closeDropdown(tableActionsItem);
        const { command } = event;
        superToolbar.emitCommand({ item: tableActionsItem, argument: { command } });
        refocusEditorSurface(superToolbar);
      },
    });
  }

  // alignment
  const alignment = useToolbarItem({
    type: 'dropdown',
    name: 'textAlign',
    tooltip: toolbarTexts.textAlign,
    icon: toolbarIcons.alignLeft,
    command: 'setTextAlign',
    hasCaret: true,
    markName: 'textAlign',
    labelAttr: 'textAlign',
    suppressActiveHighlight: true,
    attributes: {
      ariaLabel: 'Text align',
    },
    options: [
      {
        type: 'render',
        render: () => {
          const handleSelect = (e) => {
            closeDropdown(alignment);
            const buttonWithCommand = { ...alignment, command: 'setTextAlign' };
            buttonWithCommand.command = 'setTextAlign';
            superToolbar.emitCommand({ item: buttonWithCommand, argument: e });
            setAlignmentIcon(alignment, e);
            refocusEditorSurface(superToolbar);
          };

          return h('div', {}, [
            h(AlignmentButtons, {
              onSelect: handleSelect,
            }),
          ]);
        },
        key: 'alignment',
      },
    ],
    onActivate: ({ textAlign }) => {
      setAlignmentIcon(alignment, textAlign);
    },
    onDeactivate: () => {
      setAlignmentIcon(alignment, 'left');
    },
  });

  const setAlignmentIcon = (alignment, e) => {
    let alignValue = e === 'both' ? 'justify' : e;
    let icons = {
      left: toolbarIcons.alignLeft,
      right: toolbarIcons.alignRight,
      center: toolbarIcons.alignCenter,
      justify: toolbarIcons.alignJustify,
    };

    let icon = icons[alignValue] ?? icons.left;
    alignment.icon.value = icon;
  };

  // bullet list
  const bulletedList = useToolbarItem({
    type: 'dropdown',
    name: 'list',
    command: 'toggleBulletListStyle',
    splitButton: true,
    splitButtonCommand: 'toggleBulletList',
    icon: toolbarIcons.bulletList,
    hasCaret: true,
    tooltip: toolbarTexts.bulletList,
    restoreEditorFocus: true,
    attributes: {
      ariaLabel: 'Bullet list',
    },
    options: [
      {
        type: 'render',
        key: 'bullet-style-buttons',
        render: () => {
          const handleSelect = (style) => {
            closeDropdown(bulletedList);
            const item = { ...bulletedList, command: 'toggleBulletListStyle' };
            superToolbar.emitCommand({ item, argument: style });
          };
          return h(StyleButtonsList, {
            buttons: bulletStyleButtons,
            iconSize: 25,
            selectedStyle: bulletedList.selectedValue.value,
            onSelect: handleSelect,
          });
        },
      },
    ],
  });

  // number list
  const numberedList = useToolbarItem({
    type: 'dropdown',
    name: 'numberedlist',
    command: 'toggleOrderedListStyle',
    splitButton: true,
    splitButtonCommand: 'toggleOrderedList',
    icon: toolbarIcons.numberedList,
    hasCaret: true,
    tooltip: toolbarTexts.numberedList,
    restoreEditorFocus: true,
    attributes: {
      ariaLabel: 'Numbered list',
    },
    options: [
      {
        type: 'render',
        key: 'numbered-style-buttons',
        render: () => {
          const handleSelect = (style) => {
            closeDropdown(numberedList);
            const item = { ...numberedList, command: 'toggleOrderedListStyle' };
            superToolbar.emitCommand({ item, argument: style });
          };
          return h(StyleButtonsList, {
            buttons: numberedStyleButtons,
            iconSize: 30,
            selectedStyle: numberedList.selectedValue.value,
            onSelect: handleSelect,
          });
        },
      },
    ],
  });

  // indent left
  const indentLeft = useToolbarItem({
    type: 'button',
    name: 'indentleft',
    command: 'decreaseTextIndent',
    icon: toolbarIcons.indentLeft,
    active: false,
    tooltip: toolbarTexts.indentLeft,
    disabled: false,
    attributes: {
      ariaLabel: 'Left indent',
    },
  });

  // indent right
  const indentRight = useToolbarItem({
    type: 'button',
    name: 'indentright',
    command: 'increaseTextIndent',
    icon: toolbarIcons.indentRight,
    active: false,
    tooltip: toolbarTexts.indentRight,
    disabled: false,
    attributes: {
      ariaLabel: 'Right indent',
    },
  });

  // overflow
  const overflow = useToolbarItem({
    type: 'overflow',
    name: 'overflow',
    command: null,
    icon: toolbarIcons.overflow,
    active: false,
    disabled: false,
    attributes: {
      ariaLabel: 'Overflow items',
    },
  });

  // zoom
  const zoom = useToolbarItem({
    type: 'dropdown',
    name: 'zoom',
    allowWithoutEditor: true,
    tooltip: toolbarTexts.zoom,
    defaultLabel: '100%',
    label: '100%',
    hasCaret: true,
    command: 'setZoom',
    isWide: true,
    // Keep the control width stable so changing labels (e.g. 50% -> 100%) does not shift nearby items.
    style: { width: '71px', minWidth: '71px' },
    inlineTextInputVisible: false,
    hasInlineTextInput: true,
    attributes: {
      ariaLabel: 'Zoom',
    },
    options: [
      { label: '50%', key: 0.5, props: { 'data-item': 'btn-zoom-option' } },
      { label: '75%', key: 0.75, props: { 'data-item': 'btn-zoom-option' } },
      { label: '90%', key: 0.9, props: { 'data-item': 'btn-zoom-option' } },
      { label: '100%', key: 1, props: { 'data-item': 'btn-zoom-option' } },
      { label: '125%', key: 1.25, props: { 'data-item': 'btn-zoom-option' } },
      { label: '150%', key: 1.5, props: { 'data-item': 'btn-zoom-option' } },
      { label: '200%', key: 2, props: { 'data-item': 'btn-zoom-option' } },
    ],
    onActivate: ({ zoom: value }) => {
      if (!value) return;

      zoom.label.value = value;
    },
  });

  // measurement unit (inches / centimeters) — Word's "measurement units"
  // preference. Routes through the public SuperDoc.setMeasurementUnit() instance
  // method and drives the ruler + the header/footer measurement fields.
  const measurementUnit = useToolbarItem({
    type: 'dropdown',
    name: 'measurementUnit',
    allowWithoutEditor: true,
    tooltip: toolbarTexts.measurementUnit,
    defaultLabel: 'in',
    label: 'in',
    hasCaret: true,
    command: 'setMeasurementUnit',
    group: 'right',
    // Narrow control: the label is only ever "in" or "cm".
    style: { width: '52px', minWidth: '52px' },
    inlineTextInputVisible: false,
    hasInlineTextInput: false,
    attributes: {
      ariaLabel: 'Measurement unit',
    },
    options: [
      { label: 'Inches', key: 'in', props: { 'data-item': 'btn-measurement-unit-option' } },
      { label: 'Centimeters', key: 'cm', props: { 'data-item': 'btn-measurement-unit-option' } },
    ],
    onActivate: ({ measurementUnit: value }) => {
      if (!value) return;
      measurementUnit.label.value = value;
    },
  });

  // undo
  const undo = useToolbarItem({
    type: 'button',
    name: 'undo',
    disabled: true,
    tooltip: toolbarTexts.undo,
    command: 'undo',
    icon: toolbarIcons.undo,
    group: 'left',
    attributes: {
      ariaLabel: 'Undo',
    },
  });

  // redo
  const redo = useToolbarItem({
    type: 'button',
    disabled: true,
    name: 'redo',
    tooltip: toolbarTexts.redo,
    command: 'redo',
    icon: toolbarIcons.redo,
    group: 'left',
    attributes: {
      ariaLabel: 'Redo',
    },
  });

  const acceptTrackedChangeBySelection = useToolbarItem({
    type: 'button',
    disabled: false,
    name: 'acceptTrackedChangeBySelection',
    tooltip: toolbarTexts.trackChangesAccept,
    command: 'acceptTrackedChangeFromToolbar',
    icon: toolbarIcons.trackChangesAccept,
    group: 'left',
    attributes: {
      ariaLabel: 'Accept tracked changes',
    },
  });

  const rejectTrackedChangeOnSelection = useToolbarItem({
    type: 'button',
    disabled: false,
    name: 'rejectTrackedChangeOnSelection',
    tooltip: toolbarTexts.trackChangesReject,
    command: 'rejectTrackedChangeFromToolbar',
    icon: toolbarIcons.trackChangesReject,
    group: 'left',
    attributes: {
      ariaLabel: 'Reject tracked changes',
    },
  });

  const clearFormatting = useToolbarItem({
    type: 'button',
    name: 'clearFormatting',
    command: 'clearFormat',
    tooltip: toolbarTexts.clearFormatting,
    icon: toolbarIcons.clearFormatting,
    attributes: {
      ariaLabel: 'Clear formatting',
    },
  });

  const copyFormat = useToolbarItem({
    type: 'button',
    name: 'copyFormat',
    tooltip: toolbarTexts.copyFormat,
    icon: toolbarIcons.copyFormat,
    command: 'copyFormat',
    active: false,
    attributes: {
      ariaLabel: 'Copy formatting',
    },
  });

  const getDocumentOptionsAfterRole = (role, documentOptions) => {
    if (role === 'editor') return documentOptions;
    else if (role === 'suggester') return documentOptions.filter((option) => option.value === 'suggesting');
    else return documentOptions.filter((option) => option.value === 'viewing');
  };

  const getDefaultLabel = (role) => {
    if (role === 'editor') return 'Editing';
    else if (role === 'suggester') return 'Suggesting';
    else return 'Viewing';
  };

  const documentMode = useToolbarItem({
    type: 'dropdown',
    name: 'documentMode',
    command: 'setDocumentMode',
    allowWithoutEditor: true,
    icon: toolbarIcons.documentMode,
    defaultLabel: getDefaultLabel(role),
    label: getDefaultLabel(role),
    hasCaret: role === 'editor',
    isWide: true,
    style: { display: 'flex', justifyContent: 'flex-end' },
    inlineTextInputVisible: false,
    hasInlineTextInput: false,
    group: 'right',
    disabled: role !== 'editor',
    attributes: {
      dropdownPosition: 'right',
      className: 'sd-toolbar-item--doc-mode',
      ariaLabel: 'Document mode',
    },
    options: [
      {
        type: 'render',
        render: () => renderDocumentMode(documentMode),
      },
    ],
  });

  const documentOptions = [
    {
      label: toolbarTexts.documentEditingMode,
      value: 'editing',
      icon: toolbarIcons.documentEditingMode,
      description: toolbarTexts.documentEditingModeDescription,
    },
    {
      label: toolbarTexts.documentSuggestingMode,
      value: 'suggesting',
      icon: toolbarIcons.documentSuggestingMode,
      description: toolbarTexts.documentSuggestingModeDescription,
    },
    {
      label: toolbarTexts.documentViewingMode,
      value: 'viewing',
      icon: toolbarIcons.documentViewingMode,
      description: toolbarTexts.documentViewingModeDescription,
    },
  ];

  function renderDocumentMode(renderDocumentButton) {
    const optionsAfterRole = getDocumentOptionsAfterRole(role, documentOptions);
    return h(DocumentMode, {
      options: optionsAfterRole,
      onSelect: (item) => {
        const selectedEditor = superToolbar.superdoc?.activeEditor ?? superToolbar.activeEditor;
        closeDropdown(renderDocumentButton);
        const { label, icon, value } = item;
        documentMode.label.value = label;
        documentMode.icon.value = icon;
        // Route the canonical mode value (`editing` / `suggesting` / `viewing`)
        // through the shared `document-mode` command, not the display label.
        superToolbar.emitCommand({ item: documentMode, argument: value });
        refocusEditorSurface(superToolbar, selectedEditor);
      },
    });
  }

  // define sizes to calculate toolbar overflow items
  const controlSizes = new Map([
    ['separator', 20],
    ['zoom', 71],
    ['measurementUnit', 52],
    ['fontFamily', 118],
    ['fontSize', 57],
    ['textAlign', 40],
    ['linkedStyles', 142],
    ['documentMode', 47],
    ['default', 32],
  ]);
  const stickyItemNames = ['search', 'ruler', 'undo', 'overflow', 'documentMode'];

  const ruler = useToolbarItem({
    type: 'button',
    name: 'ruler',
    command: 'toggleRuler',
    allowWithoutEditor: true,
    icon: toolbarIcons.ruler,
    active: false,
    tooltip: toolbarTexts.ruler,
    attributes: {
      ariaLabel: 'Ruler',
    },
  });

  const formattingMarks = useToolbarItem({
    type: 'button',
    name: 'formattingMarks',
    command: 'toggleFormattingMarks',
    allowWithoutEditor: true,
    icon: toolbarIcons.formattingMarks,
    active: false,
    tooltip: toolbarTexts.formattingMarks,
    attributes: {
      ariaLabel: 'Formatting marks',
    },
  });

  const linkedStyles = useToolbarItem({
    type: 'dropdown',
    name: 'linkedStyles',
    command: 'setLinkedStyle',
    tooltip: toolbarTexts.linkedStyles,
    icon: toolbarIcons.paintbrush,
    defaultLabel: toolbarTexts.formatText,
    label: toolbarTexts.formatText,
    hasCaret: true,
    isWide: true,
    style: { width: '140px' },
    suppressActiveHighlight: true,
    disabled: false,
    attributes: {
      className: 'sd-toolbar-item--linked-styles',
      ariaLabel: 'Linked styles',
    },
    options: [
      {
        type: 'render',
        key: 'linkedStyle',
        render: () => {
          const handleSelect = (style) => {
            closeDropdown(linkedStyles);
            // Normalize the selected v2 catalogue item to its stable style id
            // before routing. A bare id string is accepted too. The shared
            // `linked-style` command targets `styles.paragraph.setStyle`.
            const styleId = typeof style === 'string' ? style : (style?.id ?? null);
            if (!styleId) return;
            const itemWithCommand = { ...linkedStyles, command: 'setLinkedStyle' };
            superToolbar.emitCommand({ item: itemWithCommand, argument: styleId });
          };

          // The dropdown is populated from the shared controller's public
          // `superdoc/ui` style quick gallery (Document API `styles.getCatalog`,
          // qFormat-driven with a v1 alphabetical fallback), never toolbar-local
          // OOXML parsing. The active paragraph style seeds the selected option so
          // the gallery reflects the current selection.
          const activeStyleId = superToolbar.getActiveLinkedStyleId?.() ?? null;
          return h('div', {}, [
            h(LinkedStyle, {
              styles: superToolbar.getLinkedStyleOptions?.() ?? [],
              onSelect: handleSelect,
              selectedOption: activeStyleId,
            }),
          ]);
        },
      },
    ],
    onActivate: ({ styleId, styleName }) => {
      // The controller snapshot reports the active linked style id/name; show it
      // when set, otherwise fall back to the default "Format text" label.
      const label = styleName || styleId;
      linkedStyles.label.value = styleId && styleId !== 'Normal' ? String(label) : toolbarTexts.formatText;
      linkedStyles.disabled.value = false;
    },
    onDeactivate: () => {
      linkedStyles.disabled.value = true;
      linkedStyles.label.value = toolbarTexts.formatText;
    },
  });

  const renderIcon = (value, selectedValue) => {
    if (selectedValue.value != value) return;
    return h('div', { innerHTML: checkIconSvg, class: 'dropdown-select-icon' });
  };

  // line height
  const lineHeight = useToolbarItem({
    type: 'dropdown',
    name: 'lineHeight',
    tooltip: toolbarTexts.lineHeight,
    icon: toolbarIcons.lineHeight,
    hasCaret: false,
    hasInlineTextInput: false,
    hideLabel: true,
    inlineTextInputVisible: false,
    suppressActiveHighlight: true,
    restoreEditorFocus: true,
    isWide: false,
    command: 'setLineHeight',
    dropdownValueKey: 'key',
    selectedValue: '1',
    attributes: {
      ariaLabel: 'Line height',
    },
    options: [1, 1.15, 1.5, 2, 2.5, 3].map((lineHeightValue) => {
      return {
        label: lineHeightValue.toFixed(2),
        key: lineHeightValue,
        icon: () => renderIcon(lineHeightValue, lineHeight.selectedValue),
        props: { 'data-item': 'btn-lineHeight-option' },
      };
    }),
  });

  // Responsive toolbar calculations.
  // `availableWidth` comes from SuperToolbar and represents either:
  // - container width when `responsiveToContainer: true`
  // - viewport/document width when `responsiveToContainer: false`

  // Extra headroom to prevent toolbar jitter at the XL edge.
  const XL_OVERFLOW_SAFETY_BUFFER = 20;
  const toolbarPadding = 32;
  const itemsToHideXL = ['linkedStyles', 'clearFormatting', 'copyFormat', 'formattingMarks'];
  const itemsToHideSM = ['zoom', 'fontFamily', 'fontSize', 'redo'];
  const shouldUseLgCompactStyles = availableWidth <= RESPONSIVE_BREAKPOINTS.lg;
  const shouldIncludeFormattingMarks = superToolbar.config?.showFormattingMarksButton === true;
  const shouldIncludeTableOfContents = superToolbar.config?.showTableOfContentsButton === true;

  if (shouldUseLgCompactStyles) {
    documentMode.attributes.value = {
      ...documentMode.attributes.value,
      className: `${documentMode.attributes.value.className} sd-toolbar-item--doc-mode-compact`,
    };
  }

  if (shouldUseLgCompactStyles) {
    linkedStyles.attributes.value = {
      ...linkedStyles.attributes.value,
      className: `${linkedStyles.attributes.value.className} sd-toolbar-item--linked-styles-compact`,
    };
  }

  let toolbarItems = [
    undo,
    redo,
    acceptTrackedChangeBySelection,
    rejectTrackedChangeOnSelection,

    search,
    zoom,
    fontButton,
    makeSeparator(),
    fontSize,
    makeSeparator(),
    bold,
    italic,
    underline,
    strikethrough,
    colorButton,
    highlight,
    makeSeparator(),
    link,
    image,
    ...(shouldIncludeTableOfContents ? [tableOfContents] : []),
    ...(superToolbar.config?.showWatermarkButton || configuredItemNames?.has('watermark') ? [watermark] : []),
    tableItem,
    tableActionsItem,
    makeSeparator(),
    alignment,
    bulletedList,
    numberedList,
    indentLeft,
    indentRight,
    lineHeight,
    makeSeparator(),
    linkedStyles,
    makeSeparator(),
    ruler,
    measurementUnit,
    ...(shouldIncludeFormattingMarks ? [formattingMarks] : []),
    copyFormat,
    clearFormatting,
    ...(hasAiModule(superToolbar) ? [aiButton] : []),
    overflow,
    documentMode,
    ...additionalItems,
  ];

  // Hide separators on small screens
  if (availableWidth <= RESPONSIVE_BREAKPOINTS.md && hideButtons) {
    toolbarItems = toolbarItems.filter((item) => item.type !== 'separator');
  }

  // Remove docx only items
  if (superToolbar.config.mode !== 'docx') {
    const getLinkedStylesIndex = toolbarItems.findIndex((item) => item.name.value === 'linkedStyles');
    toolbarItems.splice(getLinkedStylesIndex - 1, 2);

    const filterItems = ['ruler', 'zoom', 'undo', 'redo'];
    toolbarItems = toolbarItems.filter((item) => !filterItems.includes(item.name.value));
  }

  // Track changes accept/reject are hidden outside dev mode for viewers.
  const devItems = [];
  if (!isDev) {
    if (role === 'viewer') {
      devItems.push(acceptTrackedChangeBySelection, rejectTrackedChangeOnSelection);
    }
    toolbarItems = toolbarItems.filter((item) => !devItems.includes(item));
  }

  // Composition and exclusions decide which controls exist before width
  // decides where they fit. Keep the overflow trigger available; its final
  // visibility is resolved after the configured controls are partitioned.
  if (configuredItemNames) {
    toolbarItems = toolbarItems.filter(
      (item) => item.name.value === 'overflow' || item.isCustomToolbarItem || configuredItemNames.has(item.name.value),
    );
  }
  if (excludedItemNames?.size) {
    toolbarItems = toolbarItems.filter((item) => !excludedItemNames.has(item.name.value));
  }

  // Always-visible items. The overflow trigger is reserved only after the
  // first pass proves that another control needs it; otherwise a focused
  // toolbar can overflow solely because space was held for a menu it did not
  // need.
  const isStickyItem = (item) => stickyItemNames.includes(item.name.value);
  const overflowTrigger = toolbarItems.find((item) => item.name.value === 'overflow');
  const layoutItems = toolbarItems.filter((item) => item !== overflowTrigger);
  const partitionItems = (reserveOverflowTrigger) => {
    const overflowItems = [];
    const visibleItems = [];
    const stickyItemsWidth = layoutItems
      .filter(isStickyItem)
      .reduce((total, item) => total + getToolbarItemWidth(item, controlSizes), 0);
    let totalWidth =
      toolbarPadding +
      stickyItemsWidth +
      (reserveOverflowTrigger && overflowTrigger ? getToolbarItemWidth(overflowTrigger, controlSizes) : 0);

    layoutItems.forEach((item, index) => {
      const itemWidth = getToolbarItemWidth(item, controlSizes);

      // `linkedStyles` is moved as one visual unit with its trailing divider.
      // Leaving that divider visible would start the next group with an orphan
      // separator whenever the style picker is forced into overflow.
      if (
        item.type === 'separator' &&
        layoutItems[index - 1]?.name.value === 'linkedStyles' &&
        overflowItems.includes(layoutItems[index - 1])
      ) {
        overflowItems.push(item);
        return;
      }

      if (
        availableWidth < RESPONSIVE_BREAKPOINTS.xl + XL_OVERFLOW_SAFETY_BUFFER &&
        itemsToHideXL.includes(item.name.value) &&
        hideButtons
      ) {
        overflowItems.push(item);
        return;
      }

      if (availableWidth < RESPONSIVE_BREAKPOINTS.sm && itemsToHideSM.includes(item.name.value) && hideButtons) {
        overflowItems.push(item);
        return;
      }

      if (isStickyItem(item)) {
        visibleItems.push(item);
        return;
      }

      if (totalWidth + itemWidth <= availableWidth || !hideButtons) {
        visibleItems.push(item);
        totalWidth += itemWidth;
      } else {
        overflowItems.push(item);
      }
    });

    return { visibleItems, overflowItems };
  };

  let { visibleItems, overflowItems } = partitionItems(false);
  if (hideButtons && overflowTrigger && overflowItems.some((item) => item.type !== 'separator')) {
    ({ visibleItems, overflowItems } = partitionItems(true));
    const triggerIndex = toolbarItems.indexOf(overflowTrigger);
    const insertAt = visibleItems.findIndex((item) => toolbarItems.indexOf(item) > triggerIndex);
    if (insertAt === -1) visibleItems.push(overflowTrigger);
    else visibleItems.splice(insertAt, 0, overflowTrigger);
  }

  return {
    defaultItems: visibleItems,
    overflowItems: overflowItems.filter((item) => item.type !== 'separator'),
  };
};
