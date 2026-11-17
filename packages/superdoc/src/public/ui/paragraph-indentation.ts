import { isObjectRecord, isPlainObject } from '../../helpers/object-guards.js';
import type { LooseRecord } from './loose-record.js';

function readRecord(value: unknown): LooseRecord | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(Reflect.get(a, key), Reflect.get(b, key)),
    )
  );
}

export function pointsToTwips(value: number): number {
  return Math.round(value * 20);
}

export function readParagraphLeftIndent(result: unknown): number | null {
  const node = readRecord(readRecord(result)?.node);
  if (!node) return null;
  const paragraphPayload =
    node.kind === 'heading'
      ? readRecord(node.heading)
      : node.kind === 'paragraph'
        ? readRecord(node.paragraph)
        : undefined;
  if (!paragraphPayload) return null;
  const resolvedIndent = readRecord(paragraphPayload.resolved)?.indent;
  const indent =
    resolvedIndent != null ? readRecord(resolvedIndent) : readRecord(readRecord(paragraphPayload.props)?.indent);
  if (!indent) return null;

  const directIndent = readRecord(readRecord(paragraphPayload.props)?.indent);
  const directLeading =
    isFiniteNumber(indent.left) && isFiniteNumber(indent.start)
      ? isFiniteNumber(directIndent?.left)
        ? directIndent.left
        : directIndent?.start
      : undefined;
  const leftPoints = isFiniteNumber(directLeading)
    ? directLeading
    : isFiniteNumber(indent.left)
      ? indent.left
      : indent.start;
  return isFiniteNumber(leftPoints) ? pointsToTwips(leftPoints) : null;
}

export function readResolvedParagraphFind(
  result: unknown,
  blockId: string,
  kind: 'paragraph' | 'heading',
  story: LooseRecord,
): number | 'empty' | null {
  const page = isPlainObject(result) ? result : undefined;
  if (!page || page.offset !== 0 || page.limit !== 2 || !Array.isArray(page.items)) return null;
  if (page.total === 0 && page.items.length === 0) return 'empty';
  if (page.total !== 1 || page.items.length !== 1) return null;
  const item = isPlainObject(page.items[0]) ? page.items[0] : undefined;
  const address = isPlainObject(item?.address) ? item.address : undefined;
  const node = isPlainObject(item?.node) ? item.node : undefined;
  if (
    address?.kind !== 'block' ||
    address.nodeType !== kind ||
    address.nodeId !== blockId ||
    node?.kind !== kind ||
    readRecord(node.paragraphIds)?.paraId !== blockId ||
    (node.id !== undefined && node.id !== blockId)
  )
    return null;
  const returnedStory = isPlainObject(address.story) ? address.story : undefined;
  if (story.storyType === 'body') {
    if (
      address.story !== undefined &&
      (!returnedStory || !shallowEqual(returnedStory, { kind: 'story', storyType: 'body' }))
    )
      return null;
  } else {
    if (!returnedStory) return null;
    const { section: expectedSection, ...expected } = story;
    const { section: actualSection, ...actual } = returnedStory;
    if (!shallowEqual(expected, actual) || !shallowEqual(expectedSection, actualSection)) return null;
  }
  const payload = node[kind];
  if (!isPlainObject(payload) || !isPlainObject(payload.resolved)) return null;
  const resolved = payload.resolved;
  const indent = isPlainObject(resolved.indent) ? resolved.indent : undefined;
  if (resolved.indent !== undefined && !indent) return null;
  if (indent?.left !== undefined && !isFiniteNumber(indent.left)) return null;
  if (indent?.start !== undefined && !isFiniteNumber(indent.start)) return null;
  const left = indent ? (readParagraphLeftIndent({ node }) ?? 0) : 0;
  return Number.isFinite(left) ? left : null;
}
