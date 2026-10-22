import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  S3Client, PutObjectCommand, GetBucketVersioningCommand, GetPublicAccessBlockCommand,
  GetBucketOwnershipControlsCommand, GetBucketEncryptionCommand, GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { objectStorageConfigFromEnvironment } from '../../packages/storage/src/index';
import { artifactStorageKey } from '../../packages/storage/src/artifact-keys';
import { requireAwsAcceptance } from './environment.mjs';

requireAwsAcceptance(process.env);
// Ignore endpoint URLs from shared AWS profiles as well as rejecting environment overrides.
const config = { ...objectStorageConfigFromEnvironment(process.env), ignoreConfiguredEndpointUrls: true };
const runtime = new S3Client({ ...config, maxAttempts: 1 });
const audit = new S3Client({ region: config.region, ignoreConfiguredEndpointUrls: true, maxAttempts: 1, credentials: {
  accessKeyId: process.env.AWS_ACCEPTANCE_AUDIT_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_ACCEPTANCE_AUDIT_SECRET_ACCESS_KEY!,
  ...(process.env.AWS_ACCEPTANCE_AUDIT_SESSION_TOKEN ? { sessionToken: process.env.AWS_ACCEPTANCE_AUDIT_SESSION_TOKEN } : {}),
} });
const Bucket = config.bucket;
const key = () => artifactStorageKey({ accountId: randomUUID(), productId: randomUUID(), revisionId: randomUUID(), artifactId: randomUUID() });

describe('AWS control plane and direct SDK policy enforcement', () => {
  it('requires enabled versioning, all public-access blocks, ownership and SSE-S3', async () => {
    expect((await audit.send(new GetBucketVersioningCommand({ Bucket }))).Status).toBe('Enabled');
    expect((await audit.send(new GetPublicAccessBlockCommand({ Bucket }))).PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true,
    });
    expect((await audit.send(new GetBucketOwnershipControlsCommand({ Bucket }))).OwnershipControls?.Rules).toEqual([{ ObjectOwnership: 'BucketOwnerEnforced' }]);
    const encryption = await audit.send(new GetBucketEncryptionCommand({ Bucket }));
    expect(encryption.ServerSideEncryptionConfiguration?.Rules?.[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm).toBe('AES256');
  });

  it('requires the reviewed deny-only bucket policy and no active lifecycle rules', async () => {
    const expected = JSON.parse(readFileSync(new URL('../../infra/aws/bucket-policy.json', import.meta.url), 'utf8').replaceAll('ARTIFACT_BUCKET', Bucket));
    const actual = await audit.send(new GetBucketPolicyCommand({ Bucket }));
    const policy = JSON.parse(actual.Policy ?? '{}');
    expect(policy.Version).toBe(expected.Version);
    expect(policy.Statement).toHaveLength(expected.Statement.length);
    expect(policy.Statement).toEqual(expect.arrayContaining(expected.Statement));
    try {
      const lifecycle = await audit.send(new GetBucketLifecycleConfigurationCommand({ Bucket }));
      expect(lifecycle.Rules?.filter((rule) => rule.Status === 'Enabled') ?? []).toEqual([]);
    } catch (error) {
      expect(error).toMatchObject({ name: 'NoSuchLifecycleConfiguration' });
    }
  });

  it('denies direct unconditional uploads even to a fresh canonical key', async () => {
    await expect(runtime.send(new PutObjectCommand({ Bucket, Key: key(), Body: 'unconditional-write-probe' }))).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('denies prefix escape and bucket enumeration', async () => {
    await expect(runtime.send(new PutObjectCommand({ Bucket, Key: `outside-accounts/${randomUUID()}`, Body: 'prefix-probe', IfNoneMatch: '*' }))).rejects.toMatchObject({ name: 'AccessDenied' });
    await expect(runtime.send(new ListObjectsV2Command({ Bucket, MaxKeys: 1 }))).rejects.toMatchObject({ name: 'AccessDenied' });
  });
});
