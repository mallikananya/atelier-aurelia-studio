import type { WorkflowDispatcher } from '../../core/src/ports.ts';
import type { ImmutablePutResult } from '../../storage/src/index.ts';

export interface DispatchClaim {
  outboxId: string; leaseToken: string; jobId: string;
  accountId: string; productId: string; revisionId: string;
}
export interface ExecutionInput { jobId: string; runId: string; attemptNumber: number }
export interface ExecutionContext {
  jobId: string; accountId: string; productId: string; revisionId: string;
  jobType?: 'phase1_test_build' | 'planner_pdf_v1';
  revisionName: string; contentSha256: string; status: string; maxAttempts: number;
}
export interface WorkflowRepository {
  claim(workerId: string): Promise<DispatchClaim | null>;
  bind(claim: DispatchClaim, runId: string): Promise<void>;
  release(claim: DispatchClaim, retryAt: Date): Promise<void>;
  withExecutionLock<T>(jobId: string, work: (repository: WorkflowRepository) => Promise<T>): Promise<T>;
  executionContext(jobId: string, runId: string): Promise<ExecutionContext>;
  beginExecution(input: ExecutionInput): Promise<{ state: 'started' | 'succeeded'; attemptId: string | null }>;
  complete(input: { jobId: string; attemptId: string; artifactId: string; bucket: string; mediaType?: string; result: ImmutablePutResult }): Promise<void>;
  fail(input: { jobId: string; attemptId: string; isFinal: boolean }): Promise<void>;
}
export type BuildDispatcher = WorkflowDispatcher;
export type WorkflowLog = (event: string, fields: { jobId: string; runId?: string; attemptNumber?: number }) => void;
