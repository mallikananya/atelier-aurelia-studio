import { idempotencyKeys, tasks } from '@trigger.dev/sdk';
import type { BuildDispatcher } from './ports.ts';

export const PHASE1_TASK_ID = 'atelier-phase1-test-build';
export const triggerDispatcher: BuildDispatcher = {
  async dispatchTestBuild(input) {
    const key = await idempotencyKeys.create(`phase1:${input.jobId}`, { scope: 'global' });
    const run = await tasks.trigger(PHASE1_TASK_ID, { jobId: input.jobId }, {
      idempotencyKey: key, idempotencyKeyTTL: '30d',
      tags: [`job:${input.jobId}`],
    });
    return { providerRunId: run.id };
  },
};
