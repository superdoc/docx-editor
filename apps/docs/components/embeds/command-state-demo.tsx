'use client';

import { Bold } from 'lucide-react';
import { useState } from 'react';

const selectionOptions = [
  {
    id: 'normal',
    label: 'Normal text',
    sample: 'Terms apply for twelve months.',
  },
  {
    id: 'bold',
    label: 'Bold text',
    sample: 'Payment is due within 30 days.',
  },
  {
    id: 'locked',
    label: 'Locked heading',
    sample: 'Services agreement',
  },
] as const;

type SelectionId = (typeof selectionOptions)[number]['id'];
type ActiveState = Record<Exclude<SelectionId, 'locked'>, boolean>;
type ExecutionResult = { status: 'idle' | 'success'; message: string };

const disabledReason = 'The current selection cannot be formatted.';
const initialResult: ExecutionResult = { status: 'idle', message: 'Run Bold to see the command result.' };

export function CommandStateDemo() {
  const [selection, setSelection] = useState<SelectionId>('normal');
  const [activeState, setActiveState] = useState<ActiveState>({ bold: true, normal: false });
  const [result, setResult] = useState<ExecutionResult>(initialResult);

  const enabled = selection !== 'locked';
  const active = selection === 'locked' ? false : activeState[selection];
  const reason = enabled ? undefined : disabledReason;

  function toggleBold() {
    if (selection === 'locked') return;
    const nextActive = !activeState[selection];
    setActiveState((current) => ({ ...current, [selection]: nextActive }));
    setResult({
      status: 'success',
      message: `{ success: true } — Bold ${nextActive ? 'applied' : 'removed'}.`,
    });
  }

  function selectSample(nextSelection: SelectionId) {
    setSelection(nextSelection);
    setResult(
      nextSelection === 'locked'
        ? { status: 'idle', message: 'No result. Bold is unavailable for this selection.' }
        : initialResult,
    );
  }

  return (
    <figure className='sd-command-state-demo' data-command-state-demo>
      <figcaption className='sd-command-state-demo-heading'>
        <span>Interactive model</span>
        <strong>Watch one control follow the selection</strong>
        <p>
          Choose sample content, then press Bold. The selection is simulated so each state is immediate. A real
          controller derives the same values from the active Editor selection.
        </p>
      </figcaption>

      <div className='sd-command-state-demo-body'>
        <div className='sd-command-state-demo-document' aria-label='Simulated document selection'>
          {selectionOptions.map((option) => {
            const selected = selection === option.id;
            const sampleIsBold = option.id === 'bold' ? activeState.bold : option.id === 'normal' && activeState.normal;

            return (
              <button
                aria-pressed={selected}
                className='sd-command-state-demo-selection'
                data-selection={option.id}
                key={option.id}
                onClick={() => selectSample(option.id)}
                type='button'
              >
                <span>{option.label}</span>
                <span className={sampleIsBold ? 'sd-command-state-demo-bold-sample' : undefined}>{option.sample}</span>
              </button>
            );
          })}
        </div>

        <div className='sd-command-state-demo-controller'>
          <div className='sd-command-state-demo-toolbar'>
            <span>Your toolbar</span>
            <button
              aria-label='Toggle bold for the simulated selection'
              aria-pressed={active}
              disabled={!enabled}
              onClick={toggleBold}
              title={reason}
              type='button'
            >
              <Bold aria-hidden='true' size={16} strokeWidth={2.25} />
              Bold
            </button>
          </div>

          <dl className='sd-command-state-demo-readout'>
            <div>
              <dt>enabled</dt>
              <dd>{String(enabled)}</dd>
            </div>
            <div>
              <dt>active</dt>
              <dd>{String(active)}</dd>
            </div>
            <div>
              <dt>reason</dt>
              <dd>{reason ?? 'undefined'}</dd>
            </div>
            <div data-result={result.status}>
              <dt>result</dt>
              <dd>
                <output aria-live='polite'>{result.message}</output>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </figure>
  );
}
