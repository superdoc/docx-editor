import { ref } from 'vue';
import { v4 as uuidv4 } from 'uuid';

export const useToolbarItem = (options) => {
  const types = ['button', 'options', 'separator', 'dropdown', 'overflow'];
  if (!types.includes(options.type)) {
    throw new Error('Invalid toolbar item type - ' + options.type);
  }

  // `label` is deliberately not accepted here. It is the *live* label a
  // built-in item rewrites as state changes (the font name, the current
  // style), so an item carrying only `label` has nothing to draw before that
  // first update. `defaultLabel` is the static fallback the button renders
  // from. The message used to say "icon or label" while testing `defaultLabel`,
  // which told a consumer whose button had `label: 'Save'` to add the label
  // they had already written.
  if (options.type === 'button' && !options.defaultLabel && !options.icon) {
    throw new Error(
      `Toolbar button item needs either "icon" or "defaultLabel" - ${options.name}. ` +
        '"label" is the live label and is not a substitute for "defaultLabel".',
    );
  }

  if (!options.name) {
    throw new Error('Invalid toolbar item name - ' + options.name);
  }

  const id = ref(uuidv4());
  const type = options.type;
  const name = ref(options.name);
  const command = options.command;
  const noArgumentCommand = options.noArgumentCommand;
  const icon = ref(options.icon);
  const group = ref(options.group || 'center');
  const allowWithoutEditor = ref(options.allowWithoutEditor);
  const attributes = ref(options.attributes || {});

  const initiallyDisabled = Boolean(options.disabled);
  const disabled = ref(options.disabled);
  const active = ref(false);
  const expand = ref(false);

  // top-level style
  const style = ref(options.style);
  const isNarrow = ref(options.isNarrow);
  const isWide = ref(options.isWide);
  const layoutWidth = ref(options.layoutWidth);
  const suppressActiveHighlight = ref(options.suppressActiveHighlight || false);

  const argument = ref(options.argument);
  const childItem = ref(null);
  const parentItem = ref(null);

  // icon properties
  const iconColor = ref(options.iconColor);
  const hasCaret = ref(options.hasCaret);
  const splitButton = ref(Boolean(options.splitButton));
  const splitButtonCommand = options.splitButtonCommand;
  const restoreEditorFocus = Boolean(options.restoreEditorFocus);

  // dropdown properties
  const dropdownStyles = ref(options.dropdownStyles);

  // tooltip properties
  const tooltip = ref(options.tooltip);
  const tooltipVisible = ref(options.tooltipVisible);
  const tooltipTimeout = ref(options.tooltipTimeout);

  // behavior
  const defaultLabel = ref(options.defaultLabel);
  const label = ref(options.label);
  const hideLabel = ref(options.hideLabel);
  const inlineTextInputVisible = ref(options.inlineTextInputVisible);
  const hasInlineTextInput = ref(options.hasInlineTextInput);

  const markName = ref(options.markName);
  const labelAttr = ref(options.labelAttr);

  // Dropdown item
  const selectedValue = ref(options.selectedValue);
  const dropdownValueKey = ref(options.dropdownValueKey);

  const inputRef = ref(options.inputRef || null);

  const nestedOptions = ref([]);
  if (options.options) {
    if (!Array.isArray(options.options)) throw new Error('Invalid toolbar item options - ' + options.options);
    // Rows are read unguarded while rendering (`option.key`, `option.label`,
    // `option.disabled` in `ToolbarDropdown.vue`), so a `null` or a bare string
    // in this array throws inside Vue's render rather than at construction.
    // That failure is not recoverable the way a bad item is: it tears down the
    // app and the whole toolbar disappears. Dropping the unusable rows keeps
    // the damage to the rows themselves.
    // Scope: rows that tear the toolbar down, not rows that render badly.
    // `null`, a primitive, and a sparse hole are all dereferenced by
    // `ToolbarDropdown` while rendering, which throws inside Vue and takes the
    // app with it -- unrecoverable, so the entry has to be refused here. An
    // object missing `label` or `key` renders a blank row or selects as
    // `undefined`: wrong, but survivable and visible, and rejecting the whole
    // entry for it would remove a control a consumer may be mid-way through
    // wiring up. `ToolbarCustomDropdownOption` rejects those shapes at compile
    // time for anyone using TypeScript.
    //
    // Indexed rather than `filter`, because `filter` skips holes: a sparse
    // array (`new Array(2)`, or one with a deleted element) reports zero
    // unusable rows and the spread below then materializes each hole as
    // `undefined`.
    let unusable = 0;
    for (let index = 0; index < options.options.length; index += 1) {
      const option = options.options[index];
      if (!option || typeof option !== 'object') unusable += 1;
    }
    if (unusable) {
      throw new Error(
        `Toolbar item options must all be objects - ${options.name}. ` +
          `${unusable} row(s) are not, so this item is skipped.`,
      );
    }
    nestedOptions.value?.push(...options.options);
  }

  // Activation & Deactivation
  const activate = (attrs = {}, ...args) => {
    onActivate(attrs, ...args);

    if (suppressActiveHighlight.value) return;
    active.value = true;
  };

  const deactivate = () => {
    onDeactivate();
    active.value = false;
  };

  const setDisabled = (state) => {
    disabled.value = state;
  };

  const resetDisabled = () => {
    disabled.value = initiallyDisabled;
  };

  // User can override this behavior
  const onActivate = options.onActivate || (() => null);
  const onDeactivate = options.onDeactivate || (() => null);

  const unref = () => {
    const flattened = {};
    Object.keys(refs).forEach((key) => {
      if (refs[key].value !== undefined) {
        flattened[key] = refs[key].value;
      }
    });
    return flattened;
  };

  const refs = {
    id,
    name,
    type,
    command,
    noArgumentCommand,
    icon,
    tooltip,
    group,
    attributes,
    disabled,
    active,
    expand,
    nestedOptions,

    style,
    isNarrow,
    isWide,
    layoutWidth,
    argument,
    parentItem,
    iconColor,
    hasCaret,
    splitButton,
    splitButtonCommand,
    dropdownStyles,
    tooltipVisible,
    tooltipTimeout,
    defaultLabel,
    label,
    hideLabel,
    inlineTextInputVisible,
    hasInlineTextInput,
    restoreEditorFocus,
    markName,
    labelAttr,
    childItem,

    allowWithoutEditor,
    dropdownValueKey,
    selectedValue,
    inputRef,
  };

  return {
    ...refs,
    initiallyDisabled,
    unref,
    activate,
    deactivate,
    setDisabled,
    resetDisabled,
    onActivate,
    onDeactivate,
  };
};
