import type { ToolbarConfig } from 'superdoc';

export const toolbar = {
  container: '#toolbar',
  excludeItems: ['highlight-color'],
  customItems: [
    {
      type: 'dropdown',
      id: 'word-highlight',
      label: 'Word highlight',
      hasCaret: true,
      command: 'highlight-color',
      options: [
        { id: 'none', label: 'No Color', value: 'none' },
        { id: 'yellow', label: 'Yellow', value: 'yellow' },
        { id: 'green', label: 'Bright Green', value: 'green' },
        { id: 'cyan', label: 'Turquoise', value: 'cyan' },
        { id: 'magenta', label: 'Pink', value: 'magenta' },
        { id: 'blue', label: 'Blue', value: 'blue' },
        { id: 'red', label: 'Red', value: 'red' },
        { id: 'darkBlue', label: 'Dark Blue', value: 'darkBlue' },
        { id: 'darkCyan', label: 'Teal', value: 'darkCyan' },
        { id: 'darkGreen', label: 'Green', value: 'darkGreen' },
        { id: 'darkMagenta', label: 'Violet', value: 'darkMagenta' },
        { id: 'darkRed', label: 'Dark Red', value: 'darkRed' },
        { id: 'darkYellow', label: 'Dark Yellow', value: 'darkYellow' },
        { id: 'darkGray', label: 'Gray-50%', value: 'darkGray' },
        { id: 'lightGray', label: 'Gray-25%', value: 'lightGray' },
        { id: 'black', label: 'Black', value: 'black' },
      ],
    },
  ],
} satisfies ToolbarConfig;
