export type TextareaSize = number | string;

export interface TextareaOptions {
  value?: string;
  left?: number;
  top?: number;
  width?: TextareaSize;
  height?: TextareaSize;
  fontSize?: TextareaSize;
  fontFamily?: string;
  color?: string;
  background?: string;
  resize?: string;
}

export function createTextarea(options: TextareaOptions = {}): HTMLTextAreaElement {
  const {
    value = '',
    left,
    top,
    width,
    height,
    fontSize = 16,
    fontFamily = 'Arial, sans-serif',
    color = '#000',
    background = 'transparent',
    resize = 'none',
  } = options;

  const textarea = document.createElement('textarea');
  textarea.value = value;

  const style = textarea.style;
  style.position = 'absolute';
  if (left != null) style.left = `${left}px`;
  if (top != null) style.top = `${top}px`;
  if (width != null) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height != null) style.height = typeof height === 'number' ? `${height}px` : height;
  style.minWidth = '120';
  style.fontSize = typeof fontSize === 'number' ? `${fontSize}px` : fontSize;
  style.fontFamily = fontFamily;
  style.color = color;
  style.background = background;
  style.border = '2px solid #3c97fe80';
  style.padding = '2px 4px';
  style.margin = '0';
  style.zIndex = '1000';
  style.overflow = 'hidden';
  style.resize = resize;
  style.outline = 'none';

  return textarea;
}
