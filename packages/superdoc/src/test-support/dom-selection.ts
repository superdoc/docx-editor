export function documentSelection(range: Range | null): Selection {
  const selection = document.getSelection();
  if (!selection) throw new Error('The test document has no Selection.');
  if (range && !(range.startContainer.isConnected && range.endContainer.isConnected)) {
    throw new Error('Attach the range nodes to the document first: jsdom drops a detached range.');
  }
  selection.removeAllRanges();
  if (range) selection.addRange(range);
  return selection;
}

export function rangeAcross(start: Text, end: Text): Range {
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, end.length);
  return range;
}

export function caretAt(node: Text, offset: number): Range {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  return range;
}
