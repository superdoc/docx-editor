import type { ListCommandSpec } from './commands.js';
import type { combineCommandResults, hostMethod, resolveDocOperation } from './command-results.js';
import type { storyLocatorSignature } from './entity-rows.js';
import type { readRecord, readRecordList, LooseRecord, AnyFn } from './loose-record.js';
import { readParagraphLeftIndent, readResolvedParagraphFind } from './paragraph-indentation.js';
import type { listItemTarget, paragraphTarget, selectionCellParagraphScope } from './selection-targets.js';
import type { CommandExecutionResult } from './types.js';

const MAX_ATOMIC_PLAN_ENTRIES = 1000;

export type ResolvedBlockListState = {
  isListItem: boolean | null;
  seed: 'bullet' | 'ordered' | null;
};

type ParagraphIndentPlan =
  | { kind: 'noop' }
  | {
      kind: 'paragraph';
      routeToCall: string;
      opToCall: AnyFn;
      input: { target: LooseRecord; left: number };
    };

type IndentReadAttempt = {
  sourceToken: string;
  selectionToken: string;
  listStates: Promise<ResolvedBlockListState[]>;
};

type HybridIndentContext = {
  doc: LooseRecord | null;
  mode: ListCommandSpec['mode'] | undefined;
  listRoute: string;
  listOp: AnyFn;
  targetStory: unknown;
  story: LooseRecord;
  blockIds: readonly string[];
  cell: boolean;
  settleMutation: (route: string, operation: AnyFn, input: LooseRecord) => Promise<CommandExecutionResult>;
  firstAttempt: IndentReadAttempt;
  readAttempt: () => IndentReadAttempt;
  contentToken: () => string;
  currentSelectionToken: () => string;
  selectionAddress: string;
  selectionAddressKey: () => string;
  selectionGeneration: unknown;
  ownerAndSelectionAreCurrent: () => boolean;
  onlyUnrelatedTextChanged: () => boolean;
  stopObserving: () => void;
  hasInactiveTextSelection: () => boolean;
  readDocumentMode: () => 'editing' | 'viewing' | 'suggesting' | null;
};

type ParagraphCommandReadHelpers = {
  batchLimits: { targets: number; writes: number; payloadBytes: number };
  resolveDocOperation: typeof resolveDocOperation;
  hostMethod: typeof hostMethod;
  storyLocatorSignature: typeof storyLocatorSignature;
  readRecord: typeof readRecord;
  readRecordList: typeof readRecordList;
  paragraphTarget: typeof paragraphTarget;
  combineCommandResults: typeof combineCommandResults;
  listItemTarget: typeof listItemTarget;
  resolveListStateForBlock: (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
  ) => ResolvedBlockListState | Promise<ResolvedBlockListState>;
};

export function createParagraphCommandReads({
  batchLimits,
  resolveDocOperation,
  hostMethod,
  storyLocatorSignature,
  readRecord,
  readRecordList,
  paragraphTarget,
  resolveListStateForBlock,
  combineCommandResults,
  listItemTarget,
}: ParagraphCommandReadHelpers) {
  const PARAGRAPH_INDENT_STEP_TWIPS = 720;

  const supportsResolvedIndentationStory = (story: LooseRecord) =>
    story.storyType === 'body' ||
    story.storyType === 'headerFooterPart' ||
    story.storyType === 'headerFooterSlot' ||
    story.storyType === 'footnote' ||
    story.storyType === 'endnote';

  const resolveCellParagraphIds = async (
    doc: LooseRecord | null,
    scope: NonNullable<ReturnType<typeof selectionCellParagraphScope>>,
  ): Promise<string[] | null> => {
    const find = hostMethod(doc, 'find');
    if (!find) return null;
    const batchSize = 8;
    const tableTarget = { kind: 'block', nodeType: 'table', nodeId: scope.tableId, story: scope.story };
    const getCells = hostMethod(doc?.tables, 'getCells');
    const selectedCells = new Set(scope.cellIds);
    const matchesStory = (story: unknown) =>
      storyLocatorSignature(story ?? { kind: 'story', storyType: 'body' }) === storyLocatorSignature(scope.story);
    const wholeTableFirstParagraphs = async (): Promise<string[] | null> => {
      if (!getCells || scope.cellIds.length < batchSize) return null;
      try {
        const table = readRecord(await getCells({ target: tableTarget }));
        const address = readRecord(table?.address);
        if (
          address?.kind !== 'block' ||
          address.nodeType !== 'table' ||
          address.nodeId !== scope.tableId ||
          !matchesStory(address.story) ||
          !Array.isArray(table?.cells) ||
          table.cells.length !== scope.cellIds.length
        )
          return null;
        const cells = new Set<string>();
        const firstParagraphs: string[] = [];
        for (const cell of readRecordList(table.cells)) {
          const target = readRecord(cell?.address);
          if (
            target?.kind !== 'block' ||
            target.nodeType !== 'tableCell' ||
            typeof target.nodeId !== 'string' ||
            cell?.nodeId !== target.nodeId ||
            !selectedCells.has(target.nodeId) ||
            !matchesStory(target.story ?? address.story) ||
            typeof cell.firstParagraphNodeId !== 'string' ||
            !cell.firstParagraphNodeId
          )
            return null;
          cells.add(target.nodeId);
          firstParagraphs.push(cell.firstParagraphNodeId);
        }
        return cells.size === selectedCells.size ? firstParagraphs : null;
      } catch {
        return null;
      }
    };
    const resolveWithin = async (within: LooseRecord): Promise<string[] | null> => {
      const blockIds = new Set<string>();
      for (const nodeType of ['paragraph', 'heading', 'listItem']) {
        let offset = 0;
        let total: number | undefined;
        do {
          const page = readRecord(
            await find({
              select: { type: 'node', nodeType },
              within,
              in: scope.story,
              offset,
              limit: 100,
            }),
          );
          if (
            !page ||
            typeof page.total !== 'number' ||
            !Number.isSafeInteger(page.total) ||
            page.total < 0 ||
            page.offset !== offset ||
            typeof page.limit !== 'number' ||
            !Number.isSafeInteger(page.limit) ||
            page.limit <= 0 ||
            !Array.isArray(page.items) ||
            page.items.length > page.limit ||
            offset + page.items.length > page.total ||
            (total !== undefined && total !== page.total) ||
            (page.items.length === 0 && offset < page.total)
          )
            return null;
          total = page.total;
          for (const item of readRecordList(page.items)) {
            const target = readRecord(item?.address);
            if (
              target?.kind !== 'block' ||
              target.nodeType !== nodeType ||
              typeof target.nodeId !== 'string' ||
              !target.nodeId ||
              storyLocatorSignature(target.story ?? scope.story) !== storyLocatorSignature(scope.story)
            )
              return null;
            blockIds.add(target.nodeId);
          }
          offset += page.items.length;
        } while (offset < total);
      }
      return blockIds.size ? [...blockIds] : null;
    };
    const firstParagraphs = await wholeTableFirstParagraphs();
    if (firstParagraphs) {
      const ids = await resolveWithin(tableTarget);
      const found = new Set(ids);
      return ids && firstParagraphs.every((id) => found.has(id)) ? ids : null;
    }
    const blockIds = new Set<string>();
    for (let index = 0; index < scope.cellIds.length; index += batchSize) {
      const cells = await Promise.all(
        scope.cellIds
          .slice(index, index + batchSize)
          .map((nodeId) => resolveWithin({ kind: 'block', nodeType: 'tableCell', nodeId, story: scope.story })),
      );
      for (const ids of cells) {
        if (!ids) return null;
        for (const id of ids) blockIds.add(id);
      }
    }
    return [...blockIds];
  };

  const planParagraphIndentation = async (
    increase: boolean,
    blockId: string,
    {
      doc,
      story,
      targetStory,
      requireResolved,
    }: {
      doc: LooseRecord | null;
      story: LooseRecord;
      targetStory: unknown;
      requireResolved: boolean;
    },
  ): Promise<ParagraphIndentPlan | null> => {
    const paragraphSetIndent = resolveDocOperation(doc, 'format.paragraph.setIndentation');
    if (!paragraphSetIndent) return null;
    const find = hostMethod(doc, 'find');
    let current: number | null;
    if (
      (find || (typeof doc?.get === 'function' && story.storyType !== 'footnote' && story.storyType !== 'endnote')) &&
      supportsResolvedIndentationStory(story)
    ) {
      if (!find) return null;
      const readSource = async (kind: 'paragraph' | 'heading') =>
        readResolvedParagraphFind(
          await find({
            select: { type: 'node', nodeType: kind },
            within: { ...paragraphTarget(blockId, targetStory), nodeType: kind },
            in: story,
            options: { includeResolved: true },
            limit: 2,
            offset: 0,
          }),
          blockId,
          kind,
          story,
        );
      let source = await readSource('paragraph');
      if (source === 'empty') source = await readSource('heading');
      if (typeof source !== 'number') return null;
      current = source;
    } else {
      const getNode = hostMethod(doc, 'getNode');
      if (story.storyType !== 'body' && !getNode) return null;
      try {
        const raw =
          targetStory && getNode
            ? await getNode(paragraphTarget(blockId, targetStory))
            : story.storyType === 'body'
              ? await hostMethod(doc, 'getNodeById')?.({ nodeId: blockId, nodeType: 'paragraph', story })
              : null;
        const node = readRecord(readRecord(raw)?.node);
        if (requireResolved && node?.kind !== 'paragraph' && node?.kind !== 'heading') return null;
        current = readParagraphLeftIndent(raw);
      } catch {
        if (requireResolved) return null;
        current = null;
      }
    }
    if (!increase && current === null && (story.storyType === 'footnote' || story.storyType === 'endnote')) return null;
    const step = increase ? PARAGRAPH_INDENT_STEP_TWIPS : -PARAGRAPH_INDENT_STEP_TWIPS;
    if (!increase && current === 0) return { kind: 'noop' };
    return {
      kind: 'paragraph',
      routeToCall: 'format.paragraph.setIndentation',
      opToCall: paragraphSetIndent,
      input: {
        target: paragraphTarget(blockId, targetStory),
        left: Math.max(0, (current ?? 0) + step),
      },
    };
  };

  const canIndentCellParagraphs = async (
    doc: LooseRecord | null,
    scope: NonNullable<ReturnType<typeof selectionCellParagraphScope>>,
    mode: ListCommandSpec['mode'] | undefined,
    suggesting: boolean,
    paragraphOpAvailable: boolean,
  ): Promise<boolean> => {
    const rangeRoute = mode === 'indent' ? 'lists.indentRange' : 'lists.outdentRange';
    const listRouteAvailable =
      (!suggesting && resolveDocOperation(doc, rangeRoute) != null) ||
      (mode === 'outdent' && resolveDocOperation(doc, 'lists.outdentInStory') != null);
    const ids = await resolveCellParagraphIds(doc, scope);
    if (!ids?.length) return false;
    const story = { ...scope.story };
    const listStates = await Promise.all(ids.map((id) => resolveListStateForBlock(doc, id, story)));
    const canReadIndentation = supportsResolvedIndentationStory(story) || typeof doc?.getNode === 'function';
    return listStates.every(({ isListItem }) =>
      isListItem === true ? listRouteAvailable : isListItem === false && paragraphOpAvailable && canReadIndentation,
    );
  };

  const selectionAddressShape = (key: string): string => {
    let value: unknown;
    try {
      value = JSON.parse(key);
    } catch {
      return key;
    }
    const address = readRecord(value);
    if (!address) return key;
    if (address.kind === 'selection') {
      for (const point of [readRecord(address.start), readRecord(address.end)]) {
        if (point && typeof point.offset === 'number') point.offset = 0;
      }
    } else if (address.kind === 'text' && Array.isArray(address.segments)) {
      for (const segment of address.segments) {
        const range = readRecord(readRecord(segment)?.range);
        if (!range) continue;
        if (typeof range.start === 'number') range.start = 0;
        if (typeof range.end === 'number') range.end = 0;
      }
    }
    return JSON.stringify(address);
  };

  const executeHybridIndent = async ({
    doc,
    mode,
    listRoute,
    listOp,
    targetStory,
    story,
    blockIds,
    cell,
    settleMutation,
    firstAttempt,
    readAttempt,
    contentToken,
    currentSelectionToken,
    selectionAddress,
    selectionAddressKey,
    selectionGeneration,
    ownerAndSelectionAreCurrent,
    onlyUnrelatedTextChanged,
    stopObserving,
    hasInactiveTextSelection,
    readDocumentMode,
  }: HybridIndentContext): Promise<CommandExecutionResult> => {
    type IndentPlan = ParagraphIndentPlan | { kind: 'list'; blockId: string };
    const increasing = mode === 'indent';
    let plans: (IndentPlan | null)[];
    const originalAddressShape = selectionAddressShape(selectionAddress);
    for (let attempt = 0; ; attempt++) {
      const { sourceToken, selectionToken, listStates } = attempt === 0 ? firstAttempt : readAttempt();
      const states = await listStates;
      plans = await Promise.all(
        blockIds.map((blockId, index): IndentPlan | null | Promise<ParagraphIndentPlan | null> => {
          const isListItem = states[index]?.isListItem;
          if (isListItem === true && listRoute) return { kind: 'list', blockId };
          if (isListItem !== false) return null;
          return planParagraphIndentation(increasing, blockId, {
            doc,
            story,
            targetStory,
            requireResolved: cell,
          }).catch(() => null);
        }),
      );
      if (!ownerAndSelectionAreCurrent()) return false;
      const contentChanged = contentToken() !== sourceToken;
      const currentAddress = selectionAddressKey();
      if (!contentChanged) {
        if (currentAddress !== selectionAddress || currentSelectionToken() !== selectionToken) return false;
        break;
      }
      // SD-7235: Scope this exception to proved unrelated body paragraph text.
      if (
        (plans[0]?.kind === 'paragraph' || plans[0]?.kind === 'noop') &&
        onlyUnrelatedTextChanged() &&
        currentAddress === selectionAddress
      )
        break;
      if (selectionGeneration === undefined || attempt >= 2) return false;
      if (currentAddress !== selectionAddress) {
        if (selectionAddressShape(currentAddress) !== originalAddressShape) return false;
        selectionAddress = currentAddress;
      }
    }
    stopObserving();
    if (cell && (plans.some((plan) => !plan) || hasInactiveTextSelection())) return false;
    const allListItems = plans.every((plan) => plan?.kind === 'list');
    const preserveFirstItemLevel = blockIds.length === 1 && story.storyType === 'body';
    const rangeRoute = increasing ? 'lists.indentRange' : 'lists.outdentRange';
    if (allListItems && (readDocumentMode() !== 'suggesting' || preserveFirstItemLevel)) {
      const rangeOp = resolveDocOperation(doc, rangeRoute);
      if (rangeOp) {
        try {
          const ranges = cell ? blockIds.map((blockId) => [blockId]) : [blockIds];
          return combineCommandResults(
            await Promise.all(
              ranges.map((paraIds) =>
                settleMutation(rangeRoute, rangeOp, {
                  paraIds,
                  story,
                  ...(preserveFirstItemLevel ? { preserveFirstItemLevel: true } : {}),
                }),
              ),
            ),
          );
        } catch {
          return false;
        }
      }
    }
    if (
      plans.length > 1 &&
      plans.length <= batchLimits.writes &&
      !cell &&
      story.storyType === 'body' &&
      readDocumentMode() === 'editing' &&
      plans.every((plan) => plan?.kind === 'paragraph' || plan?.kind === 'noop')
    ) {
      const execute = resolveDocOperation(doc, 'plan.execute');
      const capabilities = resolveDocOperation(doc, 'capabilities.get');
      const getProtection = resolveDocOperation(doc, 'protection.get');
      if (execute && capabilities && getProtection) {
        const sourceToken = contentToken();
        const selectionToken = currentSelectionToken();
        const read = (operation: () => unknown) =>
          Promise.resolve()
            .then(operation)
            .catch(() => null);
        const [available, protection] = await Promise.all([read(capabilities), read(() => getProtection({}))]);
        if (
          !ownerAndSelectionAreCurrent() ||
          contentToken() !== sourceToken ||
          selectionAddressKey() !== selectionAddress ||
          currentSelectionToken() !== selectionToken ||
          readDocumentMode() !== 'editing' ||
          hasInactiveTextSelection()
        )
          return false;
        const advertised = readRecord(readRecord(available)?.operations);
        const restriction = readRecord(readRecord(protection)?.editingRestriction);
        if (
          readRecord(advertised?.['format.paragraph.applyBatch'])?.available === true &&
          restriction?.runtimeEnforced === false
        ) {
          const byLeft = new Map<number, LooseRecord[]>();
          for (const plan of plans) {
            if (plan?.kind !== 'paragraph') continue;
            const { target, left } = plan.input;
            const targets = byLeft.get(left);
            if (targets) targets.push(target);
            else byLeft.set(left, [target]);
          }
          const entries = [];
          for (const [left, targets] of byLeft) {
            const operations = [{ operationId: 'format.paragraph.setIndentation', input: { left } }];
            for (let start = 0; start < targets.length; start += batchLimits.targets) {
              entries.push({
                operationId: 'format.paragraph.applyBatch',
                input: { targets: targets.slice(start, start + batchLimits.targets), operations },
              });
            }
          }
          if (!entries.length) return true;
          if (
            entries.length <= MAX_ATOMIC_PLAN_ENTRIES &&
            new TextEncoder().encode(JSON.stringify(entries)).byteLength <= batchLimits.payloadBytes
          ) {
            return settleMutation(
              'plan.execute',
              async (input) => {
                const result = readRecord(await execute(input));
                return !!result && !result.failure;
              },
              { atomic: true, entries },
            );
          }
        }
      }
    }
    const nonBodyListPlans = story.storyType !== 'body' && plans.some((plan) => plan?.kind === 'list');
    const outdentInStory =
      nonBodyListPlans && mode === 'outdent' ? resolveDocOperation(doc, 'lists.outdentInStory') : null;
    const cellListRange =
      cell && nonBodyListPlans && readDocumentMode() !== 'suggesting' ? resolveDocOperation(doc, rangeRoute) : null;
    if (nonBodyListPlans && !outdentInStory && !cellListRange) return false;
    const settledResults = plans.map((plan) => {
      if (!plan) return false;
      try {
        if (plan.kind === 'paragraph') return settleMutation(plan.routeToCall, plan.opToCall, plan.input);
        if (plan.kind === 'noop') return true;
        if (cellListRange) return settleMutation(rangeRoute, cellListRange, { paraIds: [plan.blockId], story });
        const target = listItemTarget(plan.blockId);
        return outdentInStory
          ? settleMutation('lists.outdentInStory', outdentInStory, { target, story })
          : settleMutation(listRoute, listOp, { target });
      } catch {
        return false;
      }
    });
    return combineCommandResults(await Promise.all(settledResults));
  };

  return {
    resolveCellParagraphIds,
    canIndentCellParagraphs,
    executeHybridIndent,
  };
}
