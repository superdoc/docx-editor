import { ref } from 'vue';
import type { CSSProperties, Ref } from 'vue';
import { v4 as uuidv4 } from 'uuid';

const TOOLBAR_ITEM_TYPES = ['button', 'options', 'separator', 'dropdown', 'overflow'] as const;

export type ToolbarItemType = (typeof TOOLBAR_ITEM_TYPES)[number];

export interface ToolbarItemOption {
  key?: string | number;
  label?: string;
  type?: string;
  disabled?: boolean;
  class?: unknown;
  props?: Record<string, unknown>;
  icon?: string | object | ((option: ToolbarItemOption) => unknown);
  render?: () => unknown;
  [member: string]: unknown;
}

export type ToolbarItemAttributes = { ariaLabel?: string; className?: unknown; [attribute: string]: unknown };

export type ToolbarItemStyle = string | CSSProperties;

export type ToolbarActivationAttributes = Record<string, unknown>;

export interface UseToolbarItemOptions {
  type: ToolbarItemType;
  name: string;
  command?: unknown;
  noArgumentCommand?: string;
  icon?: string;
  group?: string;
  allowWithoutEditor?: boolean;
  attributes?: ToolbarItemAttributes;
  disabled?: boolean;
  style?: ToolbarItemStyle;
  isNarrow?: boolean;
  isWide?: boolean;
  layoutWidth?: number;
  suppressActiveHighlight?: boolean;
  argument?: unknown;
  iconColor?: string;
  hasCaret?: boolean;
  splitButton?: boolean;
  splitButtonCommand?: unknown;
  restoreEditorFocus?: boolean;
  dropdownStyles?: unknown;
  tooltip?: string;
  tooltipVisible?: boolean;
  tooltipTimeout?: number;
  defaultLabel?: string;
  label?: string;
  hideLabel?: boolean;
  inlineTextInputVisible?: boolean;
  hasInlineTextInput?: boolean;
  markName?: string;
  labelAttr?: string;
  selectedValue?: string | number | null;
  dropdownValueKey?: string;
  inputRef?: unknown;
  options?: readonly ToolbarItemOption[];
  onActivate?: (attributes: ToolbarActivationAttributes, isMultiple?: boolean) => unknown;
  onDeactivate?: () => unknown;
}

export interface ToolbarItem {
  type: ToolbarItemType;
  id: Ref<string>;
  name: Ref<string>;
  command?: unknown;
  noArgumentCommand?: string;
  splitButtonCommand?: unknown;
  group: Ref<string>;
  attributes: Ref<ToolbarItemAttributes>;
  disabled: Ref<boolean | undefined>;
  active: Ref<boolean>;
  expand: Ref<boolean>;
  nestedOptions: Ref<ToolbarItemOption[]>;
  label: Ref<string | undefined>;
  defaultLabel: Ref<string | undefined>;
  icon: Ref<string | undefined>;
  selectedValue: Ref<string | number | null | undefined>;
  hideLabel: Ref<boolean | undefined>;
  iconColor: Ref<string | undefined>;
  hasCaret: Ref<boolean | undefined>;
  splitButton: Ref<boolean>;
  inlineTextInputVisible: Ref<boolean | undefined>;
  hasInlineTextInput: Ref<boolean | undefined>;
  style: Ref<ToolbarItemStyle | undefined>;
  isNarrow: Ref<boolean | undefined>;
  isWide: Ref<boolean | undefined>;
  layoutWidth: Ref<number | undefined>;
  tooltip: Ref<string | undefined>;
  tooltipVisible: Ref<boolean | undefined>;
  tooltipTimeout: Ref<number | undefined>;
  argument: Ref<unknown>;
  restoreEditorFocus: boolean;
  dropdownStyles: Ref<unknown>;
  dropdownValueKey: Ref<string | undefined>;
  allowWithoutEditor: Ref<boolean | undefined>;
  markName: Ref<string | undefined>;
  labelAttr: Ref<string | undefined>;
  inputRef: Ref<unknown>;
  childItem: unknown;
  parentItem: unknown;
  initiallyDisabled: boolean;
  isCustomToolbarItem?: boolean;
  activate(attributes?: ToolbarActivationAttributes, isMultiple?: boolean): void;
  deactivate(): void;
  setDisabled(state: boolean): void;
  resetDisabled(): void;
  onActivate(attributes: ToolbarActivationAttributes, isMultiple?: boolean): unknown;
  onDeactivate(): unknown;
}

function isToolbarItemType(value: unknown): value is ToolbarItemType {
  return TOOLBAR_ITEM_TYPES.some((type) => type === value);
}

export const useToolbarItem = (options: UseToolbarItemOptions): ToolbarItem => {
  if (!isToolbarItemType(options.type)) {
    throw new Error('Invalid toolbar item type - ' + options.type);
  }

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
  const attributes = ref<ToolbarItemAttributes>(options.attributes || {});

  const initiallyDisabled = Boolean(options.disabled);
  const disabled = ref(options.disabled);
  const active = ref(false);
  const expand = ref(false);

  const style = ref(options.style);
  const isNarrow = ref(options.isNarrow);
  const isWide = ref(options.isWide);
  const layoutWidth = ref(options.layoutWidth);
  const suppressActiveHighlight = ref(options.suppressActiveHighlight || false);

  const argument = ref(options.argument);
  const childItem = ref(null);
  const parentItem = ref(null);

  const iconColor = ref(options.iconColor);
  const hasCaret = ref(options.hasCaret);
  const splitButton = ref(Boolean(options.splitButton));
  const splitButtonCommand = options.splitButtonCommand;
  const restoreEditorFocus = Boolean(options.restoreEditorFocus);

  const dropdownStyles = ref(options.dropdownStyles);

  const tooltip = ref(options.tooltip);
  const tooltipVisible = ref(options.tooltipVisible);
  const tooltipTimeout = ref(options.tooltipTimeout);

  const defaultLabel = ref(options.defaultLabel);
  const label = ref(options.label);
  const hideLabel = ref(options.hideLabel);
  const inlineTextInputVisible = ref(options.inlineTextInputVisible);
  const hasInlineTextInput = ref(options.hasInlineTextInput);

  const markName = ref(options.markName);
  const labelAttr = ref(options.labelAttr);

  const selectedValue = ref(options.selectedValue);
  const dropdownValueKey = ref(options.dropdownValueKey);

  const inputRef = ref(options.inputRef || null);

  const nestedOptions = ref<ToolbarItemOption[]>([]);
  if (options.options) {
    if (!Array.isArray(options.options)) throw new Error('Invalid toolbar item options - ' + options.options);
    let unusable = 0;
    for (let index = 0; index < options.options.length; index += 1) {
      const option: unknown = options.options[index];
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

  const activate = (attrs: ToolbarActivationAttributes = {}, isMultiple?: boolean) => {
    onActivate(attrs, isMultiple);

    if (suppressActiveHighlight.value) return;
    active.value = true;
  };

  const deactivate = () => {
    onDeactivate();
    active.value = false;
  };

  const setDisabled = (state: boolean) => {
    disabled.value = state;
  };

  const resetDisabled = () => {
    disabled.value = initiallyDisabled;
  };

  const onActivate = options.onActivate || (() => null);
  const onDeactivate = options.onDeactivate || (() => null);

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
    activate,
    deactivate,
    setDisabled,
    resetDisabled,
    onActivate,
    onDeactivate,
  };
};
