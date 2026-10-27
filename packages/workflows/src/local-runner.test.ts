import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BlobStore } from '../../storage/src/index.ts';
import type { WorkflowRepository } from './ports.ts';
import { localRunnerConfig, processLocalCycle, runLocalWorker } from './local-runner.ts';

const identity = { jobId: randomUUID(), accountId: randomUUID(), productId: randomUUID(), revisionId: randomUUID() };

function fixture() {
  const events: string[] = [];
  const repository: WorkflowRepository & {
    activeRuns(after?: string | null): Promise<{ jobId: string; runId: string; status: string }[]>;
    reconcile(jobId: string, runId: string, terminal: 'failed' | 'canceled'): Promise<void>;
  } = {
    claim: vi.fn(async () => ({ ...identity, outboxId: randomUUID(), leaseToken: randomUUID() })),
    bind: vi.fn(async () => { events.push('bound'); }),
    release: vi.fn(async () => undefined),
    withExecutionLock: vi.fn(async (_jobId, work) => work(repository)),
    executionContext: vi.fn(async () => ({ ...identity, revisionName: 'Local product',
      contentSha256: 'a'.repeat(64), status: 'running', maxAttempts: 3 })),
    beginExecution: vi.fn(async () => { events.push('executed'); return { state: 'started' as const, attemptId: randomUUID() }; }),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    activeRuns: vi.fn(async () => []),
    reconcile: vi.fn(async () => undefined),
  };
  const store: BlobStore = {
    putImmutable: vi.fn(async (request) => ({ key: request.key, versionId: 'version-1',
      sha256: request.sha256, sizeBytes: request.bytes.byteLength })),
    createSignedDownload: vi.fn(),
  };
  return { events, repository, store };
}

describe('local runner configuration', () => {
  const valid = {
    WORKER_DATABASE_URL: 'postgresql://atelier_worker_login:secret@127.0.0.1:54322/postgres',
    OBJECT_STORAGE_BUCKET: 'atelier-aurelia-artifacts', OBJECT_STORAGE_REGION: 'us-east-1',
    OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000', OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    AWS_ACCESS_KEY_ID: 'runtime', AWS_SECRET_ACCESS_KEY: 'secret',
  };

  it('accepts bounded local PostgreSQL and MinIO settings', () => {
    expect(localRunnerConfig(valid)).toMatchObject({ bucket: 'atelier-aurelia-artifacts', pollIntervalMs: 1_000,
      retryBackoffMs: 5_000, maxAttempts: 10 });
    expect(localRunnerConfig({ ...valid, LOCAL_WORKER_POLL_INTERVAL_MS: '50',
      LOCAL_WORKER_RETRY_BACKOFF_MS: '300000' })).toMatchObject({ pollIntervalMs: 50, retryBackoffMs: 300_000 });
  });

  it.each([
    { WORKER_DATABASE_URL: 'postgresql://worker:secret@db.example.com/postgres?sslmode=verify-full' },
    { OBJECT_STORAGE_ENDPOINT: 'https://s3.example.com' },
    { OBJECT_STORAGE_ENDPOINT: undefined },
    { LOCAL_WORKER_POLL_INTERVAL_MS: '0' },
    { LOCAL_WORKER_RETRY_BACKOFF_MS: 'not-a-number' },
  ])('rejects non-local or unsafe settings without exposing credentials', (patch) => {
    expect(() => localRunnerConfig({ ...valid, ...patch })).toThrow('Invalid local worker configuration.');
  });
});

describe('local workflow processing', () => {
  it('uses dispatchOne to bind a unique local run before executeBuild writes through BlobStore', async () => {
    const f = fixture();
    expect(await processLocalCycle(f.repository, f.store, 'artifacts', { maxAttempts: 3,
      retryBackoffMs: 10, sleep: vi.fn() })).toBe(true);
    expect(f.events).toEqual(['bound', 'executed']);
    expect(f.repository.bind).toHaveBeenCalledWith(expect.objectContaining({ jobId: identity.jobId }),
      expect.stringMatching(/^local:/));
    expect(f.store.putImmutable).toHaveBeenCalledOnce();
    expect(f.repository.complete).toHaveBeenCalledOnce();
  });

  it('retries failed execution with a bounded provider attempt ordinal and backoff', async () => {
    const f = fixture();
    vi.mocked(f.store.putImmutable).mockRejectedValueOnce(new Error('MinIO unavailable'));
    const sleep = vi.fn(async () => undefined);
    await processLocalCycle(f.repository, f.store, 'artifacts', { maxAttempts: 3, retryBackoffMs: 25, sleep });
    expect(f.repository.beginExecution).toHaveBeenNthCalledWith(1, expect.objectContaining({ attemptNumber: 1 }));
    expect(f.repository.beginExecution).toHaveBeenNthCalledWith(2, expect.objectContaining({ attemptNumber: 2 }));
    expect(f.repository.fail).toHaveBeenCalledWith(expect.objectContaining({ isFinal: false }));
    expect(sleep).toHaveBeenCalledWith(25, expect.any(AbortSignal));
  });

  it('recovers bound local work after restart and honors a persisted cancellation', async () => {
    const f = fixture();
    vi.mocked(f.repository.activeRuns).mockResolvedValueOnce([
      { jobId: identity.jobId, runId: `local:${randomUUID()}`, status: 'cancel_requested' },
    ]);
    expect(await processLocalCycle(f.repository, f.store, 'artifacts', { maxAttempts: 3,
      retryBackoffMs: 10, sleep: vi.fn() })).toBe(true);
    expect(f.repository.reconcile).toHaveBeenCalledWith(identity.jobId, expect.stringMatching(/^local:/), 'canceled');
    expect(f.repository.claim).not.toHaveBeenCalled();
    expect(f.store.putImmutable).not.toHaveBeenCalled();
  });

  it('pages past non-local cloud runs when recovering local work', async () => {
    const f = fixture();
    vi.mocked(f.repository.activeRuns)
      .mockResolvedValueOnce([{ jobId: randomUUID(), runId: 'run_trigger_cloud', status: 'running' }])
      .mockResolvedValueOnce([{ jobId: identity.jobId, runId: `local:${randomUUID()}`, status: 'running' }]);
    await processLocalCycle(f.repository, f.store, 'artifacts', { maxAttempts: 3,
      retryBackoffMs: 10, sleep: vi.fn() });
    expect(f.repository.activeRuns).toHaveBeenCalledTimes(2);
    expect(f.repository.claim).not.toHaveBeenCalled();
    expect(f.repository.complete).toHaveBeenCalledOnce();
  });

  it('stops after the database-owned attempt limit', async () => {
    const f = fixture();
    vi.mocked(f.repository.executionContext).mockResolvedValue({ ...identity, revisionName: 'Local product',
      contentSha256: 'a'.repeat(64), status: 'running', maxAttempts: 2 });
    vi.mocked(f.store.putImmutable).mockRejectedValue(new Error('unavailable'));
    const sleep = vi.fn(async () => undefined);
    await expect(processLocalCycle(f.repository, f.store, 'artifacts', { maxAttempts: 10,
      retryBackoffMs: 25, sleep })).rejects.toThrow('Local workflow execution failed.');
    expect(f.repository.beginExecution).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('polls idly and exits cleanly when aborted', async () => {
    const f = fixture();
    vi.mocked(f.repository.claim).mockResolvedValue(null);
    const controller = new AbortController();
    const sleep = vi.fn(async () => { controller.abort(); });
    await runLocalWorker({ repository: f.repository, store: f.store, bucket: 'artifacts', signal: controller.signal,
      pollIntervalMs: 100, retryBackoffMs: 200, maxAttempts: 3, sleep });
    expect(sleep).toHaveBeenCalledOnce();
    expect(f.repository.claim).toHaveBeenCalledOnce();
  });

  it('backs off after a failed cycle and then exits on abort', async () => {
    const f = fixture();
    vi.mocked(f.repository.activeRuns).mockRejectedValue(new Error('database offline'));
    const controller = new AbortController();
    const log = vi.fn();
    const sleep = vi.fn(async (delay: number) => { expect(delay).toBe(200); controller.abort(); });
    await runLocalWorker({ repository: f.repository, store: f.store, bucket: 'artifacts', signal: controller.signal,
      pollIntervalMs: 100, retryBackoffMs: 200, maxAttempts: 3, sleep, log });
    expect(log).toHaveBeenCalledWith('workflow.local_cycle_failed', { jobId: 'local-runner' });
    expect(sleep).toHaveBeenCalledOnce();
  });
});
