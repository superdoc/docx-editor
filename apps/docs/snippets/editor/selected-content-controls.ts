import type { DocumentApi, ContentControlInfo } from 'superdoc/ui';

type Awaitable<T> = T | Promise<T>;
type SelectionDocument = {
  selection: {
    current(
      ...args: Parameters<DocumentApi['selection']['current']>
    ): Awaitable<ReturnType<DocumentApi['selection']['current']>>;
  };
  contentControls: {
    listInRange(
      ...args: Parameters<DocumentApi['contentControls']['listInRange']>
    ): Awaitable<ReturnType<DocumentApi['contentControls']['listInRange']>>;
  };
};

/** Nonempty text selections, using selection.current's document-ordered endpoints. */
export async function selectedContentControls(doc: SelectionDocument): Promise<ContentControlInfo[]> {
  const current = await doc.selection.current();
  const range = current.selectionTarget;
  if (current.empty || !range || range.start.kind !== 'text' || range.end.kind !== 'text') return [];
  const selectedStart = range.start;
  const selectedEnd = range.end;
  const items: ContentControlInfo[] = [];
  for (let offset = 0; ;) {
    const page = await doc.contentControls.listInRange({
      startBlockId: selectedStart.blockId,
      endBlockId: selectedEnd.blockId,
      offset,
      limit: 100,
    });
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || page.items.length === 0) break;
  }
  return items.filter((control) => {
    const span = control.selectionTarget;
    if (!span || span.start.kind !== 'text' || span.end.kind !== 'text') return false;
    const selectedStory = range.story ?? selectedStart.story;
    const controlStory = span.story ?? span.start.story;
    const key = (story: typeof selectedStory) =>
      !story || story.storyType === 'body' ? 'body' : JSON.stringify(story);
    if (key(selectedStory) !== key(controlStory)) return false;
    // listInRange is block-scoped. Exclude controls touching only a boundary;
    // adjacent controls in the same paragraph are not selection intersections.
    if (span.end.blockId === selectedStart.blockId && span.end.offset <= selectedStart.offset) return false;
    if (span.start.blockId === selectedEnd.blockId && span.start.offset >= selectedEnd.offset) return false;
    return true;
  });
}
