import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/contract.docx',
  onReady: async ({ superdoc }) => {
    const doc = superdoc.activeEditor?.doc;
    if (!doc) throw new Error('The active document is unavailable.');

    const [companyResult, liabilityResult] = await Promise.all([
      doc.query.match({
        select: { type: 'text', pattern: 'Amazing' },
        require: 'exactlyOne',
      }),
      doc.query.match({
        select: { type: 'text', pattern: '$500,000' },
        require: 'exactlyOne',
      }),
    ]);

    const company = companyResult.items[0];
    const liability = liabilityResult.items[0];

    if (!company || company.matchKind !== 'text' || !liability || liability.matchKind !== 'text') {
      throw new Error('The expected contract text was not found.');
    }

    if (companyResult.evaluatedRevision !== liabilityResult.evaluatedRevision) {
      throw new Error('The document changed while the plan targets were being collected.');
    }

    const plan = {
      atomic: true as const,
      changeMode: 'tracked' as const,
      author: { name: 'AI Reviewer' },
      steps: [
        {
          id: 'rename-company',
          op: 'text.rewrite' as const,
          where: {
            by: 'select' as const,
            select: { type: 'text' as const, pattern: 'Amazing' },
            require: 'exactlyOne' as const,
          },
          args: { replacement: { text: 'Northstar' } },
        },
        {
          id: 'lower-liability-cap',
          op: 'text.rewrite' as const,
          where: {
            by: 'select' as const,
            select: { type: 'text' as const, pattern: '$500,000' },
            require: 'exactlyOne' as const,
          },
          args: { replacement: { text: '$250,000' } },
        },
      ],
    };

    const preview = await doc.mutations.preview(plan);
    if (!preview.valid) {
      throw new Error(preview.failures?.map((failure) => failure.message).join('; ') ?? 'Plan preview failed.');
    }

    const receipt = await doc.mutations.apply({ ...plan, expectedRevision: preview.evaluatedRevision });
    console.log('Applied steps:', receipt.steps);
  },
});

window.addEventListener('beforeunload', () => {
  superdoc.destroy();
});
