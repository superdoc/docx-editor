import type { SuperDoc } from 'superdoc';
import type * as Public from 'superdoc';
// @ts-expect-error workflow recording is internal and has no root export
type Recording = Public.WorkflowRecording;
// @ts-expect-error workflow recording is internal and has no root export
type RecordingOptions = Public.WorkflowRecordingOptions;
// @ts-expect-error workflow recording is internal and has no root export
type RecordingSnapshot = Public.WorkflowRecordingSnapshot;
// @ts-expect-error workflow recording is internal and has no root export
type RecordingEvent = Public.WorkflowRecordingEvent;
declare const superdoc: SuperDoc;
// @ts-expect-error normal instances do not expose a public recording API
superdoc.diagnostics.recording;
const config: ConstructorParameters<typeof SuperDoc>[0] = {
  diagnostics: {
    // @ts-expect-error internal recording configuration is not a public contract
    recording: { enabled: true },
  },
};
export { config };
export type { Recording, RecordingOptions, RecordingSnapshot, RecordingEvent };
