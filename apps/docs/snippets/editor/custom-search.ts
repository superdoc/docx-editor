import { SuperDoc } from 'superdoc';
import type { UIConfig } from 'superdoc';
import type { SearchSnapshot, WorkflowActionResult } from 'superdoc/ui';
import 'superdoc/style.css';

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing search control: ${selector}`);
  return element;
}

const searchForm = getElement<HTMLFormElement>('#search-controls');
const query = getElement<HTMLInputElement>('#search-query');
const matchCase = getElement<HTMLInputElement>('#match-case');
const includeDeletions = getElement<HTMLInputElement>('#include-deletions');
const previous = getElement<HTMLButtonElement>('#previous-match');
const next = getElement<HTMLButtonElement>('#next-match');
const count = getElement<HTMLOutputElement>('#search-count');
const replacement = getElement<HTMLInputElement>('#replacement');
const replace = getElement<HTMLButtonElement>('#replace-match');
const replaceAll = getElement<HTMLButtonElement>('#replace-all');
const status = getElement<HTMLParagraphElement>('#search-status');

const editorUi = { search: false } satisfies UIConfig;
let stopBindings: (() => void) | null = null;
let replacementPending = false;
let actionStatus = '';

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/search-sample.docx',
  ui: editorUi,
  onReady: ({ superdoc: readySuperDoc }) => {
    stopBindings?.();
    replacementPending = false;
    actionStatus = '';
    const { search } = readySuperDoc.ui;

    const render = (snapshot: SearchSnapshot) => {
      const hasMatches = snapshot.total > 0;
      query.disabled = replacementPending;
      matchCase.disabled = replacementPending;
      includeDeletions.disabled = replacementPending;
      previous.disabled = !hasMatches || replacementPending;
      next.disabled = !hasMatches || replacementPending;
      replacement.disabled = replacementPending;
      // `canReplace` is document mutability; a replacement still needs a match.
      replace.disabled = !hasMatches || !snapshot.canReplace || replacementPending;
      // A truncated match set can replace the active match but not all of them.
      replaceAll.disabled = !snapshot.canReplaceAll || replacementPending;
      count.textContent = hasMatches
        ? snapshot.activeIndex >= 0
          ? `${snapshot.activeIndex + 1} of ${snapshot.total}`
          : `${snapshot.total} matches`
        : 'No matches';
      status.textContent = snapshot.reason ?? actionStatus;
    };

    const runSearch = () => {
      actionStatus = '';
      if (!query.value) {
        search.clear();
        return;
      }
      search.find(query.value, {
        caseSensitive: matchCase.checked,
        includeTrackedDeletions: includeDeletions.checked,
      });
    };

    const report = (result: WorkflowActionResult) => {
      actionStatus = result.ok ? '' : (result.reason ?? 'The search action is unavailable.');
      status.textContent = actionStatus;
    };

    const runReplacement = async (action: () => WorkflowActionResult | Promise<WorkflowActionResult>) => {
      if (replacementPending) return;
      replacementPending = true;
      render(search.getSnapshot());
      try {
        report(await action());
      } finally {
        replacementPending = false;
        render(search.getSnapshot());
      }
    };
    const replaceCurrent = () => runReplacement(() => search.replace(replacement.value));
    const replaceEveryMatch = () => runReplacement(() => search.replaceAll(replacement.value));
    const goPrevious = () => report(search.previous());
    const goNext = () => report(search.next());
    const preventSubmit = (event: SubmitEvent) => event.preventDefault();

    const stopSearch = search.observe(render);
    searchForm.addEventListener('submit', preventSubmit);
    query.addEventListener('input', runSearch);
    matchCase.addEventListener('change', runSearch);
    includeDeletions.addEventListener('change', runSearch);
    // Text typed before the document opened has no session yet. Run it now.
    runSearch();
    previous.addEventListener('click', goPrevious);
    next.addEventListener('click', goNext);
    replace.addEventListener('click', replaceCurrent);
    replaceAll.addEventListener('click', replaceEveryMatch);

    stopBindings = () => {
      stopSearch();
      search.close();
      searchForm.removeEventListener('submit', preventSubmit);
      query.removeEventListener('input', runSearch);
      matchCase.removeEventListener('change', runSearch);
      includeDeletions.removeEventListener('change', runSearch);
      previous.removeEventListener('click', goPrevious);
      next.removeEventListener('click', goNext);
      replace.removeEventListener('click', replaceCurrent);
      replaceAll.removeEventListener('click', replaceEveryMatch);
    };
  },
  onContentError: ({ error }) => {
    status.textContent = 'The document could not be opened.';
    console.error(error);
  },
  onException: ({ error }) => {
    status.textContent = 'The document could not be opened.';
    console.error(error);
  },
});

window.addEventListener('beforeunload', () => {
  stopBindings?.();
  superdoc.destroy();
});
