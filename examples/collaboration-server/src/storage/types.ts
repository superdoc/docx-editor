export interface RoomStore {
  load(roomName: string): Promise<Uint8Array | null>;
  store(roomName: string, state: Uint8Array): Promise<void>;
}

export interface DocxStore {
  put(documentId: string, docx: Uint8Array): Promise<void>;
}
