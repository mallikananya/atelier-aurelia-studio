import assert from 'node:assert/strict';
import test from 'node:test';
import { requireAwsAcceptance } from './environment.mjs';
const valid = { AWS_ACCEPTANCE_ENABLED: 'true', AWS_ACCEPTANCE_BUCKET: 'atelier-staging-fixtures', OBJECT_STORAGE_BUCKET: 'atelier-staging-fixtures', OBJECT_STORAGE_REGION: 'us-west-2', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_ACCEPTANCE_SIGNER_ACCESS_KEY_ID: 'signer', AWS_ACCEPTANCE_SIGNER_SECRET_ACCESS_KEY: 'signer', AWS_ACCEPTANCE_AUDIT_ACCESS_KEY_ID: 'audit', AWS_ACCEPTANCE_AUDIT_SECRET_ACCESS_KEY: 'audit' };
test('live AWS acceptance requires explicit exact target and separate signer and audit credentials', () => {
  assert.throws(() => requireAwsAcceptance({ ...valid, AWS_ACCEPTANCE_SIGNER_ACCESS_KEY_ID: valid.AWS_ACCESS_KEY_ID }));
  assert.throws(() => requireAwsAcceptance({ ...valid, AWS_ACCEPTANCE_SIGNER_ACCESS_KEY_ID: valid.AWS_ACCEPTANCE_AUDIT_ACCESS_KEY_ID }));
  assert.throws(() => requireAwsAcceptance({ ...valid, AWS_ACCEPTANCE_AUDIT_ACCESS_KEY_ID: valid.AWS_ACCESS_KEY_ID }));
  assert.doesNotThrow(() => requireAwsAcceptance(valid));
  for (const key of Object.keys(valid)) assert.throws(() => requireAwsAcceptance({ ...valid, [key]: '' }));
  assert.throws(() => requireAwsAcceptance({ ...valid, AWS_ACCEPTANCE_BUCKET: 'other-bucket' }));
  assert.throws(() => requireAwsAcceptance({ ...valid, AWS_ACCEPTANCE_ENABLED: 'false' }));
  for (const endpoint of ['http://localhost:9000', 'https://example.com']) assert.throws(() => requireAwsAcceptance({ ...valid, OBJECT_STORAGE_ENDPOINT: endpoint }));
  assert.throws(() => requireAwsAcceptance({ ...valid, OBJECT_STORAGE_FORCE_PATH_STYLE: 'true' }));
  assert.throws(() => requireAwsAcceptance({ ...valid, AWS_ENDPOINT_URL: 'https://example.com' }));
  assert.throws(() => requireAwsAcceptance({ ...valid, AWS_ENDPOINT_URL_S3: 'https://example.com' }));
});
