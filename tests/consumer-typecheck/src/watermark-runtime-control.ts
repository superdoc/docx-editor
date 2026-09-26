import type { SuperDoc, ToolbarConfig } from 'superdoc';
import type { BorrowedSuperDocUI, WatermarkHandle, WorkflowActionResult } from 'superdoc/ui';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
declare const superdoc: SuperDoc;
declare const ui: BorrowedSuperDocUI;
const handle: WatermarkHandle = superdoc.ui.watermark;
const opened: WorkflowActionResult = handle.open();
const closed: void = handle.close();
const parameters: Equal<Parameters<WatermarkHandle['open']>, []> = true;
const result: Equal<ReturnType<WatermarkHandle['open']>, WorkflowActionResult> = true;
const borrowed: WatermarkHandle = ui.watermark;
// @ts-expect-error Watermark settings belong to the dialog or Document API, not open().
handle.open({ text: 'DRAFT' });
void [opened, closed, parameters, result, borrowed];

const optionalToolbar: ToolbarConfig = { includeItems: ['watermark'] };
const explicitToolbar: ToolbarConfig = {
  items: { center: ['watermark'] },
  icons: { watermark: '<svg aria-hidden="true"></svg>' },
  strings: { watermark: 'Configure watermark' },
};
void [optionalToolbar, explicitToolbar];
