import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { executeBuild } from './execution.ts';
import { dispatchOne } from './dispatcher.ts';
import type { WorkflowRepository } from './ports.ts';

const identity = { jobId: randomUUID(), accountId: randomUUID(), productId: randomUUID(), revisionId: randomUUID() };
const input = { jobId: identity.jobId, runId: 'run_test', attemptNumber: 1 };
function fixture() {
  const context = { ...identity, revisionName: 'Persisted product', contentSha256: 'a'.repeat(64), status: 'running', maxAttempts: 3 };
  const repository: WorkflowRepository = {
    claim: vi.fn().mockResolvedValue({ ...identity, outboxId: randomUUID(), leaseToken: randomUUID() }),
    bind: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined),
    withExecutionLock: vi.fn(async (_id, work) => work(repository)),
    executionContext: vi.fn().mockResolvedValue(context),
    beginExecution: vi.fn().mockResolvedValue({ state: 'started', attemptId: randomUUID() }),
    complete: vi.fn().mockResolvedValue(undefined), fail: vi.fn().mockResolvedValue(undefined),
  };
  const store = { putImmutable: vi.fn(async (request) => ({ key: request.key, sha256: request.sha256, sizeBytes: request.bytes.length, versionId: 'version-1' })), createSignedDownload: vi.fn() };
  const provider = { dispatchTestBuild: vi.fn().mockResolvedValue({ providerRunId: input.runId }) };
  return { repository, context, store, provider };
}
describe('durable dispatcher', () => {
  it('binds only claimed persisted work', async () => {
    const f = fixture();
    expect(await dispatchOne(f.repository, f.provider)).toBe(true);
    expect(f.repository.bind).toHaveBeenCalledWith(expect.objectContaining(identity), input.runId);
    expect(f.repository.release).not.toHaveBeenCalled();
  });
  it('duplicate dispatch does nothing without a lease', async () => {
    const f = fixture(); vi.mocked(f.repository.claim).mockResolvedValue(null);
    expect(await dispatchOne(f.repository, f.provider)).toBe(false);
    expect(f.provider.dispatchTestBuild).not.toHaveBeenCalled();
  });
  it.each(['provider', 'binding'])('releases after %s failure without persisting provider error', async (stage) => {
    const f = fixture();
    (stage === 'provider' ? f.provider.dispatchTestBuild : vi.mocked(f.repository.bind)).mockRejectedValue(new Error('secret'));
    await expect(dispatchOne(f.repository, f.provider)).rejects.toThrow('Workflow dispatch failed.');
    expect(f.repository.release).toHaveBeenCalledOnce();
  });
  it('lease release failure remains recoverable by lease expiry', async () => {
    const f = fixture(); f.provider.dispatchTestBuild.mockRejectedValue(new Error('secret'));
    vi.mocked(f.repository.release).mockRejectedValue(new Error('lease expired'));
    await expect(dispatchOne(f.repository, f.provider)).rejects.toThrow('Workflow dispatch failed.');
  });
});
describe('Phase 1 persisted execution', () => {
  it('uploads persisted revision bytes before completing exact provenance', async () => {
    const f = fixture(); await executeBuild(f.repository, f.store, 'artifacts', input);
    const request = f.store.putImmutable.mock.calls[0][0];
    expect(new TextDecoder().decode(request.bytes)).toContain(f.context.contentSha256);
    expect(new TextDecoder().decode(request.bytes)).toContain('Persisted product');
    expect(f.repository.complete).toHaveBeenCalledWith(expect.objectContaining({ jobId: input.jobId, bucket: 'artifacts', result: expect.objectContaining({ versionId: 'version-1', sha256: request.sha256 }) }));
    expect(f.repository.fail).not.toHaveBeenCalled();
  });
  it('completed replay performs no writes', async () => {
    const f = fixture(); vi.mocked(f.repository.beginExecution).mockResolvedValue({ state: 'succeeded', attemptId: null });
    await executeBuild(f.repository, f.store, 'artifacts', input);
    expect(f.store.putImmutable).not.toHaveBeenCalled();
  });
  it.each(['context', 'begin'])('rejects invalid binding or stale state at %s before storage', async (stage) => {
    const f = fixture(); vi.mocked(stage === 'context' ? f.repository.executionContext : f.repository.beginExecution).mockRejectedValue(new Error('invalid'));
    await expect(executeBuild(f.repository, f.store, 'artifacts', input)).rejects.toThrow();
    expect(f.store.putImmutable).not.toHaveBeenCalled();
    expect(f.repository.fail).not.toHaveBeenCalled();
  });
  it.each(['storage', 'completion'])('records retryable %s failure, retry uses fresh immutable artifact identity', async (stage) => {
    const f = fixture();
    const target = stage === 'storage' ? f.store.putImmutable : vi.mocked(f.repository.complete);
    target.mockRejectedValueOnce(new Error('private provider detail'));
    await expect(executeBuild(f.repository, f.store, 'artifacts', input)).rejects.toThrow('Test build execution failed.');
    expect(f.repository.fail).toHaveBeenCalledWith(expect.objectContaining({ isFinal: false }));
    await executeBuild(f.repository, f.store, 'artifacts', { ...input, attemptNumber: 2 });
    expect(f.store.putImmutable.mock.calls[0][0].key).not.toBe(f.store.putImmutable.mock.calls[1][0].key);
  });
  it('last attempt failure is terminal', async () => {
    const f = fixture(); f.store.putImmutable.mockRejectedValue(new Error('failure'));
    await expect(executeBuild(f.repository, f.store, 'artifacts', { ...input, attemptNumber: 3 })).rejects.toThrow();
    expect(f.repository.fail).toHaveBeenCalledWith(expect.objectContaining({ isFinal: true }));
  });
  it('database outage during failure remains retryable and sanitized', async () => {
    const f = fixture(); f.store.putImmutable.mockRejectedValue(new Error('secret'));
    vi.mocked(f.repository.fail).mockRejectedValue(new Error('connection secret'));
    await expect(executeBuild(f.repository, f.store, 'artifacts', input)).rejects.toThrow('Test build execution failed.');
  });
  it.each([{ ...input, jobId: 'invalid' }, { ...input, attemptNumber: 0 }, { ...input, runId: '' }])('rejects malformed worker input', async (bad) => {
    const f = fixture(); await expect(executeBuild(f.repository, f.store, 'artifacts', bad)).rejects.toThrow();
    expect(f.repository.withExecutionLock).not.toHaveBeenCalled();
  });
});

it('cancellation before persistence never marks a final attempt failed or complete', async () => {
  const f = fixture();
  const controller = new AbortController();
  const originalPut = f.store.putImmutable.getMockImplementation()!;
  f.store.putImmutable.mockImplementation(async (request) => {
    const uploaded = await originalPut(request); controller.abort(); return uploaded;
  });
  await expect(executeBuild(f.repository, f.store, 'artifacts', { ...input, attemptNumber: 3 }, undefined, controller.signal)).rejects.toThrow();
  expect(f.repository.complete).not.toHaveBeenCalled();
  expect(f.repository.fail).not.toHaveBeenCalled();
});

it('generates and validates a planner before persisting PDF provenance', async () => {
  const f = fixture();
  vi.mocked(f.repository.executionContext).mockResolvedValue({ ...f.context, jobType: 'planner_pdf_v1' });
  await executeBuild(f.repository, f.store, 'artifacts', input);
  const request = f.store.putImmutable.mock.calls[0][0];
  expect(Buffer.from(request.bytes).subarray(0, 5).toString()).toBe('%PDF-');
  expect(request.key).toMatch(/\/planner.pdf$/);
  expect(request.mediaType).toBe('application/pdf');
  expect(f.repository.complete).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'application/pdf' }));
});
