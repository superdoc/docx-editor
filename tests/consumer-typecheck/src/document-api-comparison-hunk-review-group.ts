import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
const changes = doc.trackChanges.list({ in: 'all' });
for (const change of changes.items) {
  const group = change.reviewGroup;
  if (group?.role !== 'parent') continue;
  if (group.kind !== 'comparison-hunk') continue;
  const kind: 'comparison-hunk' = group.kind;
  const groupOrigin: 'comparison-hunk' = group.groupOrigin;
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
  void [kind, groupOrigin];
}
