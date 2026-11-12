import type {
  SelectionTarget,
  SuperDocUI,
  ViewportHandle,
  ViewportPositionAtInput,
  ViewportPositionAtResult,
} from 'superdoc/ui';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

const parameters: AssertEqual<Parameters<ViewportHandle['positionAt']>, [input: ViewportPositionAtInput]> = true;
const returns: AssertEqual<ReturnType<ViewportHandle['positionAt']>, Promise<ViewportPositionAtResult>> = true;
void [parameters, returns];

declare const ui: SuperDocUI;

const input: ViewportPositionAtInput = { x: 10, y: 20, signal: new AbortController().signal };
const pending: Promise<ViewportPositionAtResult> = ui.viewport.positionAt(input);

void pending.then((result) => {
  if (result.status === 'resolved') {
    const target: SelectionTarget = result.target;
    void target;
  } else {
    const status: 'no-target' | 'stale' | 'cancelled' | 'disposed' | 'unavailable' = result.status;
    void status;
  }
});
