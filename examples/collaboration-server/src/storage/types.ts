export interface RoomStore {
  load(roomName: string): Promise<Uint8Array | null>;
  store(roomName: string, state: Uint8Array): Promise<void>;
  delete(roomName: string): Promise<void>;
  coordination?: {
    read(roomName: string): Promise<StoredRoom>;
    open(roomName: string): Promise<StoredRoom>;
    commit(roomName: string, generation: string, state: Uint8Array): Promise<StoredRoom>;
  };
}

export interface StoredRoom {
  readonly generation: string;
  readonly initialGeneration: boolean;
  readonly state: Uint8Array | null;
}

export interface DocxStore {
  put(documentId: string, docx: Uint8Array): Promise<void>;
}
