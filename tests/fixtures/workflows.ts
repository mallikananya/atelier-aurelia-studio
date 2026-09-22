import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWorkerRepository } from '../../packages/workflows/src/postgres';
import { dispatchOne } from '../../packages/workflows/src/dispatcher';
import { fixtureSession, ownerEmail } from './storage';

/** Isolated local LOGIN role: only inherits the existing restricted worker capability. */
export function localWorker() {
  const url = new URL(process.env.WORKER_DATABASE_URL ?? 'postgresql://localhost:54322/postgres');
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Workflow fixtures require local PostgreSQL');
  const password = randomBytes(32).toString('hex');
  const role = `workflow_fixture_${randomBytes(8).toString('hex')}`;
  try {
    execFileSync('docker', ['exec', '-i', 'supabase_db_atelier-aurelia-studio', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
      input: `create role ${role} login password '${password}'; grant atelier_worker to ${role};`, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { throw new Error('Local worker provisioning failed'); }
  url.username = role; url.password = password;
  const worker = createWorkerRepository({ WORKER_DATABASE_URL: url.toString() });
  return { ...worker, async close() {
    await worker.close();
    execFileSync('docker', ['exec', '-i', 'supabase_db_atelier-aurelia-studio', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
      input: `drop role ${role};`, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } };
}

export async function queuedBuild() {
  const owner = await fixtureSession(ownerEmail);
  const result = await owner.rpc('create_product_with_revision', { p_name: 'Durable build acceptance' });
  if (result.error) throw new Error('Local workflow product creation failed');
  const { product_id: productId, revision_id: revisionId } = result.data[0];
  const args = { p_product_id: productId, p_revision_id: revisionId, p_idempotency_key: `phase1:${revisionId}` };
  const queued = await owner.rpc('enqueue_phase1_test_build', args);
  if (queued.error) throw new Error('Local workflow enqueue failed');
  return { owner, productId: productId as string, revisionId: revisionId as string, jobId: queued.data[0].job_id as string, args };
}

export async function localDispatch(worker: ReturnType<typeof localWorker>, jobId: string) {
  const runId = `run_local_${randomUUID()}`;
  await dispatchOne(worker.repository, { async dispatchTestBuild(input) {
    if (input.jobId !== jobId) throw new Error('Unexpected pending job; use a clean local fixture database');
    return { providerRunId: runId };
  } });
  return runId;
}
