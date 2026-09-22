import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { WorkflowRepository } from '../../packages/workflows/src/ports';
import { executeBuild } from '../../packages/workflows/src/execution';
import { dispatchOne } from '../../packages/workflows/src/dispatcher';
import { createS3BlobStore, objectStorageConfigFromEnvironment } from '../../packages/storage/src/index';
import { localWorker, localDispatch, queuedBuild } from '../fixtures/workflows';

const config = objectStorageConfigFromEnvironment(process.env);
if (!config.endpoint || !['localhost', '127.0.0.1'].includes(new URL(config.endpoint).hostname)) throw new Error('Workflow tests require local MinIO');
const store = createS3BlobStore(config);
const worker = localWorker();
afterAll(() => worker.close());

describe('Durable execution against real PostgreSQL and MinIO', () => {
  it('deduplicates enqueue/dispatch/replay and verifies persisted exact-version output', async () => {
    const fixture = await queuedBuild();
    const duplicate = await fixture.owner.rpc('enqueue_phase1_test_build', fixture.args);
    expect(duplicate.error).toBeNull();
    expect(duplicate.data[0]).toMatchObject({ job_id: fixture.jobId, was_created: false });
    const runId = await localDispatch(worker, fixture.jobId);
    expect(await dispatchOne(worker.repository, { async dispatchTestBuild() { throw new Error('Duplicate provider dispatch'); } })).toBe(false);
    const input = { jobId: fixture.jobId, runId, attemptNumber: 1 };
    await executeBuild(worker.repository, store, config.bucket, input);
    await executeBuild(worker.repository, store, config.bucket, input);
    const artifacts = await fixture.owner.from('artifacts').select('*').eq('job_id', fixture.jobId);
    expect(artifacts.error).toBeNull(); expect(artifacts.data).toHaveLength(1);
    const artifact = artifacts.data![0];
    expect(artifact.state).toBe('available');
    const output = await fetch(await store.createSignedDownload(artifact.storage_key, artifact.storage_version_id, 60));
    expect(output.status).toBe(200);
    expect(await output.json()).toMatchObject({ jobId: fixture.jobId, revisionId: fixture.revisionId });
    const job = await fixture.owner.from('jobs').select('status,attempt_count').eq('id', fixture.jobId).single();
    expect(job.data).toMatchObject({ status: 'succeeded', attempt_count: 1 });
  });

  it('retries a real storage failure without publishing completion or partial metadata', async () => {
    const fixture = await queuedBuild();
    const runId = await localDispatch(worker, fixture.jobId);
    const badStore = createS3BlobStore({ ...config, bucket: `missing-${randomUUID()}` });
    await expect(executeBuild(worker.repository, badStore, config.bucket, { jobId: fixture.jobId, runId, attemptNumber: 1 })).rejects.toThrow();
    const before = await fixture.owner.from('artifacts').select('id').eq('job_id', fixture.jobId);
    expect(before.data).toEqual([]);
    const jobBefore = await fixture.owner.from('jobs').select('status').eq('id', fixture.jobId).single();
    expect(jobBefore.data?.status).not.toBe('succeeded');
    await executeBuild(worker.repository, store, config.bucket, { jobId: fixture.jobId, runId, attemptNumber: 2 });
    const job = await fixture.owner.from('jobs').select('status,attempt_count').eq('id', fixture.jobId).single();
    expect(job.data).toMatchObject({ status: 'succeeded', attempt_count: 2 });
  });

  it('rejects nonexistent jobs and mismatched provider runs without changing queued work', async () => {
    await expect(executeBuild(worker.repository, store, config.bucket, { jobId: randomUUID(), runId: 'run_missing', attemptNumber: 1 })).rejects.toThrow();
    const fixture = await queuedBuild();
    const runId = await localDispatch(worker, fixture.jobId);
    await expect(executeBuild(worker.repository, store, config.bucket, { jobId: fixture.jobId, runId: 'run_forged', attemptNumber: 1 })).rejects.toThrow();
    await executeBuild(worker.repository, store, config.bucket, { jobId: fixture.jobId, runId, attemptNumber: 1 });
  });
  it('recovers an interrupted attempt after its worker session releases the execution lock', async () => {
    const fixture = await queuedBuild();
    const runId = await localDispatch(worker, fixture.jobId);
    await worker.repository.withExecutionLock(fixture.jobId, async locked => {
      const started = await locked.beginExecution({ jobId: fixture.jobId, runId, attemptNumber: 1 });
      expect(started.state).toBe('started');
      // Simulate worker termination before upload: closing this dedicated session
      // releases its lock while the durable database attempt remains running.
    });
    await executeBuild(worker.repository, store, config.bucket, { jobId: fixture.jobId, runId, attemptNumber: 2 });
    const result = await fixture.owner.from('jobs').select('status,attempt_count').eq('id', fixture.jobId).single();
    expect(result.data).toMatchObject({ status: 'succeeded', attempt_count: 2 });
  });

});

function completionFault(commitFirst: boolean): WorkflowRepository {
  return new Proxy(worker.repository, {
    get(target, property) {
      if (property === 'withExecutionLock') return <T>(jobId: string, work: (repository: WorkflowRepository) => Promise<T>) =>
        target.withExecutionLock(jobId, (locked) => work(new Proxy(locked, {
          get(inner, member) {
            if (member === 'complete') return async (input: Parameters<WorkflowRepository['complete']>[0]) => {
              if (commitFirst) await inner.complete(input);
              throw new Error('Injected database response loss');
            };
            const value = Reflect.get(inner, member);
            return typeof value === 'function' ? value.bind(inner) : value;
          },
        })));
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

it.each([false, true])('recovers database completion response failure (committed=%s)', async (committed) => {
  const fixture = await queuedBuild();
  const runId = await localDispatch(worker, fixture.jobId);
  await expect(executeBuild(completionFault(committed), store, config.bucket,
    { jobId: fixture.jobId, runId, attemptNumber: 1 })).rejects.toThrow();
  const before = await fixture.owner.from('artifacts').select('id').eq('job_id', fixture.jobId);
  expect(before.error).toBeNull();
  expect(before.data).toHaveLength(committed ? 1 : 0);
  await executeBuild(worker.repository, store, config.bucket, { jobId: fixture.jobId, runId, attemptNumber: 2 });
  const after = await fixture.owner.from('artifacts').select('id').eq('job_id', fixture.jobId);
  expect(after.error).toBeNull(); expect(after.data).toHaveLength(1);
  if (committed) expect(after.data).toEqual(before.data);
});

it('excludes concurrent executions with the real session lock', async () => {
  const fixture = await queuedBuild();
  const runId = await localDispatch(worker, fixture.jobId);
  await worker.repository.withExecutionLock(fixture.jobId, async () => {
    await expect(executeBuild(worker.repository, store, config.bucket,
      { jobId: fixture.jobId, runId, attemptNumber: 1 })).rejects.toThrow('already active');
  });
  await executeBuild(worker.repository, store, config.bucket, { jobId: fixture.jobId, runId, attemptNumber: 1 });
});
