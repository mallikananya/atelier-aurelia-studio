import { schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';

// Only verifies Cloud can execute this deployment; not durable job or AWS acceptance.
export const phase1CloudSmoke = schemaTask({
  id: 'atelier-phase1-cloud-smoke',
  schema: z.strictObject({}),
  queue: { concurrencyLimit: 1 },
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  run: async () => ({ status: 'ok', scope: 'cloud-runtime-only' }),
});
