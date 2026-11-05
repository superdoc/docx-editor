/**
 * Consumer typecheck: canonical Editor interaction capabilities.
 *
 * The input keeps comment actions separate from tracked-change decisions. The
 * resolved getter exposes the canonical fields and the deprecated booleans
 * retained for existing custom interfaces.
 */
import type {
  CommentInteractionConfig,
  CommentInteractionLevel,
  Config,
  InteractionConfig,
  SuperDoc,
  TouchInteractionConfig,
  TrackChangesInteractionConfig,
  WritingAssistanceConfig,
} from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

const _canonicalConfig: Config = {
  selector: '#editor',
  interaction: {
    comments: { level: 'write' },
    trackedChanges: { allowDecisions: false },
  },
};

const _interactionConfig: InteractionConfig = {
  comments: { level: 'read' },
  trackedChanges: { allowDecisions: true },
};

const _touchGestures: Config = {
  selector: '#editor',
  interaction: { touch: { gestures: true } },
};
const _touchInteractionConfig: TouchInteractionConfig = { gestures: false };

const _invalidTouchGestures: Config = {
  selector: '#editor',
  interaction: {
    // @ts-expect-error touch gestures are an explicit boolean opt-in.
    touch: { gestures: 'auto' },
  },
};

const _commentInteractionLevel: CommentInteractionLevel = 'resolve';
const _commentInteractionConfig: CommentInteractionConfig = { level: 'write' };
const _trackChangesInteractionConfig: TrackChangesInteractionConfig = { allowDecisions: false };

const _writingAssistanceConfig: WritingAssistanceConfig = {
  autocorrect: true,
  autocapitalize: 'sentences',
  spellcheck: true,
};
const _writingAssistanceInteraction: Config = {
  selector: '#editor',
  interaction: { writingAssistance: { autocapitalize: 'words' } },
};

const _invalidWritingAssistance: Config = {
  selector: '#editor',
  interaction: {
    // @ts-expect-error autocapitalize accepts only off, sentences, words, or characters.
    writingAssistance: { autocapitalize: 'always' },
  },
};

const _invalidLevel: Config = {
  selector: '#editor',
  interaction: {
    // @ts-expect-error comment capability accepts only read, write, or resolve.
    comments: { level: 'comment' },
  },
};

declare const sd: SuperDoc;
const _levelType: AssertEqual<typeof sd.interactionConfig.comments.level, 'read' | 'write' | 'resolve'> = true;
const _decisionType: AssertEqual<typeof sd.interactionConfig.trackedChanges.allowDecisions, boolean> = true;
const _touchGesturesType: AssertEqual<typeof sd.interactionConfig.touch.gestures, boolean> = true;
const _writingAssistanceEnabledType: AssertEqual<typeof sd.interactionConfig.writingAssistance.enabled, boolean> = true;
const _autocapitalizeType: AssertEqual<
  typeof sd.interactionConfig.writingAssistance.autocapitalize,
  'off' | 'sentences' | 'words' | 'characters'
> = true;

void [
  _canonicalConfig,
  _interactionConfig,
  _commentInteractionLevel,
  _commentInteractionConfig,
  _trackChangesInteractionConfig,
  _invalidLevel,
  _levelType,
  _decisionType,
  _touchGestures,
  _touchInteractionConfig,
  _invalidTouchGestures,
  _touchGesturesType,
  _writingAssistanceConfig,
  _writingAssistanceInteraction,
  _invalidWritingAssistance,
  _writingAssistanceEnabledType,
  _autocapitalizeType,
];
