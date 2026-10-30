export interface AccessRequest {
  token: string;
  roomName: string;
  documentId: string | null;
}

export interface Access {
  userId: string;
  readOnly?: boolean;
}

export type Authorize = (request: AccessRequest) => Access | null | Promise<Access | null>;
