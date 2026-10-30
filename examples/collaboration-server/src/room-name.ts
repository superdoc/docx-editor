const SUPERDOC_V2_ROOM_NAME_ANY_VERSION = /^sd2\/v[^/]+\/(.+)$/;

export function documentIdFromRoomName(roomName: string): string | null {
  return SUPERDOC_V2_ROOM_NAME_ANY_VERSION.exec(roomName)?.[1] ?? null;
}
