import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { uploadVerifiedArtifact, type BlobStore } from '../../storage/src/index.ts';
import type { ExecutionInput, WorkflowRepository, WorkflowLog } from './ports.ts';

import { generatePlanner, validatePlanner } from './planner.ts';

const Execution = z.strictObject({ jobId: z.uuid(), runId: z.string().trim().min(1).max(300),
  attemptNumber: z.number().int().min(1).max(100) });

/** Execute the persisted job edition; ownership and revision identity never come from client payload. */
export async function executeBuild(repository: WorkflowRepository, store: BlobStore, bucket: string,
  value: ExecutionInput, log: WorkflowLog = () => {}, signal?: AbortSignal): Promise<void> {
  const input = Execution.parse(value);
  signal?.throwIfAborted();
  await repository.withExecutionLock(input.jobId, async (locked) => {
    const context = await locked.executionContext(input.jobId, input.runId);
    const attempt = await locked.beginExecution(input);
    if (attempt.state === 'succeeded') { log('workflow.replayed', input); return; }
    if (!attempt.attemptId) throw new Error('Missing execution attempt.');
    const attemptId = attempt.attemptId;
    log('workflow.started', input);
    try {
      signal?.throwIfAborted();
      const isPlanner = context.jobType === 'planner_pdf_v1';
      const bytes = isPlanner ? await generatePlanner() : new TextEncoder().encode(JSON.stringify({ schemaVersion: 'phase1.1',
        kind: 'phase1-test-build', jobId: context.jobId, productId: context.productId,
        revisionId: context.revisionId, name: context.revisionName,
        revisionContentSha256: context.contentSha256 }) + '\n');
      if (isPlanner) await validatePlanner(bytes);
      const mediaType = isPlanner ? 'application/pdf' : 'text/plain';
      signal?.throwIfAborted();
      // Every execution incarnation gets a fresh identity. Uncertain writes remain private
      // orphans; retries never overwrite an earlier object's exact version.
      const artifactId = randomUUID();
      await uploadVerifiedArtifact(store, { ...context, artifactId }, bytes, mediaType,
        (result) => {
          signal?.throwIfAborted();
          return locked.complete({ jobId: input.jobId, attemptId, artifactId, bucket, mediaType, result });
        });
      log('workflow.succeeded', input);
    } catch {
      if (signal?.aborted) {
        log('workflow.interrupted', input);
        throw new Error('Test build execution interrupted.');
      }
      // Completion may have committed before a connection failed. SQL refuses to fail
      // succeeded work; a replay consults the authoritative job and performs no upload.
      try { await locked.fail({ jobId: input.jobId, attemptId, isFinal: input.attemptNumber >= context.maxAttempts }); }
      catch { /* Next retry / terminal reconciliation reads authoritative state. */ }
      log('workflow.attempt_failed', input);
      throw new Error('Test build execution failed.');
    }
  });
}
