import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, expect, it } from 'vitest';
import { processLocalCycle } from '../../packages/workflows/src/local-runner';
import { validatePlanner } from '../../packages/workflows/src/planner';
import { createS3BlobStore, objectStorageConfigFromEnvironment } from '../../packages/storage/src/index';
import { artifactDownload } from '../../apps/studio/src/lib/products/downloads';
import { fixtureSession, ownerEmail, nonmemberEmail, provisionOtherOwnerFixture } from '../fixtures/storage';
import { localWorker } from '../fixtures/workflows';

const config = objectStorageConfigFromEnvironment(process.env);
if (!config.endpoint || !['localhost', '127.0.0.1'].includes(new URL(config.endpoint).hostname)) throw new Error('Local MinIO required');
const store = createS3BlobStore(config);
const worker = localWorker();
afterAll(() => worker.close());

it('generates, persists, retrieves and isolates the first planner through the local runner', async () => {
  const owner = await fixtureSession(ownerEmail);
  const created = await owner.rpc('create_product_with_revision', { p_name: 'Atelier Aurelia - Undated Weekly Planner', p_product_type: 'Undated weekly planner' });
  expect(created.error).toBeNull();
  const { product_id: productId, revision_id: revisionId } = created.data[0];
  const args = { p_product_id: productId, p_revision_id: revisionId, p_idempotency_key: `planner-v1:${revisionId}` };
  const proofArgs = { ...args, p_idempotency_key: `proof-collision:${revisionId}` };
  expect((await owner.rpc('enqueue_phase1_test_build', proofArgs)).error).toBeNull();
  expect((await owner.rpc('enqueue_planner_build', proofArgs)).error?.code).toBe('23505');
  const queued = await owner.rpc('enqueue_planner_build', args);
  expect(queued.error).toBeNull();
  const jobId = queued.data[0].job_id;
  expect((await owner.rpc('enqueue_phase1_test_build', args)).error?.code).toBe('23505');
  const duplicate = await owner.rpc('enqueue_planner_build', args);
  expect(duplicate.data[0]).toMatchObject({ job_id: jobId, was_created: false });
  // Bounded polling tolerates other already queued local work without deleting it.
  for (let i = 0; i < 20; i++) {
    await processLocalCycle(worker.repository, store, config.bucket, { maxAttempts: 3, retryBackoffMs: 50 });
    const job = await owner.from('jobs').select('status').eq('id', jobId).single();
    if (job.data?.status === 'succeeded') break;
  }
  const artifact = await owner.from('artifacts').select('*').eq('job_id', jobId).single();
  expect(artifact.error).toBeNull();
  expect(artifact.data).toMatchObject({ role: 'planner-pdf', media_type: 'application/pdf', state: 'available' });
  const getStorage = () => ({ ...config, expiresInSeconds: 60, createSignedDownload: store.createSignedDownload.bind(store) });
  const download = await artifactDownload(owner, artifact.data.id, getStorage);
  expect(download.kind).toBe('ok');
  if (download.kind !== 'ok') throw new Error('Missing authorized download');
  const response = await fetch(download.url);
  expect(response.ok).toBe(true);
  expect(response.headers.get('content-type')).toBe('application/pdf');
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect((await validatePlanner(bytes)).pageCount).toBe(146);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.data.sha256);
  expect(bytes.length).toBe(artifact.data.size_bytes);
  for (const email of [nonmemberEmail, await provisionOtherOwnerFixture()]) {
    const outsider = await fixtureSession(email);
    expect((await outsider.rpc('enqueue_planner_build', args)).error).not.toBeNull();
    expect((await artifactDownload(outsider, artifact.data.id, getStorage)).kind).toBe('missing');
  }
  // Preserve this real, verified download as a convenient local visual-review artifact.
  await mkdir('output/pdf', { recursive: true });
  await writeFile('output/pdf/atelier-aurelia-undated-weekly.pdf', bytes);
  await writeFile('output/pdf/local-planner.json', JSON.stringify({ productId, revisionId, jobId,
    artifactId: artifact.data.id, sha256: artifact.data.sha256, pageCount: 146 }, null, 2));
});
