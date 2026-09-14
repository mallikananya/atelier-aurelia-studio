export interface ImmutablePutRequest {
  key: string;
  bytes: Uint8Array;
  mediaType: string;
  sha256: string;
}

export interface ImmutablePutResult {
  key: string;
  sha256: string;
  sizeBytes: number;
  versionId: string;
}

export interface BlobStore {
  putImmutable(request: ImmutablePutRequest): Promise<ImmutablePutResult>;
  createSignedDownload(key: string, expiresInSeconds: number): Promise<URL>;
}

export interface ProjectStore {
  createRevision(productId: string, parentRevision: number | null): Promise<number>;
  recordAuditEvent(input: { actorId: string; productId: string; action: string; payloadHash: string }): Promise<void>;
}
