import { Map as YMap } from 'yjs';

export function createCollaborationCommentMap(entries: Iterable<[string, unknown]>): YMap<unknown> {
  return new YMap(entries);
}
