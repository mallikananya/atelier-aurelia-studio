import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (name) => JSON.parse(readFileSync(new URL(`../../infra/aws/${name}.json`, import.meta.url), 'utf8'));

test('AWS bucket rejects insecure, unconditional and destructive access', () => {
  const statements = read('bucket-policy').Statement;
  const get = (sid) => statements.find((statement) => statement.Sid === sid);
  assert.deepEqual(get('DenyInsecureTransport').Condition, { Bool: { 'aws:SecureTransport': 'false' } });
  assert.deepEqual(get('RequireCreateOnlyWrites').Condition, { Null: { 's3:if-none-match': 'true' } });
  assert.deepEqual(get('DenyDeletion').Action, ['s3:DeleteObject', 's3:DeleteObjectVersion']);
  for (const statement of statements) {
    assert.equal(statement.Effect, 'Deny');
    assert.equal(statement.Principal, '*');
  }
});

test('runtime access is prefix scoped and split by deployment responsibility', () => {
  for (const [name, actions] of [
    ['worker-policy', ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion']],
    ['download-policy', ['s3:GetObjectVersion']],
  ]) {
    const policy = read(name);
    assert.equal(policy.Statement.length, 1);
    assert.equal(policy.Statement[0].Effect, 'Allow');
    assert.deepEqual(policy.Statement[0].Action, actions);
    assert.deepEqual(policy.Statement[0].Resource, ['arn:aws:s3:::ARTIFACT_BUCKET/accounts/*']);
  }
});

test('bucket settings enforce private versioned ACL-free encrypted storage', () => {
  assert.deepEqual(read('public-access-block'), { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true });
  assert.deepEqual(read('versioning'), { Status: 'Enabled' });
  assert.deepEqual(read('ownership-controls'), { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] });
  assert.deepEqual(read('encryption'), { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] });
});

test('audit identity has only read-only bucket inspection permissions', () => {
  const statement = read('audit-policy').Statement;
  assert.equal(statement.length, 1);
  assert.equal(statement[0].Effect, 'Allow');
  assert.deepEqual(statement[0].Resource, ['arn:aws:s3:::ARTIFACT_BUCKET']);
  assert.deepEqual(statement[0].Action, ['s3:GetBucketVersioning', 's3:GetBucketPublicAccessBlock', 's3:GetBucketOwnershipControls', 's3:GetEncryptionConfiguration', 's3:GetLifecycleConfiguration', 's3:GetBucketPolicy']);
});
