export type DescribeElementOptions = {
  keepStyle?: (property: string, element: Element) => boolean;
  skipChildren?: (element: Element) => boolean;
};

const styleDeclarations = (element: Element, keepStyle: (property: string, element: Element) => boolean): string[] => {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return [];
  const style = element.style;
  const declarations: string[] = [];
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index);
    if (keepStyle(property, element)) declarations.push(`${property}: ${style.getPropertyValue(property)}`);
  }
  return declarations.sort();
};

const SVG_TEXT_CONTENT_TAGS = new Set(['text', 'tspan', 'textPath']);

const recordedText = (parent: Element, node: ChildNode): string | null => {
  const text = node.nodeType === node.TEXT_NODE ? node.textContent : null;
  if (!text) return null;
  const svgIgnoresWhitespace = parent instanceof SVGElement && !SVG_TEXT_CONTENT_TAGS.has(parent.tagName);
  return svgIgnoresWhitespace && text.trim() === '' ? null : text;
};

const describeInto = (element: Element, indent: string, options: DescribeElementOptions, lines: string[]): void => {
  const classes = Array.from(element.classList).sort();
  lines.push(`${indent}<${element.tagName.toLowerCase()}${classes.length ? ` class="${classes.join(' ')}"` : ''}>`);
  const inner = `${indent}  `;
  const attributes = Array.from(element.attributes)
    .filter((attribute) => attribute.name !== 'class' && attribute.name !== 'style')
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const attribute of attributes) lines.push(`${inner}${attribute.name}="${attribute.value}"`);
  for (const declaration of styleDeclarations(element, options.keepStyle ?? (() => true))) {
    lines.push(`${inner}style ${declaration}`);
  }
  if (options.skipChildren?.(element)) return;
  for (const child of Array.from(element.childNodes)) {
    if (child instanceof Element) describeInto(child, inner, options, lines);
    else {
      const text = recordedText(element, child);
      if (text) lines.push(`${inner}"${text}"`);
    }
  }
};

export const describeElement = (element: Element, options: DescribeElementOptions = {}): string => {
  const lines: string[] = [];
  describeInto(element, '', options, lines);
  return `${lines.join('\n')}\n`;
};

export const describeChildren = (element: Element, options: DescribeElementOptions = {}): string =>
  Array.from(element.children)
    .map((child) => describeElement(child, options))
    .join('');
