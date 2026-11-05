/**
 * Client-side interaction policy, separate from the UI that SuperDoc renders.
 *
 * `modules.comments` currently mixes the two. Highlight styling and `layout`
 * describe the built-in comment UI, while comment capability
 * and tracked-change decisions stay meaningful when the application renders
 * its own UI. Under `ui: false` the built-in dialog is gone, but interaction
 * policy still has to reject forbidden mutations.
 *
 * Keeping policy separate means an application can disable the built-in
 * comments UI without losing the rules enforced by its custom UI.
 */

import { isPlainObject } from '../../helpers/object-guards.js';
import type {
  CommentInteractionConfig,
  CommentInteractionLevel,
  Config,
  InteractionConfig,
  Modules,
  TouchInteractionConfig,
  TrackChangesInteractionConfig,
} from '../types/index.js';

type InteractionSource = Pick<Config, 'interaction' | 'modules'>;

type LegacyCommentsConfig = Exclude<Modules['comments'], false | undefined>;

type NormalizedInteractionConfig = {
  comments: {
    level: CommentInteractionLevel;
    readOnly: boolean;
    allowResolve: boolean;
  };
  trackedChanges: { allowDecisions: boolean };
  touch: { gestures: boolean };
};

const isCommentInteractionLevel = (value: unknown): value is CommentInteractionLevel =>
  value === 'read' || value === 'write' || value === 'resolve';

/**
 * Resolve the effective interaction policy.
 *
 * Canonical comment and tracked-change fields resolve independently.
 * Deprecated `readOnly` keeps its historical effect on both comment writes
 * and tracked-change decisions. Deprecated `allowResolve` affects only
 * resolve and reopen actions.
 */
export function normalizeInteractionConfig(config: InteractionSource = {}): NormalizedInteractionConfig {
  const interaction: InteractionConfig = isPlainObject(config.interaction) ? config.interaction : {};
  const interactionComments: CommentInteractionConfig = isPlainObject(interaction.comments) ? interaction.comments : {};
  const interactionTrackedChanges: TrackChangesInteractionConfig = isPlainObject(interaction.trackedChanges)
    ? interaction.trackedChanges
    : {};

  // `modules.comments` is `false | object | undefined`. `false` disables the
  // built-in UI, which says nothing about policy, so it contributes no
  // legacy values rather than reading as "everything permitted".
  const legacyComments: LegacyCommentsConfig = isPlainObject(config.modules?.comments) ? config.modules.comments : {};

  const legacyReadOnly = (interactionComments.readOnly ?? legacyComments.readOnly ?? false) === true;
  const legacyAllowResolve = (interactionComments.allowResolve ?? legacyComments.allowResolve ?? true) !== false;
  const canonicalLevel = interactionComments.level;
  const hasCanonicalLevel = isCommentInteractionLevel(canonicalLevel);
  const level = hasCanonicalLevel ? canonicalLevel : legacyReadOnly ? 'read' : legacyAllowResolve ? 'resolve' : 'write';

  const canonicalAllowDecisions = interactionTrackedChanges.allowDecisions;
  const interactionTouch: TouchInteractionConfig = isPlainObject(interaction.touch) ? interaction.touch : {};

  return {
    comments: {
      level,
      // Keep the resolved booleans for existing custom UI consumers and the
      // comments store. Canonical `level` wins when both shapes are present.
      readOnly: hasCanonicalLevel ? level === 'read' : legacyReadOnly,
      allowResolve: hasCanonicalLevel ? level === 'resolve' : legacyAllowResolve,
    },
    trackedChanges: {
      // Deprecated `readOnly` blocked accept/reject as well as comment writes.
      // Preserve that behavior unless the new dedicated field is explicit.
      allowDecisions: typeof canonicalAllowDecisions === 'boolean' ? canonicalAllowDecisions : !legacyReadOnly,
    },
    touch: {
      gestures: interactionTouch.gestures === true,
    },
  };
}
