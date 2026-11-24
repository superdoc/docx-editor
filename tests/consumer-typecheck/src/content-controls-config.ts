import type {
  Config,
  ContentControlActiveChangePayload,
  ContentControlBlockBoxOptions,
  ContentControlInlineBoxOptions,
  ContentControlPresentation,
  ContentControlsConfig,
  ContentControlClickPayload,
  ContentControlRef,
  SdtRef,
} from 'superdoc';

const canonical: Pick<Config, 'ui'> = {
  ui: { contentControls: false },
};

const canonicalEnabled: Pick<Config, 'ui'> = {
  ui: { contentControls: true },
};

const compatibleObject: Pick<Config, 'ui'> = {
  ui: { contentControls: { chrome: 'none' } },
};

const chip: ContentControlInlineBoxOptions = {
  layout: { paddingInline: 6, paddingBlock: { start: 2, end: 4 }, borderWidth: 1 },
  appearance: { borderColor: '#1355ff', borderStyle: 'solid', borderRadius: 4 },
  className: 'binding-chip',
  data: { kind: 'binding' },
};

const iconChip: ContentControlInlineBoxOptions = {
  ...chip,
  icon: { src: '/icons/link.svg', size: 12, gap: 4 },
};
const iconSize: number | undefined = iconChip.icon?.size;

const frame: ContentControlBlockBoxOptions = {
  layout: { paddingInline: 6, paddingBlock: { start: 2, end: 4 }, borderWidth: 1 },
  appearance: { borderColor: '#1355ff', borderStyle: 'dashed', borderRadius: 4, backgroundColor: '#eef3ff' },
  className: 'binding-frame',
};
const framePadding: ContentControlBlockBoxOptions['layout'] = frame.layout;

const presentation: ContentControlPresentation = {
  match: { tagPrefix: 'fgBindingV1:' },
  inlineBox: chip,
  blockBox: frame,
};

const presentationConfig: ContentControlsConfig = {
  enabled: false,
  presentations: [presentation],
};

const presentationUi: Pick<Config, 'ui'> = {
  ui: { contentControls: presentationConfig },
};

const enabledFlag: boolean | undefined = presentationConfig.enabled;
const presentationList: ContentControlPresentation[] | undefined = presentationConfig.presentations;

type MatchIsRequired = {} extends Pick<ContentControlPresentation, 'match'> ? false : true;
const matchIsRequired: MatchIsRequired = true;

const compatibleModule: Pick<Config, 'modules'> = {
  modules: { contentControls: { chrome: 'default' } },
};

const callbacks: Pick<Config, 'onContentControlActiveChange' | 'onContentControlClick'> = {
  onContentControlActiveChange(payload: ContentControlActiveChangePayload) {
    const active: ContentControlRef | null = payload.active;
    const previous: ContentControlRef | null = payload.previous;
    const path: ContentControlRef[] = payload.activePath;
    const source: 'keyboard' | 'pointer' = payload.source;
    void [active, previous, path, source];
  },
  onContentControlClick(payload: ContentControlClickPayload) {
    const target: ContentControlRef = payload.target;
    const source: 'pointer' = payload.source;
    void [target, source];
  },
};

const compatibleRef: SdtRef = {
  id: 'control-1',
  controlType: 'tenant-defined-control' as string,
  scope: 'inline',
};

const controlType: ContentControlRef['controlType'] = 'checkbox';

// @ts-expect-error ContentControlRef uses the Document API's content-control type union.
const invalidControlType: ContentControlRef['controlType'] = 'custom';

void [
  canonical,
  canonicalEnabled,
  compatibleObject,
  presentationUi,
  iconSize,
  framePadding,
  enabledFlag,
  presentationList,
  matchIsRequired,
  compatibleModule,
  callbacks,
  compatibleRef,
  controlType,
  invalidControlType,
];
