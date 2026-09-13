import type { Config, TrackChangesConfig, TrackChangesModuleConfig, TrackChangesReplacementMode } from 'superdoc';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

const mode: TrackChangesReplacementMode = 'separate';
const trackChanges = {
  enabled: true,
  replacementMode: mode,
} satisfies TrackChangesConfig;

const config = {
  selector: '#editor',
  trackChanges,
} satisfies Config;

const previousModuleConfig = {
  replacements: 'independent',
} satisfies TrackChangesModuleConfig;

const previousConfig = {
  selector: '#editor',
  modules: { trackChanges: previousModuleConfig },
} satisfies Config;

type ConfigReplacementMode = NonNullable<NonNullable<Config['trackChanges']>['replacementMode']>;
type _ReplacementMode = Expect<Equal<ConfigReplacementMode, 'grouped' | 'separate'>>;

const invalidConfig = {
  selector: '#editor',
  trackChanges: {
    // @ts-expect-error Public replacement modes describe the review behavior.
    replacementMode: 'independent',
  },
} satisfies Config;

const invalidPreviousModule = {
  // @ts-expect-error The new field is top-level, not part of the previous module path.
  replacementMode: 'separate',
} satisfies TrackChangesModuleConfig;

void [config, previousConfig, invalidConfig, invalidPreviousModule];
