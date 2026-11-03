import { isObjectRecord } from '../../helpers/object-guards.js';

export type AnyFn = (...args: unknown[]) => unknown;
export type LooseRecord = Record<string, unknown>;

export function readRecord(value: unknown): LooseRecord | undefined {
  return isObjectRecord(value) ? value : undefined;
}

export function readRecordList(value: unknown): Array<LooseRecord | undefined> {
  return Array.isArray(value) ? value.map(readRecord) : [];
}
