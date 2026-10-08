/**
 * Position validation (painter-scoped, story-aware, content-free).
 *
 * Replaces the former module-global, text-bearing validator. Its job is
 * unchanged in spirit — observe whether each rendered run carries the
 * coordinates its editing surface needs — but three defects are fixed:
 *
 *  1. PRIVACY: no field in this module ever carries document text, URLs, field
 *     values, source paths, relationship ids, bookmark names, paragraph ids, or
 *     DOM. The former `textPreview` (up to 20 chars of customer text copied to
 *     stderr) is gone. Only content-free STRUCTURAL dimensions are recorded.
 *
 *  2. SCOPE: the collector is owned by a single `DomPainter` instance, not a
 *     module global, so the live surface and a fresh-state oracle never mix
 *     counts.
 *
 *  3. STORY AWARENESS: a v1-era "every run needs a document-global PM span"
 *     assertion is replaced by a per-run requirement derived from the host's
 *     coordinate model and the run's story. A v2 header/footer/note run has a
 *     named story and legitimately has no document-global PM — that is
 *     `pm-not-applicable`, not a warning.
 *
 * Dark-observability contract (mirrors `paintWorkAttribution`): disabled unless
 * a painter opts in via `PositionValidationOptions.enabled`. When disabled,
 * `record()` is a single branch with no allocation. When enabled it counts into
 * bounded aggregate keys (<=64 structural groups) and drains via `consume()`.
 * Console output obeys an explicit policy (`off | summary | verbose`) — never
 * `NODE_ENV`.
 */

import type { LayoutStoryKind, LayoutStoryLocator } from '@superdoc/contracts';

/**
 * Which editor coordinate model the host is painting under. The host owns this
 * choice; the painter never infers editor semantics from the presence of a
 * number.
 *
 * - `legacy-pm`: v1 input — every text-bearing run requires a document-global
 *   `pmStart`/`pmEnd` span.
 * - `editor-neutral-story`: v2 — body runs still carry compatibility PM spans
 *   during migration, but named stories (headers/footers/notes/textboxes) are
 *   addressed by story identity, not a body PM offset.
 */
export type PaintCoordinateModel = 'legacy-pm' | 'editor-neutral-story';

/** The coordinate obligation a single run must satisfy, once classified. */
export type RunCoordinateRequirement =
  | 'legacy-pm-required'
  | 'story-identity-required'
  | 'visual-only'
  | 'not-addressable';

/** Console verbosity. `off` is production and the performance `--quiet` mode. */
export type PositionValidationConsolePolicy = 'off' | 'summary' | 'verbose';

/** Which painter produced the observation (kept isolated per painter instance). */
export type PaintKind = 'persistent-page' | 'persistent-page-oracle' | 'semantic';

/** Execution realm, for cross-realm report comparison. */
export type PaintRealm = 'node-headless' | 'browser-inline' | 'browser-worker' | 'product';

export type PositionValidationSection = 'body' | 'header' | 'footer';

export type PositionRunKind = 'text' | 'image' | 'field' | 'math';

/** Structural issue codes. None carry content. */
export type PositionValidationCode =
  | 'missing-start'
  | 'missing-end'
  | 'missing-both'
  | 'invalid-range'
  | 'identity-missing'
  | 'story-section-mismatch'
  | 'unexpected-story';

const ALL_CODES: readonly PositionValidationCode[] = [
  'missing-start',
  'missing-end',
  'missing-both',
  'invalid-range',
  'identity-missing',
  'story-section-mismatch',
  'unexpected-story',
];

const ALL_REQUIREMENTS: readonly RunCoordinateRequirement[] = [
  'legacy-pm-required',
  'story-identity-required',
  'visual-only',
  'not-addressable',
];

/** Bounded caps (see the plan's volume budgets). */
const MAX_GROUPS = 64;
const MAX_UNEXPECTED_KEYS = 20;
const MAX_VERBOSE_LINES = 20;

/**
 * The content-free structural tuple that keys aggregation and is echoed in
 * `unexpectedKeys`. Every field is a small enum or boolean — never an id or
 * text.
 */
export interface PositionValidationStructuralKey {
  coordinateModel: PaintCoordinateModel;
  requirement: RunCoordinateRequirement;
  storyKind: LayoutStoryKind;
  storyNamed: boolean;
  section: PositionValidationSection;
  runKind: PositionRunKind;
  code?: PositionValidationCode;
}

export interface PositionValidationGroupRow extends PositionValidationStructuralKey {
  checked: number;
  valid: number;
  issues: number;
}

export interface PositionValidationRequirementTally {
  checked: number;
  valid: number;
  issues: number;
}

/**
 * Bounded, content-free snapshot of one painter's validation coverage since the
 * last consume. Safe to serialize into a performance report.
 */
export interface PositionValidationSummary {
  enabled: boolean;
  coordinateModel: PaintCoordinateModel;
  paintKind: PaintKind;
  realm: PaintRealm;
  /** Total runs observed. */
  checked: number;
  /** Runs that met their requirement. */
  valid: number;
  /** Runs that failed their requirement (checked - valid). */
  issues: number;
  issuesByCode: Record<PositionValidationCode, number>;
  byRequirement: Record<RunCoordinateRequirement, PositionValidationRequirementTally>;
  /** Distinct verbose lines withheld after the verbose cap was reached. */
  suppressedConsole: number;
  /** Distinct structural groups seen (<= MAX_GROUPS retained). */
  groupCount: number;
  /** Run observations not retained after MAX_GROUPS distinct keys (still counted in totals). */
  groupsOverflowed: number;
  /** Aggregate rows, capped at MAX_GROUPS, most-issues first. */
  groups: PositionValidationGroupRow[];
  /** First unexpected (issue-bearing) structural keys, capped and content-free. */
  unexpectedKeys: PositionValidationStructuralKey[];
}

/** A single run's content-free observation, handed to the collector. */
export interface RunPositionObservation {
  runKind: PositionRunKind;
  section: PositionValidationSection;
  story?: LayoutStoryLocator;
  pmStart?: number | null;
  pmEnd?: number | null;
  /**
   * True for render-only dynamic display text (PAGE / NUMPAGES / section-page
   * fields) that mints no editable coordinate. Such runs are `visual-only`.
   */
  renderOnly?: boolean;
}

export interface PositionValidationOptions {
  /** Dark by default; the perf harness enables it for its proof. */
  enabled?: boolean;
  /** Host-selected coordinate model. Defaults to the strict `legacy-pm`. */
  coordinateModel?: PaintCoordinateModel;
  /** Console policy. Defaults to `off` (counters only). */
  policy?: PositionValidationConsolePolicy;
  /** Which painter this is; keeps oracle and product coverage separable. */
  paintKind?: PaintKind;
  /** Execution realm for report comparison. */
  realm?: PaintRealm;
}

const emptyRequirementTally = (): Record<RunCoordinateRequirement, PositionValidationRequirementTally> => {
  const out = {} as Record<RunCoordinateRequirement, PositionValidationRequirementTally>;
  for (const r of ALL_REQUIREMENTS) out[r] = { checked: 0, valid: 0, issues: 0 };
  return out;
};

const emptyCodeTally = (): Record<PositionValidationCode, number> => {
  const out = {} as Record<PositionValidationCode, number>;
  for (const c of ALL_CODES) out[c] = 0;
  return out;
};

/**
 * Derive the story kind used for classification and reporting. The story
 * locator, when present, is authoritative; otherwise we fall back to the paint
 * section. Never defaults an absent-yet-non-body story to `body`.
 */
export const resolveStoryKind = (
  section: PositionValidationSection,
  story: LayoutStoryLocator | undefined,
): LayoutStoryKind => {
  if (story) return story.kind;
  // No story locator: body is the only surface that legitimately omits one.
  return section === 'body' ? 'body' : section;
};

/**
 * Pure classification: which coordinate obligation does this run carry?
 * Exported for unit testing.
 */
export const classifyRequirement = (
  coordinateModel: PaintCoordinateModel,
  storyKind: LayoutStoryKind,
  renderOnly: boolean,
): RunCoordinateRequirement => {
  if (renderOnly) return 'visual-only';
  if (coordinateModel === 'legacy-pm') return 'legacy-pm-required';
  // editor-neutral-story (v2)
  switch (storyKind) {
    case 'body':
      // v2 body carries compatibility PM spans during migration.
      return 'legacy-pm-required';
    case 'header':
    case 'footer':
    case 'footnote':
    case 'endnote':
    case 'textbox':
      return 'story-identity-required';
    case 'unknown':
    default:
      // Fail closed. Never treat an unknown story as body.
      return 'not-addressable';
  }
};

/**
 * Evaluate the observation against its requirement. Returns `null` when valid,
 * or a structural issue code. Content-free.
 */
const evaluate = (
  obs: RunPositionObservation,
  requirement: RunCoordinateRequirement,
  storyKind: LayoutStoryKind,
  storyNamed: boolean,
): PositionValidationCode | null => {
  // Textboxes are nested stories: they can live in body, header, or footer
  // geometry while retaining their own editor-neutral story identity. Other
  // cross-section combinations indicate that a fragment inherited the wrong
  // render context.
  if (
    (obs.section === 'body' && (storyKind === 'header' || storyKind === 'footer')) ||
    (obs.section === 'header' && storyKind !== 'header' && storyKind !== 'textbox') ||
    (obs.section === 'footer' && storyKind !== 'footer' && storyKind !== 'textbox')
  ) {
    return 'story-section-mismatch';
  }

  switch (requirement) {
    case 'visual-only':
      return null;
    case 'legacy-pm-required': {
      if (obs.pmStart == null && obs.pmEnd == null) return 'missing-both';
      if (obs.pmStart == null) return 'missing-start';
      if (obs.pmEnd == null) return 'missing-end';
      if (
        !Number.isInteger(obs.pmStart) ||
        !Number.isInteger(obs.pmEnd) ||
        obs.pmStart < 0 ||
        obs.pmEnd < obs.pmStart
      ) {
        return 'invalid-range';
      }
      return null;
    }
    case 'story-identity-required': {
      // A named furniture/note story must carry a resolvable identity. Body-kind
      // here would mean a misroute; unknown is caught by not-addressable.
      if (storyKind === 'unknown') return 'unexpected-story';
      if (!storyNamed && storyKind !== 'body') return 'identity-missing';
      return null;
    }
    case 'not-addressable':
    default:
      return 'unexpected-story';
  }
};

const structuralKeyString = (key: PositionValidationStructuralKey): string =>
  `${key.coordinateModel}|${key.requirement}|${key.storyKind}|${key.storyNamed ? 1 : 0}|${key.section}|${key.runKind}`;

interface GroupAccumulator extends PositionValidationStructuralKey {
  checked: number;
  valid: number;
  issues: number;
}

/**
 * Painter-scoped collector. One instance per `DomPainter`. Bounded memory:
 * counters are O(1), the group map is capped at MAX_GROUPS, and no per-run
 * event array is ever retained.
 */
export class PositionValidationCollector {
  private readonly enabled: boolean;
  private readonly coordinateModel: PaintCoordinateModel;
  private readonly policy: PositionValidationConsolePolicy;
  private readonly paintKind: PaintKind;
  private readonly realm: PaintRealm;

  private groups: Map<string, GroupAccumulator> | null = null;
  private groupsOverflowed = 0;
  private checked = 0;
  private valid = 0;
  private issues = 0;
  private issuesByCode: Record<PositionValidationCode, number> | null = null;
  private byRequirement: Record<RunCoordinateRequirement, PositionValidationRequirementTally> | null = null;
  private unexpectedKeys: PositionValidationStructuralKey[] | null = null;
  private unexpectedKeysSeen: Set<string> | null = null;
  private verboseKeysSeen: Set<string> | null = null;
  private verboseLines = 0;
  private suppressedConsole = 0;

  constructor(options?: PositionValidationOptions) {
    this.enabled = options?.enabled ?? false;
    this.coordinateModel = options?.coordinateModel ?? 'legacy-pm';
    this.policy = options?.policy ?? 'off';
    this.paintKind = options?.paintKind ?? 'persistent-page';
    this.realm = options?.realm ?? 'product';
    if (this.enabled) {
      this.groups = new Map();
      this.issuesByCode = emptyCodeTally();
      this.byRequirement = emptyRequirementTally();
      this.unexpectedKeys = [];
      this.unexpectedKeysSeen = new Set();
      this.verboseKeysSeen = new Set();
    }
  }

  clone(policy: PositionValidationConsolePolicy = this.policy): PositionValidationCollector {
    const clone = new PositionValidationCollector({
      enabled: this.enabled,
      coordinateModel: this.coordinateModel,
      policy,
      paintKind: this.paintKind,
      realm: this.realm,
    });
    clone.groups = this.groups ? new Map([...this.groups].map(([key, group]) => [key, { ...group }])) : null;
    clone.groupsOverflowed = this.groupsOverflowed;
    clone.checked = this.checked;
    clone.valid = this.valid;
    clone.issues = this.issues;
    clone.issuesByCode = this.issuesByCode ? { ...this.issuesByCode } : null;
    clone.byRequirement = this.byRequirement
      ? (Object.fromEntries(Object.entries(this.byRequirement).map(([key, tally]) => [key, { ...tally }])) as Record<
          RunCoordinateRequirement,
          PositionValidationRequirementTally
        >)
      : null;
    clone.unexpectedKeys = this.unexpectedKeys?.map((key) => ({ ...key })) ?? null;
    clone.unexpectedKeysSeen = this.unexpectedKeysSeen ? new Set(this.unexpectedKeysSeen) : null;
    clone.verboseKeysSeen = this.verboseKeysSeen ? new Set(this.verboseKeysSeen) : null;
    clone.verboseLines = this.verboseLines;
    clone.suppressedConsole = this.suppressedConsole;
    return clone;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  record(obs: RunPositionObservation): void {
    // The one production branch. No allocation, no work when dark.
    if (!this.enabled) return;

    const storyKind = resolveStoryKind(obs.section, obs.story);
    const storyNamed = typeof obs.story?.id === 'string' && obs.story.id.length > 0;
    const requirement = classifyRequirement(this.coordinateModel, storyKind, obs.renderOnly === true);
    const code = evaluate(obs, requirement, storyKind, storyNamed);
    const groups = this.groups!;
    const byRequirement = this.byRequirement!;
    const issuesByCode = this.issuesByCode!;
    const unexpectedKeys = this.unexpectedKeys!;
    const unexpectedKeysSeen = this.unexpectedKeysSeen!;

    this.checked += 1;
    const reqTally = byRequirement[requirement];
    reqTally.checked += 1;

    const keyBase: PositionValidationStructuralKey = {
      coordinateModel: this.coordinateModel,
      requirement,
      storyKind,
      storyNamed,
      section: obs.section,
      runKind: obs.runKind,
    };
    const keyStr = structuralKeyString(keyBase);
    let group = groups.get(keyStr);
    if (!group) {
      if (groups.size >= MAX_GROUPS) {
        this.groupsOverflowed += 1;
      } else {
        group = { ...keyBase, checked: 0, valid: 0, issues: 0 };
        groups.set(keyStr, group);
      }
    }

    if (code == null) {
      this.valid += 1;
      reqTally.valid += 1;
      if (group) {
        group.checked += 1;
        group.valid += 1;
      }
      return;
    }

    this.issues += 1;
    reqTally.issues += 1;
    issuesByCode[code] += 1;
    if (group) {
      group.checked += 1;
      group.issues += 1;
    }

    const codeKey = `${keyStr}|${code}`;
    if (unexpectedKeys.length < MAX_UNEXPECTED_KEYS && !unexpectedKeysSeen.has(codeKey)) {
      unexpectedKeysSeen.add(codeKey);
      unexpectedKeys.push({ ...keyBase, code });
    }

    this.emitVerbose(keyBase, code, keyStr);
  }

  /** Verbose-mode: one content-free warning per NEW structural key, capped. */
  private emitVerbose(keyBase: PositionValidationStructuralKey, code: PositionValidationCode, keyStr: string): void {
    if (this.policy !== 'verbose') return; // 'summary' emits once at consume().
    const codeKey = `${keyStr}|${code}`;
    if (this.verboseKeysSeen!.has(codeKey)) return;
    this.verboseKeysSeen!.add(codeKey);
    if (this.verboseLines >= MAX_VERBOSE_LINES) {
      this.suppressedConsole += 1;
      return;
    }
    this.verboseLines += 1;
    // Content-free: only the structural tuple + code.
    console.warn('[position-validation] unexpected run coordinate coverage', {
      coordinateModel: keyBase.coordinateModel,
      requirement: keyBase.requirement,
      storyKind: keyBase.storyKind,
      storyNamed: keyBase.storyNamed,
      section: keyBase.section,
      runKind: keyBase.runKind,
      paintKind: this.paintKind,
      realm: this.realm,
      code,
    });
  }

  /** Drain and reset. The documented pass boundary. */
  consume(): PositionValidationSummary {
    const summary = this.buildSummary();

    if (this.policy === 'summary' && summary.issues > 0) {
      // At most one content-free line per completed pass.
      console.warn('[position-validation] pass coverage summary', {
        coordinateModel: summary.coordinateModel,
        paintKind: summary.paintKind,
        realm: summary.realm,
        checked: summary.checked,
        issues: summary.issues,
        issuesByCode: summary.issuesByCode,
      });
    }
    if (this.policy === 'verbose' && summary.suppressedConsole > 0) {
      console.warn('[position-validation] additional structural warnings suppressed', {
        coordinateModel: summary.coordinateModel,
        paintKind: summary.paintKind,
        realm: summary.realm,
        suppressedConsole: summary.suppressedConsole,
      });
    }

    this.reset();
    return summary;
  }

  /** Read without draining (for assertions / mid-run inspection). */
  peek(): PositionValidationSummary {
    return this.buildSummary();
  }

  private buildSummary(): PositionValidationSummary {
    const issuesByCode = this.issuesByCode ?? emptyCodeTally();
    const byRequirement = this.byRequirement ?? emptyRequirementTally();
    const groups = Array.from(this.groups?.values() ?? [])
      .map((g) => ({ ...g }))
      .sort((a, b) => b.issues - a.issues || b.checked - a.checked);
    return {
      enabled: this.enabled,
      coordinateModel: this.coordinateModel,
      paintKind: this.paintKind,
      realm: this.realm,
      checked: this.checked,
      valid: this.valid,
      issues: this.issues,
      issuesByCode: { ...issuesByCode },
      byRequirement: {
        'legacy-pm-required': { ...byRequirement['legacy-pm-required'] },
        'story-identity-required': { ...byRequirement['story-identity-required'] },
        'visual-only': { ...byRequirement['visual-only'] },
        'not-addressable': { ...byRequirement['not-addressable'] },
      },
      suppressedConsole: this.suppressedConsole,
      groupCount: this.groups?.size ?? 0,
      groupsOverflowed: this.groupsOverflowed,
      groups,
      unexpectedKeys: (this.unexpectedKeys ?? []).map((k) => ({ ...k })),
    };
  }

  private reset(): void {
    if (!this.enabled) return;
    this.groups = new Map();
    this.groupsOverflowed = 0;
    this.checked = 0;
    this.valid = 0;
    this.issues = 0;
    this.issuesByCode = emptyCodeTally();
    this.byRequirement = emptyRequirementTally();
    this.unexpectedKeys = [];
    this.unexpectedKeysSeen = new Set();
    this.verboseKeysSeen = new Set();
    this.verboseLines = 0;
    this.suppressedConsole = 0;
  }
}

export const createPositionValidationCollector = (options?: PositionValidationOptions): PositionValidationCollector =>
  new PositionValidationCollector(options);
