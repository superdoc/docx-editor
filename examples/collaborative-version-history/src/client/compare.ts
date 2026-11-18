import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import { ApiError, api } from './api.ts';

declare global {
  interface Window {
    comparisonExample: { superdoc: SuperDoc | null; reviewItems: number | null; error: string | null };
  }
}

const title = document.getElementById('title');
const status = document.getElementById('status');
const download = document.getElementById('download') as HTMLAnchorElement | null;
if (!title || !status || !download) throw new Error('The comparison page is incomplete.');

const params = new URLSearchParams(window.location.search);
const from = params.get('from') ?? '';
const to = params.get('to') ?? '';
title.textContent = `Changes from ${from} to ${to}`;
window.comparisonExample = { superdoc: null, reviewItems: null, error: null };

try {
  const { docx, reviewItems } = await api.compare(from, to);
  download.href = URL.createObjectURL(docx);
  download.download = `${from}-to-${to}.docx`;
  window.comparisonExample.reviewItems = reviewItems;
  window.comparisonExample.superdoc = new SuperDoc({
    selector: '#comparison',
    document: new File([docx], `${from}-to-${to}.docx`, { type: docx.type }),
    documentMode: 'viewing',
    viewing: { trackedChanges: 'markup' },
    onReady: () => {
      status.textContent =
        reviewItems === 0 ? 'No differences.' : `${reviewItems} tracked change${reviewItems === 1 ? '' : 's'}.`;
    },
  });
} catch (error) {
  const message = error instanceof ApiError ? error.message : 'The comparison failed.';
  window.comparisonExample.error = message;
  status.textContent = message;
  if (error instanceof ApiError && Array.isArray(error.body.blockers)) {
    status.textContent += ` ${error.body.blockers.map((blocker: { message?: string }) => blocker.message).join(' ')}`;
  }
  if (!(error instanceof ApiError)) console.error(error);
}
