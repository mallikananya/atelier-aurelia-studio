import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { createS3BlobStore, objectStorageConfigFromEnvironment, uploadVerifiedArtifact } from '../../packages/storage/src/index';
import { artifactStorageKey } from '../../packages/storage/src/artifact-keys';
import { fixtureBytes } from '../fixtures/storage';

const config = objectStorageConfigFromEnvironment(process.env);
if (!config.endpoint || !['localhost', '127.0.0.1'].includes(new URL(config.endpoint).hostname)) {
  throw new Error('MinIO integration requires an explicitly configured local endpoint');
}
const store = createS3BlobStore(config);
const identity = () => ({ accountId: randomUUID(), productId: randomUUID(), revisionId: randomUUID(), artifactId: randomUUID() });
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('Real local MinIO private immutable bytes', () => {
  it('verifies SHA-256 and size, preserves version identity, signs exact object and rejects anonymous read', async () => {
    let persisted = false;
    const key = artifactStorageKey(identity());
    const result = await store.putImmutable({ key, bytes: fixtureBytes, sha256: sha256(fixtureBytes), mediaType: 'text/plain' });
    expect(result).toMatchObject({ key, sha256: sha256(fixtureBytes), sizeBytes: fixtureBytes.byteLength });
    expect(result.versionId.length).toBeGreaterThan(0);
    expect(result.versionId).not.toBe('null');
    const signed = await store.createSignedDownload(key, result.versionId, 60);
    expect(signed.searchParams.get('versionId')).toBe(result.versionId);
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('60');
    const response = await fetch(signed);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(fixtureBytes);
    const unsigned = new URL(signed); unsigned.search = '';
    expect((await fetch(unsigned)).status).toBe(403);
    await uploadVerifiedArtifact(store, identity(), fixtureBytes, 'text/plain', async (verified) => {
      expect(verified.sha256).toBe(sha256(fixtureBytes));
      persisted = true;
    });
    expect(persisted).toBe(true);
  });

  it('rejects same-key overwrite including identical bytes and retains original version', async () => {
    const key = artifactStorageKey(identity());
    const original = await store.putImmutable({ key, bytes: fixtureBytes, sha256: sha256(fixtureBytes), mediaType: 'text/plain' });
    for (const bytes of [fixtureBytes, new TextEncoder().encode('replacement')]) {
      await expect(store.putImmutable({ key, bytes, sha256: sha256(bytes), mediaType: 'text/plain' })).rejects.toThrow();
    }
    const read = await fetch(await store.createSignedDownload(key, original.versionId, 60));
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(fixtureBytes);
  });

  it('allows exactly one concurrent first writer for a canonical identity', async () => {
    const key = artifactStorageKey(identity());
    const results = await Promise.allSettled([1, 2].map(() => store.putImmutable({ key, bytes: fixtureBytes, sha256: sha256(fixtureBytes), mediaType: 'text/plain' })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('rejects incorrect intended digest before accepting metadata', async () => {
    await expect(store.putImmutable({ key: artifactStorageKey(identity()), bytes: fixtureBytes, sha256: '0'.repeat(64), mediaType: 'text/plain' })).rejects.toThrow();
  });

  it('runtime credentials cannot delete immutable stored objects', async () => {
    const key = artifactStorageKey(identity());
    const result = await store.putImmutable({ key, bytes: fixtureBytes, sha256: sha256(fixtureBytes), mediaType: 'text/plain' });
    const client = new S3Client({ ...config, maxAttempts: 1 });
    await expect(client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key, VersionId: result.versionId }))).rejects.toMatchObject({ name: 'AccessDenied' });
    await expect(client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))).rejects.toMatchObject({ name: 'AccessDenied' });
    const read = await fetch(await store.createSignedDownload(key, result.versionId, 60));
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(fixtureBytes);
  });

  it('expires a short-lived version-scoped capability', async () => {
    const key = artifactStorageKey(identity());
    const result = await store.putImmutable({ key, bytes: fixtureBytes, sha256: sha256(fixtureBytes), mediaType: 'text/plain' });
    const signed = await store.createSignedDownload(key, result.versionId, 1);
    expect((await fetch(signed)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect((await fetch(signed)).status).toBe(403);
  });
});
