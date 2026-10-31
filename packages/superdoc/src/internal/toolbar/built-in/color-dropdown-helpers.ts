import { h } from 'vue';
import type { Component } from 'vue';
import IconGrid from './IconGrid.vue';
import { toolbarIcons } from './toolbarIcons.js';
import { refocusEditorSurface } from './toolbar-focus-helpers.js';
import type { BuiltInToolbar, ToolbarItem } from '../built-in-toolbar.js';

type ColorOption = { label: string; icon: string; value: string; style: Record<string, string> };

type ColorDropdownToolbar = Pick<BuiltInToolbar, 'emitCommand' | 'superdoc' | 'activeEditor'>;

type ColorDropdownButton = Pick<
  ToolbarItem,
  'name' | 'type' | 'command' | 'isCustomToolbarItem' | 'iconColor' | 'expand'
>;

const closeDropdown = (dropdown: Pick<ToolbarItem, 'expand'>) => {
  dropdown.expand.value = false;
};

const makeColorOption = (color: string, label: string): ColorOption => {
  return {
    label,
    icon: toolbarIcons.colorOption,
    value: color,
    style: {
      color,
      boxShadow: '0 0 5px 1px rgba(0, 0, 0, 0.1)',
      borderRadius: '50%',
    },
  };
};

export const renderColorOptions = (
  superToolbar: ColorDropdownToolbar,
  button: ColorDropdownButton,
  customIcons: ColorOption[][] = [],
  hasNoneIcon = false,
) => {
  const handleSelect = (color: string) => {
    button.iconColor.value = color;
    superToolbar.emitCommand({ item: button, argument: color });
    closeDropdown(button);
    refocusEditorSurface(superToolbar);
  };

  return h('div', {}, [
    h(IconGrid as Component, {
      icons,
      customIcons,
      activeColor: button.iconColor,
      hasNoneIcon,
      onSelect: handleSelect,
    }),
  ]);
};

const icons: ColorOption[][] = [
  [
    makeColorOption('#111111', 'black'),
    makeColorOption('#333333', 'dark gray'),
    makeColorOption('#5C5C5C', 'medium gray'),
    makeColorOption('#858585', 'light gray'),
    makeColorOption('#ADADAD', 'very light gray'),
    makeColorOption('#D6D6D6', 'transparent gray'),
    makeColorOption('#FFFFFF', 'white'),
  ],

  [
    makeColorOption('#860028', 'dark red'),
    makeColorOption('#D2003F', 'red'),
    makeColorOption('#DB3365', 'coral red'),
    makeColorOption('#E4668C', 'light red'),
    makeColorOption('#ED99B2', 'pale pink'),
    makeColorOption('#F6CCD9', 'transparent pink'),
    makeColorOption('#FF004D', 'bright pink'),
  ],

  [
    makeColorOption('#83015E', 'dark purple'),
    makeColorOption('#CD0194', 'purple'),
    makeColorOption('#D734A9', 'orchid'),
    makeColorOption('#E167BF', 'light purple'),
    makeColorOption('#EB99D4', 'lavender'),
    makeColorOption('#F5CCEA', 'transparent pink'),
    makeColorOption('#FF00A8', 'neon pink'),
  ],

  [
    makeColorOption('#8E220A', 'maroon'),
    makeColorOption('#DD340F', 'red-orange'),
    makeColorOption('#E45C3F', 'burnt orange'),
    makeColorOption('#EB856F', 'peach'),
    makeColorOption('#F1AE9F', 'pale peach'),
    makeColorOption('#F8D6CF', 'transparent peach'),
    makeColorOption('#FF7A00', 'orange'),
  ],

  [
    makeColorOption('#947D02', 'olive'),
    makeColorOption('#E7C302', 'mustard yellow'),
    makeColorOption('#ECCF35', 'yellow'),
    makeColorOption('#F1DB67', 'light yellow'),
    makeColorOption('#F5E79A', 'very pale yellow'),
    makeColorOption('#FAF3CC', 'transparent yellow'),
    makeColorOption('#FAFF09', 'neon yellow'),
  ],

  [
    makeColorOption('#055432', 'forest green'),
    makeColorOption('#07834F', 'green'),
    makeColorOption('#399C72', 'medium green'),
    makeColorOption('#6AB595', 'light green'),
    makeColorOption('#9CCDB9', 'mint'),
    makeColorOption('#CDE6DC', 'transparent mint'),
    makeColorOption('#05F38F', 'bright teal'),
  ],

  [
    makeColorOption('#063E7E', 'navy blue'),
    makeColorOption('#0A60C5', 'blue'),
    makeColorOption('#3B80D1', 'sky blue'),
    makeColorOption('#6CA0DC', 'cornflower blue'),
    makeColorOption('#9DBFE8', 'light blue'),
    makeColorOption('#CEDFF3', 'very light blue'),
    makeColorOption('#21c8ce', 'cyan'),
  ],

  [
    makeColorOption('#3E027A', 'deep purple'),
    makeColorOption('#6103BF', 'indigo'),
    makeColorOption('#8136CC', 'violet'),
    makeColorOption('#A068D9', 'lavender pink'),
    makeColorOption('#C09AE6', 'light lilac'),
    makeColorOption('#DFCDF2', 'transparent lilac'),
    makeColorOption('#A91DFF', 'neon purple'),
  ],
];
