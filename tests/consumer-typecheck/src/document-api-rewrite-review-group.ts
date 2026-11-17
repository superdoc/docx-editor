import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
const changes = doc.trackChanges.list({ in: 'all' });
const scoped = doc.trackChanges.list({ blockIds: ['paragraph-id'], offset: 0, limit: 1 });
const scopedTotal: number = scoped.total;
void scopedTotal;
for (const change of changes.items) {
  const group = change.reviewGroup;
  if (group?.role !== 'parent') continue;
  if (group.kind !== 'text-rewrite') continue;
  const kind: 'text-rewrite' = group.kind;
  const children: readonly string[] = group.childChangeIds;
  for (const id of children) {
    const child = doc.trackChanges.get({ id });
    const parentId: string | undefined = child.reviewGroup?.parentId;
    const receipt = doc.trackChanges.decide({ decision: 'accept', target: { kind: 'id', id: child.id } });
    const success: boolean = receipt.success;
    void [parentId, success];
  }
  for (const member of group.members) {
    const id: string = member.id;
    const type: 'insertion' | 'deletion' | 'replacement' | 'formatting' | 'move' | 'structural' = member.type;
    const rawId: string | undefined = member.sourceIds.wordIdInsert;
    void [id, type, rawId];
  }
  void kind;
}
