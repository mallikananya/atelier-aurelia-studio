/** Fail before client creation; never load a local .env or silently skip acceptance. */
export function requireAwsAcceptance(env) {
  const required = ['OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_ACCEPTANCE_SIGNER_ACCESS_KEY_ID', 'AWS_ACCEPTANCE_SIGNER_SECRET_ACCESS_KEY', 'AWS_ACCEPTANCE_AUDIT_ACCESS_KEY_ID', 'AWS_ACCEPTANCE_AUDIT_SECRET_ACCESS_KEY'];
  const identities = [env.AWS_ACCESS_KEY_ID, env.AWS_ACCEPTANCE_SIGNER_ACCESS_KEY_ID, env.AWS_ACCEPTANCE_AUDIT_ACCESS_KEY_ID];
  if (new Set(identities).size !== 3 || env.AWS_ACCEPTANCE_ENABLED !== 'true' || required.some((key) => !env[key]?.trim()) ||
      env.AWS_ACCEPTANCE_BUCKET !== env.OBJECT_STORAGE_BUCKET || env.OBJECT_STORAGE_ENDPOINT ||
      env.AWS_ENDPOINT_URL || env.AWS_ENDPOINT_URL_S3 || env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true') {
    throw new Error('AWS acceptance requires explicit target confirmation, distinct AWS worker, download signer and read-only audit credentials, and no endpoint override.');
  }
}
