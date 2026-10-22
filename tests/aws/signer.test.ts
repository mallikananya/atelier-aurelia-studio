import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { createS3BlobStore, objectStorageConfigFromEnvironment, uploadVerifiedArtifact } from '../../packages/storage/src/index';
import { artifactStorageKey } from '../../packages/storage/src/artifact-keys';
import { requireAwsAcceptance } from './environment.mjs';

requireAwsAcceptance(process.env);
const workerConfig = { ...objectStorageConfigFromEnvironment(process.env), ignoreConfiguredEndpointUrls: true };
const signerConfig = { ...workerConfig, credentials: {
  accessKeyId: process.env.AWS_ACCEPTANCE_SIGNER_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_ACCEPTANCE_SIGNER_SECRET_ACCESS_KEY!,
  ...(process.env.AWS_ACCEPTANCE_SIGNER_SESSION_TOKEN ? { sessionToken: process.env.AWS_ACCEPTANCE_SIGNER_SESSION_TOKEN } : {}),
} };
const worker = createS3BlobStore(workerConfig);
const signer = createS3BlobStore(signerConfig);
const client = new S3Client({ ...signerConfig, maxAttempts: 1 });
const identity = () => ({ accountId: randomUUID(), productId: randomUUID(), revisionId: randomUUID(), artifactId: randomUUID() });
const bytes = new TextEncoder().encode('AWS dedicated download signer acceptance fixture.\n');
const fixture = () => uploadVerifiedArtifact(worker, identity(), bytes, 'text/plain', async (result) => result);
const Bucket = signerConfig.bucket;

describe('Dedicated Vercel download signer IAM identity', () => {
  it('downloads the verified exact version through a short-lived signed capability', async () => {
    const stored = await fixture();
    const signed = await signer.createSignedDownload(stored.key, stored.versionId, 60);
    expect(signed.searchParams.get('versionId')).toBe(stored.versionId);
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('60');
    const response = await fetch(signed);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toBe('attachment');
  });

  it('cannot create objects, delete versions, add deletion markers, read current versions or list', async () => {
    const stored = await fixture();
    const Key = stored.key;
    // A fresh key and valid conditional header ensure write denial is IAM, not overwrite protection.
    const freshKey = artifactStorageKey(identity());
    await expect(client.send(new PutObjectCommand({ Bucket, Key: freshKey, Body: bytes, IfNoneMatch: '*' }))).rejects.toMatchObject({ name: 'AccessDenied' });
    await expect(client.send(new DeleteObjectCommand({ Bucket, Key, VersionId: stored.versionId }))).rejects.toMatchObject({ name: 'AccessDenied' });
    await expect(client.send(new DeleteObjectCommand({ Bucket, Key }))).rejects.toMatchObject({ name: 'AccessDenied' });
    await expect(client.send(new GetObjectCommand({ Bucket, Key }))).rejects.toMatchObject({ name: 'AccessDenied' });
    await expect(client.send(new ListObjectsV2Command({ Bucket, MaxKeys: 1 }))).rejects.toMatchObject({ name: 'AccessDenied' });
    const preserved = await fetch(await signer.createSignedDownload(Key, stored.versionId, 60));
    expect(preserved.status).toBe(200);
    expect(new Uint8Array(await preserved.arrayBuffer())).toEqual(bytes);
  });
});
