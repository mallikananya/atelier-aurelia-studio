import { createHash } from 'node:crypto';
import {
  PlanningRequestV1, PlanningEnvelopeV1, PLANNING_MAX_ATTEMPTS, PLANNING_MAX_BYTES,
  type PlanningEnvelope, type PlanningRequest,
} from '../../contracts/src/planning.ts';

export interface PlanningIssue { path: string; code: string; message?: string }
export interface GenerationRequest {
  idea: string;
  sources: PlanningRequest['sources'];
  retainedPageIds: string[];
  schemaVersion: 'creative-plan/1';
  attempt: number;
  previousOutput?: string;
  issues: PlanningIssue[];
}
/** Adapter returns JSON text, never trusted domain objects. No provider SDK required. */
export interface StructuredPlanningProvider {
  generate(request: GenerationRequest, signal?: AbortSignal): Promise<string>;
}
export type PlanningResult = { ok: true; envelope: PlanningEnvelope } | {
  ok: false; error: { code: 'invalid_input' | 'provider_failure' | 'invalid_output'; attempts: number; issues: PlanningIssue[] };
};

// Paths/codes only: raw model content and exception messages never enter public errors.
function diagnostics(issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[]): PlanningIssue[] {
  return issues.slice(0, 20).map(issue => ({
    path: issue.path.map((part, index) => issue.path[index - 1] === 'palette' ? '[key]' : String(part)).join('.').slice(0, 200),
    code: issue.code,
    // Custom messages are fixed strings authored by our schemas, not provider text.
    ...(issue.code === 'custom' ? { message: issue.message } : {}),
  }));
}

/** Settles cancellation even when an adapter ignores it; attaches rejection handlers
 * to late completion and always removes its listener. Cancellation cannot guarantee
 * that a remote inference engine stops computing. */
export function awaitPlanningOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Planning cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) {
      signal.removeEventListener('abort', abort);
      abort();
    }
  });
}

export async function planProduct(provider: StructuredPlanningProvider, value: unknown, signal?: AbortSignal): Promise<PlanningResult> {
  const parsed = PlanningRequestV1.safeParse(value);
  if (!parsed.success) return { ok: false, error: { code: 'invalid_input', attempts: 0, issues: diagnostics(parsed.error.issues) } };
  const request = parsed.data;
  const { idea, sources, retainedPageIds, productId, revisionId, parentRevisionId, revisionNumber, ...metadata } = request;
  const inputSha256 = createHash('sha256').update(JSON.stringify({ idea, sources, retainedPageIds })).digest('hex');
  let issues: PlanningIssue[] = [];
  let previousOutput: string | undefined;
  for (let attempt = 1; attempt <= PLANNING_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return { ok: false, error: { code: 'provider_failure', attempts: attempt - 1, issues: [] } };
    let output: string;
    try {
      output = await awaitPlanningOperation(provider.generate(structuredClone({ idea, sources, retainedPageIds,
        schemaVersion: 'creative-plan/1', attempt, issues, previousOutput }), signal), signal);
      signal?.throwIfAborted();
    } catch {
      return { ok: false, error: { code: 'provider_failure', attempts: attempt, issues: [] } };
    }
    // Check before parsing, and never resend unbounded output during repair.
    if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > PLANNING_MAX_BYTES) {
      issues = [{ path: '', code: 'payload_too_large_or_not_text' }]; previousOutput = undefined; continue;
    }
    previousOutput = output;
    let plan: unknown;
    try { plan = JSON.parse(output); }
    catch { issues = [{ path: '', code: 'invalid_json' }]; continue; }
    const result = PlanningEnvelopeV1.safeParse({ schemaVersion: 'planning-envelope/1',
      productId, revisionId, parentRevisionId, revisionNumber, plan,
      provenance: { schemaVersion: 'planning-provenance/1', ...metadata, idea, sources, retainedPageIds, inputSha256, attempts: attempt } });
    if (result.success) return { ok: true, envelope: result.data };
    issues = diagnostics(result.error.issues);
  }
  return { ok: false, error: { code: 'invalid_output', attempts: PLANNING_MAX_ATTEMPTS, issues } };
}
