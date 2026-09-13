import type { FlowBlock, Run } from '@superdoc/contracts';

export type DerivedRunTextPlane = {
  generation: number;
  revision: string;
  valuesByDataAttribute: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

export function validateDerivedRunTextPlane(plane: DerivedRunTextPlane | null | undefined, generation: number): void {
  if (!plane) return;
  if (!Number.isInteger(plane.generation) || plane.generation !== generation) {
    throw new Error(
      `derived run-text display plane generation ${String(plane.generation)} does not match scaffold generation ${String(generation)}`,
    );
  }
  if (plane.revision.length === 0) {
    throw new Error('derived run-text display plane requires a non-empty revision');
  }
  for (const [dataAttribute, values] of plane.valuesByDataAttribute) {
    if (dataAttribute.length === 0 || !(values instanceof Map)) {
      throw new Error('derived run-text display plane contains an invalid data-attribute map');
    }
    for (const [identity, value] of values) {
      if (identity.length === 0 || typeof value !== 'string') {
        throw new Error('derived run-text display plane contains an invalid identity value');
      }
    }
  }
}

export function resolveDerivedRunText(run: Run, plane: DerivedRunTextPlane | null | undefined): string | undefined {
  if (!plane || !('dataAttrs' in run) || !run.dataAttrs) return undefined;
  for (const [dataAttribute, values] of plane.valuesByDataAttribute) {
    const identity = run.dataAttrs[dataAttribute];
    if (typeof identity !== 'string') continue;
    const value = values.get(identity);
    if (value !== undefined) return value;
  }
  return undefined;
}

function runsUsePlane(runs: readonly Run[] | undefined, plane: DerivedRunTextPlane): boolean {
  return runs?.some((run) => resolveDerivedRunText(run, plane) !== undefined) ?? false;
}

export function blockUsesDerivedRunTextPlane(
  block: FlowBlock | undefined,
  plane: DerivedRunTextPlane | null | undefined,
): boolean {
  if (!block || !plane) return false;
  const candidate = block as FlowBlock & {
    runs?: readonly Run[];
    items?: readonly { paragraph?: FlowBlock }[];
    rows?: readonly {
      cells?: readonly {
        blocks?: readonly FlowBlock[];
        paragraph?: FlowBlock;
      }[];
    }[];
    contentBlocks?: readonly FlowBlock[];
  };
  if (runsUsePlane(candidate.runs, plane)) return true;
  if (candidate.items?.some((item) => blockUsesDerivedRunTextPlane(item.paragraph, plane))) {
    return true;
  }
  if (
    candidate.rows?.some((row) =>
      row.cells?.some(
        (cell) =>
          cell.blocks?.some((child) => blockUsesDerivedRunTextPlane(child, plane)) ||
          blockUsesDerivedRunTextPlane(cell.paragraph, plane),
      ),
    )
  ) {
    return true;
  }
  return candidate.contentBlocks?.some((child) => blockUsesDerivedRunTextPlane(child, plane)) ?? false;
}
