'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'fumadocs-ui/components/ui/tabs';
import {
  fontResolutionScenarios,
  isFontResolutionScenarioId,
  type FontResolutionScenario,
  type FontResolutionScenarioId,
} from '@/lib/font-resolution-explorer';

const stages = [
  { key: 'logicalFamily', label: 'DOCX requests' },
  { key: 'provider', label: 'Provider' },
  { key: 'physicalFamily', label: 'SuperDoc resolves' },
  { key: 'exportFamily', label: 'DOCX exports' },
] as const;

function Diagnostic({ scenario }: { scenario: FontResolutionScenario }) {
  return (
    <dl className='sd-font-resolution-diagnostic'>
      <div>
        <dt>reason</dt>
        <dd>{scenario.diagnostic.reason}</dd>
      </div>
      <div>
        <dt>loadStatus</dt>
        <dd>{scenario.diagnostic.loadStatus}</dd>
      </div>
      {scenario.diagnostic.systemAvailability ? (
        <div>
          <dt>systemAvailability</dt>
          <dd>{scenario.diagnostic.systemAvailability}</dd>
        </div>
      ) : null}
      <div className={scenario.diagnostic.missing ? 'sd-font-resolution-missing' : undefined}>
        <dt>missing</dt>
        <dd>{String(scenario.diagnostic.missing)}</dd>
      </div>
    </dl>
  );
}

export function FontResolutionExplorer() {
  const [selected, setSelected] = useState<FontResolutionScenarioId>('system');

  return (
    <figure
      aria-labelledby='font-resolution-explorer-title'
      className='sd-font-resolution'
      data-font-resolution-explorer='true'
    >
      <figcaption id='font-resolution-explorer-title'>
        Compare the provider, rendered family, and exported name.
      </figcaption>

      <Tabs
        onValueChange={(value) => {
          if (isFontResolutionScenarioId(value)) setSelected(value);
        }}
        value={selected}
      >
        <TabsList aria-label='Font resolution scenarios' className='sd-font-resolution-tabs'>
          {fontResolutionScenarios.map((scenario) => (
            <TabsTrigger className='sd-font-resolution-trigger' key={scenario.id} value={scenario.id}>
              {scenario.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {fontResolutionScenarios.map((scenario) => (
          <TabsContent className='sd-font-resolution-content' key={scenario.id} value={scenario.id}>
            <p className='sd-font-resolution-description'>{scenario.description}</p>
            <ol className='sd-font-resolution-flow'>
              {stages.map((stage) => (
                <li key={stage.key}>
                  <span>{stage.label}</span>
                  <strong>{scenario[stage.key]}</strong>
                </li>
              ))}
            </ol>
            <Diagnostic scenario={scenario} />
          </TabsContent>
        ))}
      </Tabs>
    </figure>
  );
}
