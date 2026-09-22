import { buffer } from 'node:stream/consumers';
import { test, expect } from '@playwright/test';
import { fixtureSession, fixtureToken, ownerEmail } from '../fixtures/storage';
import { localWorker, localDispatch } from '../fixtures/workflows';
import { executeBuild } from '../../packages/workflows/src/execution';
import { createS3BlobStore, objectStorageConfigFromEnvironment } from '../../packages/storage/src/index';

test('owner requests durable build and downloads its verified persisted output', async ({ page }) => {
  const owner = await fixtureSession(ownerEmail);
  const created = await owner.rpc('create_product_with_revision', { p_name: 'Workflow browser acceptance' });
  expect(created.error).toBeNull();
  const { product_id: productId, revision_id: revisionId } = created.data[0];
  await page.goto(`/auth/confirm?${new URLSearchParams({ token_hash: await fixtureToken(ownerEmail), type: 'email', next: '/products' })}`);
  await page.getByRole('button', { name: /continue to studio/i }).click();
  await expect(page).toHaveURL(/\/products$/);
  await page.goto(`/products/${productId}`);
  await page.getByRole('button', { name: 'Run test build' }).click();
  await expect(page.getByRole('status')).toContainText('Test build requested');
  await page.getByRole('button', { name: 'Run test build' }).click();
  await expect(page.getByRole('status')).toContainText('Test build requested');
  const jobs = await owner.from('jobs').select('id,status').eq('product_id', productId);
  expect(jobs.error).toBeNull(); expect(jobs.data).toHaveLength(1);
  const jobId = jobs.data![0].id as string;
  const worker = localWorker();
  try {
    const runId = await localDispatch(worker, jobId);
    const config = objectStorageConfigFromEnvironment(process.env);
    if (!config.endpoint || !['localhost', '127.0.0.1'].includes(new URL(config.endpoint).hostname)) throw new Error('Browser workflow fixture requires local MinIO');
    await executeBuild(worker.repository, createS3BlobStore(config), config.bucket, { jobId, runId, attemptNumber: 1 });
    await page.getByRole('link', { name: 'Refresh build status' }).click();
    await expect(page.getByText('succeeded', { exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: /download artifact/i }).click();
    const bytes = await buffer(await (await download).createReadStream());
    expect(JSON.parse(bytes.toString())).toMatchObject({ kind: 'phase1-test-build', jobId, productId, revisionId });
  } finally { await worker.close(); }
});
