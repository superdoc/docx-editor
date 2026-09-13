import type { ToolbarConfig } from '@superdoc/react';

const toolbar = {
  items: {
    left: ['undo', 'redo'],
    center: ['bold', 'italic'],
    right: ['zoom'],
  },
  responsiveTo: 'container',
} satisfies ToolbarConfig;

export const ui = { toolbar };
