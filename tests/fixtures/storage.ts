import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { createS3BlobStore, objectStorageConfigFromEnvironment, uploadVerifiedArtifact } from '../../packages/storage/src/index';

export const fixtureBytes = new TextEncoder().encode('Atelier Aurelia immutable storage acceptance fixture.\n');
export const ownerEmail = 'milestone5-owner@example.test';
export const nonmemberEmail = 'milestone5-nonmember@example.test';
export const otherEmail = 'milestone6-other-account@example.test';

function localURL(value: string): string {
  if (!['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) {
    throw new Error('Storage acceptance fixtures require local services');
  }
  return value;
}

export function fixtureAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Local fixture provisioning key required');
  return createClient(localURL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'), key,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function fixtureToken(email: string) {
  const result = await fixtureAdmin().auth.admin.generateLink({ type: 'magiclink', email });
  if (result.error) throw new Error('Local fixture login failed');
  return result.data.properties.hashed_token;
}

export async function fixtureSession(email: string) {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error('Local public key required');
  const client = createClient(localURL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'), key,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await client.auth.verifyOtp({ token_hash: await fixtureToken(email), type: 'email' });
  if (result.error) throw new Error('Local fixture login failed');
  return client;
}

// Local container superuser assumes atelier_worker before every fixture command.
// SQL is sent on stdin; never print connection credentials or signed URLs.
export function workerSQL(sql: string): string {
  localURL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321');
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_atelier-aurelia-studio',
      'psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
      input: `set role atelier_worker;\n${sql}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('Local worker-role fixture command failed');
  }
}

export function literal(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

export async function startArtifactFixture() {
  const owner = await fixtureSession(ownerEmail);
  const created = await owner.rpc('create_product_with_revision', { p_name: 'Storage acceptance fixture' });
  if (created.error) throw new Error('Could not create local fixture product');
  const { product_id: productId, revision_id: revisionId } = created.data[0];
  const product = await owner.from('products').select('account_id').eq('id', productId).single();
  if (product.error) throw new Error('Could not resolve fixture account');
  const queued = await owner.rpc('enqueue_phase1_test_build', {
    p_product_id: productId, p_revision_id: revisionId, p_idempotency_key: `storage-acceptance-${randomUUID()}`,
  });
  if (queued.error) throw new Error('Could not enqueue fixture metadata');
  const jobId: string = queued.data[0].job_id;
  const claimed = JSON.parse(workerSQL(`select row_to_json(c) from private.worker_claim_outbox('${randomUUID()}') c;`));
  if (claimed.job_id !== jobId) throw new Error('Unexpected pending local work; reset fixture database');
  workerSQL(`select private.worker_bind_run('${claimed.outbox_id}', '${claimed.lease_token}', 'storage-fixture-${jobId}');`);
  const attemptId = workerSQL(`select private.worker_start_attempt('${jobId}', 'storage-fixture-attempt-${jobId}');`);
  return { owner, accountId: product.data.account_id as string, productId: productId as string,
    revisionId: revisionId as string, jobId, attemptId, artifactId: randomUUID() };
}

export async function completeArtifactFixture() {
  const fixture = await startArtifactFixture();
  const config = objectStorageConfigFromEnvironment(process.env);
  const store = createS3BlobStore(config);
  const before = await fixture.owner.from('artifacts').select('id').eq('job_id', fixture.jobId);
  if (before.error || before.data.length !== 0) throw new Error('Artifact metadata preceded verified bytes');
  // Real failed upload, then deliberately fault-injected read-back corruption/size.
  // The database assertion is real; corruption injection is not a claim that MinIO corrupted bytes.
  const client = new S3Client({ ...config, maxAttempts: 1 });
  const failedUpload = createS3BlobStore({ ...config, bucket: `absent-${randomUUID()}` });
  const corruptedRead = (sizeMismatch: boolean) => createS3BlobStore(config, {
    send: (async (command: Parameters<S3Client['send']>[0]) => {
      const output = await client.send(command);
      return command instanceof GetObjectCommand ? {
        ...output,
        ...(sizeMismatch ? { ContentLength: fixtureBytes.byteLength + 1 } : {
          Body: { transformToWebStream: () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(fixtureBytes.byteLength)); controller.close(); } }) },
        }),
      } : output;
    }) as S3Client['send'],
    sign: async () => { throw new Error('Signing is outside corruption fixture'); },
  });
  for (const failingStore of [failedUpload, corruptedRead(false), corruptedRead(true)]) {
    let rejected = false;
    try {
      await uploadVerifiedArtifact(failingStore, { ...fixture, artifactId: randomUUID() }, fixtureBytes, 'text/plain', async () => {
        throw new Error('Persistence reached for unverified object');
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Persistence reached for unverified object') throw error;
      rejected = true;
    }
    if (!rejected) throw new Error('Expected storage fixture failure');
    const absent = await fixture.owner.from('artifacts').select('id').eq('job_id', fixture.jobId);
    if (absent.error || absent.data.length !== 0) throw new Error('Failed storage created artifact metadata');
  }
  await uploadVerifiedArtifact(store, fixture, fixtureBytes, 'text/plain', async (result) => {
    workerSQL(`select private.worker_complete_test_build(
      ${literal(fixture.jobId)}, ${literal(fixture.attemptId)}, ${literal(fixture.artifactId)},
      ${literal(config.bucket)}, ${literal(result.key)}, ${literal(result.versionId)},
      ${literal(result.sha256)}, ${result.sizeBytes}, 'text/plain');`);
  });
  return fixture;
}


export async function provisionOtherOwnerFixture() {
  const email = 'milestone7-other-owner@example.test';
  const admin = fixtureAdmin();
  const users = await admin.auth.admin.listUsers();
  if (users.error) throw new Error('Cannot inspect local fixture users');
  let user = users.data.users.find((item) => item.email === email);
  if (!user) {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('Cannot create local other-owner fixture');
    user = created.data.user;
  }
  // Test-only owner provisioning; production RLS and atelier_worker permissions are unchanged.
  localURL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321');
  try {
    execFileSync('docker', ['exec', '-i', 'supabase_db_atelier-aurelia-studio',
      'psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
      input: `do $$ declare account uuid; begin
        if not exists(select 1 from public.account_memberships where user_id=${literal(user.id)}) then
          insert into public.accounts(name,created_by) values ('Other storage acceptance account',${literal(user.id)}) returning id into account;
          insert into public.account_memberships(account_id,user_id,role) values (account,${literal(user.id)},'owner');
        end if; end $$;`, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { throw new Error('Cannot provision local other-owner membership'); }
  return email;
}
