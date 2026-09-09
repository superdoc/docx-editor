'use client';

import { Check, FileText, Play, RotateCcw, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { lifecycleFailure, lifecycleStages, type LifecycleStage, type LifecycleStageId } from '@/lib/lifecycle-journey';

type ActiveLifecycleStage = LifecycleStage | typeof lifecycleFailure;

function DocumentSheet({ edited = false }: { edited?: boolean }) {
  return (
    <div className='sd-lifecycle-document' aria-hidden='true'>
      <FileText size={18} strokeWidth={1.75} />
      <strong>Statement of work</strong>
      <span />
      <span />
      <span className={edited ? 'sd-lifecycle-document-edit' : undefined} />
      <span />
    </div>
  );
}

function ApplicationPreview({
  stage,
  onRetry,
  onExport,
}: {
  stage: ActiveLifecycleStage;
  onRetry: () => void;
  onExport: () => void;
}) {
  const edited = stage.appView === 'edited' || (stage.appView === 'exported' && stage.appTone === 'dirty');

  return (
    <div className='sd-lifecycle-preview'>
      <div className='sd-lifecycle-app'>
        <div className='sd-lifecycle-appbar'>
          <strong>Document editor</strong>
          <button disabled={!stage.actionsEnabled} onClick={onExport} type='button'>
            Export
          </button>
          <output className='sd-lifecycle-app-status' data-tone={stage.appTone} aria-live='polite'>
            <span aria-hidden='true' />
            {stage.appStatus}
          </output>
        </div>

        <div className='sd-lifecycle-appbody'>
          {stage.appView === 'loading' && (
            <div className='sd-lifecycle-document sd-lifecycle-document-loading' aria-label='Document loading'>
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          )}
          {(stage.appView === 'document' || stage.appView === 'exported' || edited) && (
            <DocumentSheet edited={edited} />
          )}
          {stage.appView === 'exported' && (
            <div className='sd-lifecycle-saved' role='status'>
              <Check aria-hidden='true' size={13} /> DOCX copy downloaded
            </div>
          )}
          {stage.appView === 'unmounted' && <div className='sd-lifecycle-empty'>Editor container released</div>}
          {stage.appView === 'error' && (
            <div className='sd-lifecycle-error' role='alert'>
              <strong>Could not open sample.docx</strong>
              <span>Check the file URL, response, and CORS policy.</span>
              <button onClick={onRetry} type='button'>
                <RotateCcw aria-hidden='true' size={13} /> Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LifecycleJourney() {
  const [activeId, setActiveId] = useState<LifecycleStageId | 'failure'>('mount');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCleanExport, setIsCleanExport] = useState(false);
  const selectedStage =
    activeId === 'failure'
      ? lifecycleFailure
      : (lifecycleStages.find((stage) => stage.id === activeId) ?? lifecycleStages[0]);
  const activeStage: ActiveLifecycleStage =
    selectedStage.id === 'export' && isCleanExport
      ? { ...selectedStage, appStatus: 'Ready', appTone: 'ready' }
      : selectedStage;
  const activeIndex = lifecycleStages.findIndex((stage) => stage.id === activeId);

  useEffect(() => {
    if (!isPlaying) return;

    setIsCleanExport(false);
    let nextIndex = 0;
    setActiveId(lifecycleStages[nextIndex].id);
    const timer = window.setInterval(() => {
      nextIndex += 1;
      if (nextIndex >= lifecycleStages.length) {
        window.clearInterval(timer);
        setIsPlaying(false);
        return;
      }
      setActiveId(lifecycleStages[nextIndex].id);
    }, 1500);

    return () => window.clearInterval(timer);
  }, [isPlaying]);

  function chooseStage(id: LifecycleStageId | 'failure') {
    setIsPlaying(false);
    setIsCleanExport(false);
    setActiveId(id);
  }

  return (
    <section className='sd-lifecycle-journey' aria-label='Editor lifecycle journey'>
      <div className='sd-lifecycle-nav'>
        <div className='sd-lifecycle-stages' role='group' aria-label='Lifecycle stage'>
          {lifecycleStages.map((stage, index) => (
            <button
              aria-pressed={activeId === stage.id}
              data-complete={activeIndex > index}
              key={stage.id}
              onClick={() => chooseStage(stage.id)}
              type='button'
            >
              <span className='sd-lifecycle-step'>{index + 1}</span>
              <strong>{stage.label}</strong>
              <code>{stage.signal}</code>
            </button>
          ))}
        </div>

        <div className='sd-lifecycle-secondary-actions'>
          <button
            aria-pressed={activeId === 'failure'}
            className='sd-lifecycle-failure-button'
            onClick={() => chooseStage('failure')}
            type='button'
          >
            <span aria-hidden='true'>!</span>
            <strong>Load fails</strong>
            <code>onContentError / onException</code>
          </button>
          <button
            aria-pressed={isPlaying}
            className='sd-lifecycle-play'
            onClick={() => setIsPlaying((playing) => !playing)}
            type='button'
          >
            {isPlaying ? <Square aria-hidden='true' size={11} /> : <Play aria-hidden='true' size={11} />}
            {isPlaying ? 'Stop' : 'Play lifecycle'}
          </button>
        </div>
      </div>

      <div className='sd-lifecycle-stage-view'>
        <ApplicationPreview
          stage={activeStage}
          onRetry={() => chooseStage('mount')}
          onExport={() => {
            const clean = activeStage.appTone !== 'dirty';
            chooseStage('export');
            setIsCleanExport(clean);
          }}
        />

        <div className='sd-lifecycle-detail'>
          <code className='sd-lifecycle-signal'>{activeStage.signal}</code>
          <h3>{activeStage.title}</h3>
          <p>{activeStage.description}</p>
          <DynamicCodeBlock code={activeStage.code} lang='ts' codeblock={{ className: 'sd-lifecycle-code' }} />
        </div>
      </div>
    </section>
  );
}
