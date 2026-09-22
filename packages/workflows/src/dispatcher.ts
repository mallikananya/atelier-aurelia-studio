import { randomUUID } from 'node:crypto';
import type { BuildDispatcher, WorkflowRepository, WorkflowLog } from './ports.ts';

/** The database lease is the dispatch authority; provider deduplication is additional protection. */
export async function dispatchOne(repository: WorkflowRepository, provider: BuildDispatcher,
  log: WorkflowLog = () => {}): Promise<boolean> {
  const claim = await repository.claim(randomUUID());
  if (!claim) return false;
  try {
    const { providerRunId } = await provider.dispatchTestBuild({ jobId: claim.jobId,
      accountId: claim.accountId, productId: claim.productId, revisionId: claim.revisionId });
    await repository.bind(claim, providerRunId);
    log('workflow.dispatched', { jobId: claim.jobId, runId: providerRunId });
    return true;
  } catch {
    // An ambiguous provider acceptance is safe to resend with the same global key.
    // If this release also fails, the existing two-minute database lease expires.
    try { await repository.release(claim, new Date(Date.now() + 60_000)); } catch { /* lease recovery */ }
    log('workflow.dispatch_failed', { jobId: claim.jobId });
    throw new Error('Workflow dispatch failed.');
  }
}
