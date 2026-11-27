import { resolveCollaborationRoomName } from 'superdoc/collaboration';

type Assert<T extends true> = T;
type ParametersMatch = Assert<
  Parameters<typeof resolveCollaborationRoomName> extends [documentId: string] ? true : false
>;
type ReturnMatches = Assert<ReturnType<typeof resolveCollaborationRoomName> extends string ? true : false>;

const roomName: string = resolveCollaborationRoomName('doc-42');
void roomName;
export type { ParametersMatch, ReturnMatches };
