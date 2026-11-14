export interface DocxAutosave {
  readonly marker: { name: string; value: string };
  roomChanged(roomName: string): void;
  roomEmptied(roomName: string): void;
  roomDeleted(roomName: string): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
}
