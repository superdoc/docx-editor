import type { ToolbarConfig } from 'superdoc';

export const toolbar = {
  container: '#toolbar',
  items: {
    left: ['undo', 'redo'],
    center: ['bold', 'italic'],
    right: ['zoom'],
  },
  responsiveTo: 'container',
} satisfies ToolbarConfig;
