import { logger, runs, schedules } from '@trigger.dev/sdk';
import { dispatchOne } from '../dispatcher.ts';
import { createWorkerRepository } from '../postgres.ts';
import { triggerDispatcher } from '../provider.ts';

// Deployment installs this Cloud schedule; no browser or request-path dispatch credentials.
export const generationDispatcher = schedules.task({
  id: 'atelier-generation-dispatcher',
  cron: '* * * * *',
  queue: { concurrencyLimit: 1 },
  maxDuration: 120,
  retry: { maxAttempts: 3 },
  run: async () => {
    const db = createWorkerRepository();
    try {
      for (let count = 0; count < 25; count++) {
        if (!await dispatchOne(db.repository, triggerDispatcher, (event, fields) => logger.info(event, fields))) break;
      }
    } catch { throw new Error('Generation dispatch failed; database lease will recover.'); }
    finally { await db.close(); }
  },
});

const failedStates = new Set(['FAILED', 'CRASHED', 'SYSTEM_FAILURE', 'EXPIRED', 'TIMED_OUT', 'COMPLETED']);
export const generationReconciler = schedules.task({
  id: 'atelier-generation-reconciler',
  cron: '*/5 * * * *',
  queue: { concurrencyLimit: 1 },
  maxDuration: 300,
  run: async () => {
    const db = createWorkerRepository();
    try {
      let after: string | null = null;
      for (;;) {
        const active = await db.repository.activeRuns(after);
        if (!active.length) break;
        for (const job of active) {
          try {
            const run = await runs.retrieve(job.runId);
            if (job.status === 'cancel_requested' && !run.isCompleted) await runs.cancel(job.runId);
            const terminal = run.status === 'CANCELED' ? 'canceled' : failedStates.has(run.status) ? 'failed' : null;
            // A provider success never creates a database completion. Only verified outputs can.
            if (terminal) await db.repository.reconcile(job.jobId, job.runId, terminal);
          } catch {
            logger.error('workflow.reconciliation_failed', { jobId: job.jobId, runId: job.runId });
          } finally { after = job.jobId; }
        }
      }
    } catch { throw new Error('Generation reconciliation failed; scheduled retry will recover.'); }
    finally { await db.close(); }
  },
});
