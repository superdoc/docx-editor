import type { DocumentApi } from 'superdoc/ui';

export async function commentOnOneClause(doc: DocumentApi) {
  const result = await doc.query.match({
    select: { type: 'text', pattern: 'Confidential Information' },
    require: 'exactlyOne',
  });
  const match = result.items[0];

  if (!match || match.matchKind !== 'text') throw new Error('The clause was not found.');

  const receipt = await doc.comments.create(
    { text: 'Please review this definition.', target: match.target },
    { expectedRevision: result.evaluatedRevision },
  );
  if (!receipt.success) throw new Error(receipt.failure.message);

  return receipt;
}
