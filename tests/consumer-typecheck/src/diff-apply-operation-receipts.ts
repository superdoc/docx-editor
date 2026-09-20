import type { DiffApplyOperationReceipt, DiffApplyResult, DiffApplyReviewItem, DocumentApi } from 'superdoc';

declare const api: DocumentApi;
declare const result: DiffApplyResult;

const returned: DiffApplyResult = api.diff.apply({ diff: {} as never }, { changeMode: 'tracked' });
const guarded: DiffApplyResult = api.diff.apply(
  { diff: {} as never },
  { changeMode: 'tracked', expectedRevision: '42' },
);
void guarded.operationReceipts;
const receipt: DiffApplyOperationReceipt | undefined = returned.operationReceipts[0];
const item: DiffApplyReviewItem | undefined = receipt?.reviewItems[0];

if (receipt?.disposition === 'review-created') {
  const firstItem: DiffApplyReviewItem = receipt.reviewItems[0];
  void firstItem.id;
} else if (receipt?.disposition === 'applied-directly') {
  const noItems: [] = receipt.reviewItems;
  void noItems;
}

void result.operationReceipts;
void receipt?.operationId;
void item?.address;
void item?.story;
void item?.navigationTarget;
