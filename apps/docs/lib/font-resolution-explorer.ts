import type { FontResolutionRecord } from 'superdoc';

type FontResolutionDiagnostic = Pick<FontResolutionRecord, 'reason' | 'loadStatus' | 'systemAvailability' | 'missing'>;

export type FontResolutionScenario = {
  id: string;
  label: string;
  description: string;
  logicalFamily: FontResolutionRecord['logicalFamily'];
  provider: string;
  physicalFamily: FontResolutionRecord['physicalFamily'];
  exportFamily: FontResolutionRecord['exportFamily'];
  diagnostic: FontResolutionDiagnostic;
};

export const fontResolutionScenarios = [
  {
    id: 'system',
    label: 'System font',
    description: 'No font assets are configured. This device already has Aptos installed.',
    logicalFamily: 'Aptos',
    provider: 'Installed Aptos',
    physicalFamily: 'Aptos',
    exportFamily: 'Aptos',
    diagnostic: {
      reason: 'as_requested',
      loadStatus: 'unloaded',
      systemAvailability: 'available',
      missing: false,
    },
  },
  {
    id: 'hosted',
    label: 'Hosted font',
    description: 'The application hosts and registers a licensed Aptos face.',
    logicalFamily: 'Aptos',
    provider: '/fonts/aptos-regular.woff2',
    physicalFamily: 'Aptos',
    exportFamily: 'Aptos',
    diagnostic: {
      reason: 'registered_face',
      loadStatus: 'loaded',
      missing: false,
    },
  },
  {
    id: 'unavailable',
    label: 'Unavailable font',
    description: 'SuperDoc keeps the requested family in the CSS, but the browser paints an unidentified fallback.',
    logicalFamily: 'Aptos',
    provider: 'No usable Aptos face',
    physicalFamily: 'Aptos',
    exportFamily: 'Aptos',
    diagnostic: {
      reason: 'as_requested',
      loadStatus: 'unloaded',
      systemAvailability: 'unavailable',
      missing: true,
    },
  },
] as const satisfies readonly FontResolutionScenario[];

export type FontResolutionScenarioId = (typeof fontResolutionScenarios)[number]['id'];

export function isFontResolutionScenarioId(value: string): value is FontResolutionScenarioId {
  return fontResolutionScenarios.some((scenario) => scenario.id === value);
}

function diagnosticMarkdown(scenario: FontResolutionScenario) {
  const values = [
    `reason: \`${scenario.diagnostic.reason}\``,
    `loadStatus: \`${scenario.diagnostic.loadStatus}\``,
    scenario.diagnostic.systemAvailability
      ? `systemAvailability: \`${scenario.diagnostic.systemAvailability}\``
      : undefined,
    `missing: \`${scenario.diagnostic.missing}\``,
  ].filter((value): value is string => Boolean(value));

  return values.join('; ');
}

export function renderFontResolutionExplorerMarkdown() {
  const rows = fontResolutionScenarios.map(
    (scenario) =>
      `> | ${scenario.label} | ${scenario.logicalFamily} | ${scenario.provider} | ${scenario.physicalFamily} | ${scenario.exportFamily} | ${diagnosticMarkdown(scenario)} |`,
  );

  return [
    '> **Interactive model: how a document font resolves**',
    '>',
    '> | Scenario | DOCX requests | Provider | SuperDoc resolves | DOCX exports | Diagnostic |',
    '> | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
