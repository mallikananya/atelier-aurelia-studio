import { logger, schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createS3BlobStore, objectStorageConfigFromEnvironment } from '../../../storage/src/index.ts';
import { executeBuild } from '../execution.ts';
import { createWorkerRepository } from '../postgres.ts';
import { PHASE1_TASK_ID } from '../provider.ts';

async function reconcile(jobId: string, runId: string, terminal: 'failed' | 'canceled') {
  const db = createWorkerRepository();
  try { await db.repository.reconcile(jobId, runId, terminal); }
  finally { await db.close(); }
}

export const phase1TestBuild = schemaTask({
  id: PHASE1_TASK_ID,
  schema: z.strictObject({ jobId: z.uuid() }),
  queue: { concurrencyLimit: 5 },
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 130_000, maxTimeoutInMs: 180_000, factor: 1.5, randomize: true },
  run: async ({ jobId }, { ctx, signal }) => {
    const db = createWorkerRepository();
    try {
      const config = objectStorageConfigFromEnvironment(process.env);
      await executeBuild(db.repository, createS3BlobStore(config), config.bucket,
        { jobId, runId: ctx.run.id, attemptNumber: ctx.attempt.number },
        (event, fields) => logger.info(event, fields), signal);
    } catch { throw new Error('Phase 1 build could not complete; inspect database job and correlation logs.'); }
    finally { await db.close(); }
  },
  onFailure: async ({ payload, ctx }) => reconcile(payload.jobId, ctx.run.id, 'failed'),
  onCancel: async ({ payload, ctx }) => reconcile(payload.jobId, ctx.run.id, 'canceled'),
});
