export interface BlobStore {
  putImmutable(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string; sha256: string; sizeBytes: number }>;
  getAuthorized(key: string, actorId: string): Promise<Uint8Array>;
}

export interface ProjectStore {
  createRevision(productId: string, parentRevision: number | null): Promise<number>;
  recordAuditEvent(input: { actorId: string; productId: string; action: string; payloadHash: string }): Promise<void>;
}
