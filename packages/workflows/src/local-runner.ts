import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createS3BlobStore, objectStorageConfigFromEnvironment, type BlobStore,
  type S3BlobStoreConfig } from '../../storage/src/index.ts';
import { dispatchOne } from './dispatcher.ts';
import { executeBuild } from './execution.ts';
import { createWorkerRepository, workerDatabaseConfig } from './postgres.ts';
import type { BuildDispatcher, WorkflowLog, WorkflowRepository } from './ports.ts';

const LOCAL_RUN_PREFIX = 'local:';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

interface RecoverableWorkflowRepository extends WorkflowRepository {
  activeRuns(afterJobId?: string | null): Promise<{ jobId: string; runId: string; status: string }[]>;
  reconcile(jobId: string, runId: string, terminal: 'failed' | 'canceled'): Promise<void>;
}

export interface LocalRunnerConfig {
  bucket: string;
  storage: S3BlobStoreConfig;
  pollIntervalMs: number;
  retryBackoffMs: number;
  maxAttempts: number;
}

type Sleep = (delayMs: number, signal: AbortSignal) => Promise<void>;

interface CycleOptions {
  maxAttempts: number;
  retryBackoffMs: number;
  signal?: AbortSignal;
  sleep?: Sleep;
  log?: WorkflowLog;
}

interface RunnerOptions extends CycleOptions {
  repository: RecoverableWorkflowRepository;
  store: BlobStore;
  bucket: string;
  pollIntervalMs: number;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const raw = value ?? String(fallback);
  if (!/^[0-9]+$/u.test(raw)) throw new Error('Invalid local worker configuration.');
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('Invalid local worker configuration.');
  }
  return parsed;
}

/** Local execution is deliberately fail-closed: it cannot silently reach cloud database or storage endpoints. */
export function localRunnerConfig(env: NodeJS.ProcessEnv): LocalRunnerConfig {
  try {
    const database = workerDatabaseConfig(env);
    const databaseUrl = new URL(String(database.connectionString));
    const storage = objectStorageConfigFromEnvironment(env);
    if (!LOCAL_HOSTS.has(databaseUrl.hostname) || !storage.endpoint) throw new Error('not local');
    const storageUrl = new URL(storage.endpoint);
    if (!LOCAL_HOSTS.has(storageUrl.hostname)) throw new Error('not local');
    return {
      bucket: storage.bucket,
      storage,
      pollIntervalMs: boundedInteger(env.LOCAL_WORKER_POLL_INTERVAL_MS, 1_000, 50, 60_000),
      retryBackoffMs: boundedInteger(env.LOCAL_WORKER_RETRY_BACKOFF_MS, 5_000, 50, 300_000),
      // The database context owns the per-job maximum; ten is only a defensive loop ceiling.
      maxAttempts: 10,
    };
  } catch {
    throw new Error('Invalid local worker configuration.');
  }
}

const abortableSleep: Sleep = async (delayMs, signal) => {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, delayMs);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
};

async function findLocalRun(repository: RecoverableWorkflowRepository) {
  let cursor: string | null = null;
  for (;;) {
    const runs = await repository.activeRuns(cursor);
    const local = runs.find((run) => run.runId.startsWith(LOCAL_RUN_PREFIX));
    if (local) return local;
    if (runs.length === 0) return null;
    cursor = runs.at(-1)?.jobId ?? null;
  }
}

async function executeWithRetries(repository: WorkflowRepository, store: BlobStore, bucket: string,
  jobId: string, runId: string, options: Required<Pick<CycleOptions, 'maxAttempts' | 'retryBackoffMs' | 'sleep'>> & CycleOptions) {
  const signal = options.signal ?? new AbortController().signal;
  const context = await repository.executionContext(jobId, runId);
  const maxAttempts = Math.min(context.maxAttempts, options.maxAttempts);
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      await executeBuild(repository, store, bucket, { jobId, runId, attemptNumber }, options.log, signal);
      return;
    } catch {
      if (signal.aborted) throw new Error('Local workflow execution interrupted.');
      if (attemptNumber === maxAttempts) throw new Error('Local workflow execution failed.');
      await options.sleep(options.retryBackoffMs, signal);
    }
  }
}

/** Processes at most one bound or queued job, keeping polling memory and database pressure bounded. */
export async function processLocalCycle(repository: RecoverableWorkflowRepository, store: BlobStore,
  bucket: string, options: CycleOptions): Promise<boolean> {
  const signal = options.signal ?? new AbortController().signal;
  const resolved = { ...options, signal, sleep: options.sleep ?? abortableSleep };
  signal.throwIfAborted();

  const recovered = await findLocalRun(repository);
  if (recovered) {
    if (recovered.status === 'cancel_requested') {
      await repository.reconcile(recovered.jobId, recovered.runId, 'canceled');
    } else {
      await executeWithRetries(repository, store, bucket, recovered.jobId, recovered.runId, resolved);
    }
    return true;
  }

  let accepted: { jobId: string; runId: string } | undefined;
  const dispatcher: BuildDispatcher = {
    async dispatchTestBuild(input) {
      const runId = `${LOCAL_RUN_PREFIX}${randomUUID()}`;
      accepted = { jobId: input.jobId, runId };
      return { providerRunId: runId };
    },
  };
  if (!await dispatchOne(repository, dispatcher, options.log)) return false;
  if (!accepted) throw new Error('Local workflow dispatch failed.');
  await executeWithRetries(repository, store, bucket, accepted.jobId, accepted.runId, resolved);
  return true;
}

export async function runLocalWorker(options: RunnerOptions): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  while (!options.signal?.aborted) {
    try {
      const processed = await processLocalCycle(options.repository, options.store, options.bucket,
        { ...options, sleep });
      if (!processed) await sleep(options.pollIntervalMs, options.signal ?? new AbortController().signal);
    } catch {
      if (options.signal?.aborted) break;
      options.log?.('workflow.local_cycle_failed', { jobId: 'local-runner' });
      await sleep(options.retryBackoffMs, options.signal ?? new AbortController().signal);
    }
  }
}

/* v8 ignore start -- process signal and resource wiring is exercised by the compiled smoke check. */
async function main() {
  const config = localRunnerConfig(process.env);
  const db = createWorkerRepository();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runLocalWorker({ repository: db.repository, store: createS3BlobStore(config.storage),
      bucket: config.bucket, signal: controller.signal, pollIntervalMs: config.pollIntervalMs,
      retryBackoffMs: config.retryBackoffMs, maxAttempts: config.maxAttempts,
      log: (event, fields) => console.info(JSON.stringify({ event, ...fields })) });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(JSON.stringify({ event: 'workflow.local_runner_failed' }));
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
