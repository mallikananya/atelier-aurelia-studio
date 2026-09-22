import { beforeEach, expect, it, vi } from 'vitest';
type RunArgs = { payload: { jobId: string }; ctx: { run: { id: string }; attempt: { number: number } } };
type Definition = { id: string; maxDuration: number; retry?: { maxAttempts: number; minTimeoutInMs?: number }; cron?: string;
  schema?: { safeParse: (value: unknown) => { success: boolean } };
  run: (...args: unknown[]) => Promise<void>; onFailure?: (input: RunArgs) => Promise<void>; onCancel?: (input: RunArgs) => Promise<void> };
const mock = vi.hoisted(() => ({ definitions: [] as Definition[], activeRuns: vi.fn(), reconcile: vi.fn(), close: vi.fn(),
  execute: vi.fn(), dispatch: vi.fn(), retrieve: vi.fn(), cancel: vi.fn(), log: vi.fn(), store: {}, repository: {} }));
vi.mock('@trigger.dev/sdk', () => ({
  schemaTask: (value: Definition) => { mock.definitions.push(value); return value; },
  schedules: { task: (value: Definition) => { mock.definitions.push(value); return value; } },
  logger: { info: mock.log, error: mock.log }, runs: { retrieve: mock.retrieve, cancel: mock.cancel }, idempotencyKeys: {}, tasks: {},
}));
vi.mock('./postgres.ts', () => ({ createWorkerRepository: () => ({ repository: { ...mock.repository, activeRuns: mock.activeRuns, reconcile: mock.reconcile }, close: mock.close }) }));
vi.mock('./execution.ts', () => ({ executeBuild: mock.execute }));
vi.mock('./dispatcher.ts', () => ({ dispatchOne: mock.dispatch }));
vi.mock('../../storage/src/index.ts', () => ({ createS3BlobStore: () => mock.store, objectStorageConfigFromEnvironment: () => ({ bucket: 'private' }) }));
import './trigger/build.ts';
import './trigger/dispatcher.ts';
const build = () => mock.definitions.find((item) => item.id === 'atelier-phase1-test-build')!;
const dispatch = () => mock.definitions.find((item) => item.id === 'atelier-generation-dispatcher')!;
const reconcile = () => mock.definitions.find((item) => item.id === 'atelier-generation-reconciler')!;
const input: RunArgs = { payload: { jobId: '50000000-0000-4000-8000-000000000001' }, ctx: { run: { id: 'run_1' }, attempt: { number: 2 } } };
beforeEach(() => { vi.clearAllMocks(); mock.activeRuns.mockReset().mockResolvedValue([]); mock.execute.mockReset().mockResolvedValue(undefined); mock.dispatch.mockReset().mockResolvedValue(false); mock.retrieve.mockReset(); mock.reconcile.mockReset().mockResolvedValue(undefined); });
it('limits execution and accepts only job identity', () => {
  expect(build()).toMatchObject({ maxDuration: 300, retry: { maxAttempts: 3, minTimeoutInMs: 130000 } });
  expect(build().schema?.safeParse(input.payload).success).toBe(true);
  expect(build().schema?.safeParse({ jobId: 'invalid' }).success).toBe(false);
  expect(build().schema?.safeParse({ ...input.payload, ownerId: 'override' }).success).toBe(false);
  expect(dispatch()).toMatchObject({ cron: '* * * * *', maxDuration: 120 });
  expect(reconcile()).toMatchObject({ cron: '*/5 * * * *', maxDuration: 300 });
});
it('runs with SDK correlation and always closes database resources', async () => {
  mock.execute.mockImplementation(async (_repo, _store, _bucket, identity, log) => log('started', identity));
  await build().run(input.payload, { ctx: input.ctx });
  expect(mock.execute).toHaveBeenCalledWith(expect.anything(), mock.store, 'private', { jobId: input.payload.jobId, runId: 'run_1', attemptNumber: 2 }, expect.any(Function), undefined);
  expect(mock.log).toHaveBeenCalledWith('started', expect.objectContaining({ runId: 'run_1' }));
  expect(mock.close).toHaveBeenCalledOnce();
});
it('sanitizes execution failures and reconciles terminal lifecycle hooks', async () => {
  mock.execute.mockRejectedValue(new Error('secret'));
  await expect(build().run(input.payload, { ctx: input.ctx })).rejects.toThrow('Phase 1 build could not complete');
  await build().onFailure!(input); await build().onCancel!(input);
  expect(mock.reconcile.mock.calls).toEqual([[input.payload.jobId, 'run_1', 'failed'], [input.payload.jobId, 'run_1', 'canceled']]);
  expect(mock.close).toHaveBeenCalledTimes(3);
});
it('bounds dispatch batches and logs engine correlations', async () => {
  mock.dispatch.mockImplementation(async (_repo, _provider, log) => { log('dispatched', { jobId: 'job' }); return true; });
  await dispatch().run();
  expect(mock.dispatch).toHaveBeenCalledTimes(25); expect(mock.log).toHaveBeenCalledTimes(25);
});
it('ends an empty dispatch batch and sanitizes failures', async () => {
  await dispatch().run(); expect(mock.dispatch).toHaveBeenCalledOnce();
  mock.dispatch.mockRejectedValue(new Error('secret'));
  await expect(dispatch().run()).rejects.toThrow('Generation dispatch failed');
  expect(mock.close).toHaveBeenCalledTimes(2);
});
it('paginates and reconciles failed, canceled and provider-only completed runs', async () => {
  mock.activeRuns.mockResolvedValueOnce(['a','b','c','d','e'].map(jobId => ({ jobId, runId: jobId, status: jobId === 'd' ? 'cancel_requested' : 'running' }))).mockResolvedValueOnce([]);
  for (const status of ['FAILED','CANCELED','COMPLETED','EXECUTING','EXECUTING']) mock.retrieve.mockResolvedValueOnce({ status, isCompleted: !['EXECUTING'].includes(status) });
  await reconcile().run();
  expect(mock.reconcile.mock.calls).toEqual([['a','a','failed'],['b','b','canceled'],['c','c','failed']]);
  expect(mock.cancel).toHaveBeenCalledWith('d');
  expect(mock.activeRuns.mock.calls).toEqual([[null],['e']]);
});
it('continues past an unavailable run so later jobs are not starved', async () => {
  mock.activeRuns.mockResolvedValueOnce([{ jobId: 'a', runId: 'missing', status: 'running' }, { jobId: 'b', runId: 'valid', status: 'running' }]).mockResolvedValueOnce([]);
  mock.retrieve.mockRejectedValueOnce(new Error('secret')).mockResolvedValueOnce({ status: 'FAILED', isCompleted: true });
  await reconcile().run();
  expect(mock.reconcile).toHaveBeenCalledWith('b','valid','failed');
  expect(mock.log).toHaveBeenCalledWith('workflow.reconciliation_failed', { jobId: 'a', runId: 'missing' });
});
it('retries database listing failure and closes its connection pool', async () => {
  mock.activeRuns.mockRejectedValue(new Error('secret'));
  await expect(reconcile().run()).rejects.toThrow('Generation reconciliation failed');
  expect(mock.close).toHaveBeenCalledOnce();
});

it('forwards provider cancellation signal into the completion boundary', async () => {
  const controller = new AbortController();
  await build().run(input.payload, { ctx: input.ctx, signal: controller.signal });
  expect(mock.execute.mock.calls[0][5]).toBe(controller.signal);
});
