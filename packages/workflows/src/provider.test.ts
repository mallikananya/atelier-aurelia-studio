import { beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ create: vi.fn(), trigger: vi.fn() }));
vi.mock('@trigger.dev/sdk', () => ({ idempotencyKeys: { create: sdk.create }, tasks: { trigger: sdk.trigger } }));
import { triggerDispatcher } from './provider.ts';
beforeEach(() => { vi.clearAllMocks(); sdk.create.mockResolvedValue('global-key'); sdk.trigger.mockResolvedValue({ id: 'run_1' }); });
it('dispatches only the persisted job ID with a global stable idempotency key', async () => {
  const input = { jobId: 'job-1', accountId: 'account', productId: 'product', revisionId: 'revision' };
  expect(await triggerDispatcher.dispatchTestBuild(input)).toEqual({ providerRunId: 'run_1' });
  await triggerDispatcher.dispatchTestBuild(input);
  expect(sdk.create).toHaveBeenNthCalledWith(2, 'phase1:job-1', { scope: 'global' });
  expect(sdk.trigger).toHaveBeenCalledWith('atelier-phase1-test-build', { jobId: 'job-1' }, {
    idempotencyKey: 'global-key', idempotencyKeyTTL: '30d', tags: ['job:job-1'],
  });
});
it('propagates acceptance uncertainty to database lease recovery', async () => {
  sdk.trigger.mockRejectedValue(new Error('network'));
  await expect(triggerDispatcher.dispatchTestBuild({ jobId: 'a', accountId: 'b', productId: 'c', revisionId: 'd' })).rejects.toThrow('network');
});
