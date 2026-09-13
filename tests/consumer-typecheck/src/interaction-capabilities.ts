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
  TrackChangesInteractionConfig,
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

const _commentInteractionLevel: CommentInteractionLevel = 'resolve';
const _commentInteractionConfig: CommentInteractionConfig = { level: 'write' };
const _trackChangesInteractionConfig: TrackChangesInteractionConfig = { allowDecisions: false };

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

void [
  _canonicalConfig,
  _interactionConfig,
  _commentInteractionLevel,
  _commentInteractionConfig,
  _trackChangesInteractionConfig,
  _invalidLevel,
  _levelType,
  _decisionType,
];
