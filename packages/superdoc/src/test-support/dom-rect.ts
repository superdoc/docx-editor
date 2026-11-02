type RectEdges = { top?: number; left?: number; right?: number; bottom?: number };

export function domRect({ top = 0, left = 0, right = left, bottom = top }: RectEdges): DOMRect {
  return new DOMRect(left, top, right - left, bottom - top);
}
