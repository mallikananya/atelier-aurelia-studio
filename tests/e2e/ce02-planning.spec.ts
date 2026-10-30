import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { readingPlan } from '../../packages/ai/src/fixtures/planning';
import { planProduct } from '../../packages/ai/src/planning';
import { fixtureSession, fixtureToken } from '../fixtures/storage';
import { provisionPlanningOwner } from '../fixtures/planning';

test.skip(process.env.CE02_BROWSER_TEST !== '1', 'Run with playwright.ce02.config.mts and its isolated local provider.');

// This suite uses its own local HTTP provider and never calls a paid service.
let provider: Server;
let ownerEmail: string;
test.beforeAll(async () => {
  ownerEmail = await provisionPlanningOwner();
  provider = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const { idea } = JSON.parse(body) as { idea: string };
    response.setHeader('content-type', 'application/json');
    if (idea.includes('fixture-provider-failure')) {
      response.writeHead(500).end(JSON.stringify({ error: 'private provider detail' }));
    } else if (idea.includes('fixture-provider-unavailable')) {
      response.writeHead(503).end(JSON.stringify({ error: 'private service detail' }));
    } else if (idea.includes('fixture-invalid-output')) {
      response.end(JSON.stringify({ schemaVersion: 'invalid-provider-output' }));
    } else {
      response.end(JSON.stringify(readingPlan));
    }
  });
  await new Promise<void>((resolve, reject) => {
    provider.once('error', reject);
    provider.listen(3103, '127.0.0.1', resolve);
  });
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => provider?.close(error => error ? reject(error) : resolve()));
});

async function enter(page: Page) {
  await page.goto(`/auth/confirm?${new URLSearchParams({ token_hash: await fixtureToken(ownerEmail), type: 'email', next: '/products' })}`);
  await page.getByRole('button', { name: /continue to studio/i }).click();
  await expect(page).toHaveURL(/\/products$/);
}
async function product(page: Page) {
  const owner = await fixtureSession(ownerEmail);
  const created = await owner.rpc('create_product_with_revision', { p_name: 'CE02 browser acceptance' });
  expect(created.error).toBeNull();
  const productId = created.data[0].product_id as string;
  await enter(page);
  await page.goto(`/products/${productId}`);
  return { owner, productId };
}

async function revisions(owner: Awaited<ReturnType<typeof fixtureSession>>, productId: string) {
  const result = await owner.from('product_revisions').select('id,parent_revision_id,revision_number,content').eq('product_id', productId).order('revision_number');
  expect(result.error).toBeNull();
  return result.data!;
}

test('anonymous planning page access requires authentication', async ({ page }) => {
  await page.goto('/studio');
  await expect(page).toHaveURL(/\/login\?/);
});

test('planning persists inspectable immutable revisions and rejects a stale form', async ({ page, context }) => {
  const { owner, productId } = await product(page);
  await page.getByLabel('Product planning idea').fill('Create a botanical reading journal.');
  await page.getByRole('button', { name: 'Generate planning revision', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved');
  await expect(page.getByRole('heading', { name: /^Pages \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deliverables', exact: true })).toBeVisible();
  await expect(page.getByText('reading-response', { exact: true }).first()).toBeVisible();
  const first = await revisions(owner, productId);
  expect(first).toHaveLength(2);
  expect(first[1].content.revisionId).toBe(first[1].id);
  expect(first[1].content.parentRevisionId).toBe(first[0].id);
  const stale = await context.newPage();
  await stale.goto(`/products/${productId}`);
  await page.getByLabel('Product planning idea').fill('Refine the same botanical reading journal.');
  await page.getByRole('button', { name: 'Generate planning revision', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved');
  await expect.poll(async () => (await revisions(owner, productId)).length).toBe(3);
  const second = await revisions(owner, productId);
  expect(second).toHaveLength(3);
  expect(second.slice(0, 2)).toEqual(first);
  expect(second[2].content.provenance.retainedPageIds).toEqual(first[1].content.plan.manifest.pages.map((item: { id: string }) => item.id));
  expect(second[2].content.parentRevisionId).toBe(first[1].id);
  await stale.getByLabel('Product planning idea').fill('Attempt a stale botanical revision.');
  await stale.getByRole('button', { name: 'Generate planning revision', exact: true }).click();
  await expect(stale.getByRole('status')).toContainText('newer revision');
  expect(await revisions(owner, productId)).toEqual(second);
  await page.reload();
  await expect(page.getByRole('heading', { name: /revision history/i })).toBeVisible();
  await expect(page.getByText('Les Heures Fleuries', { exact: true }).first()).toBeVisible();
  await stale.close();
});

test('provider failures and invalid plans are distinct and never persist revisions', async ({ page }) => {
  const { owner, productId } = await product(page);
  const before = await revisions(owner, productId);
  await page.getByLabel('Product planning idea').fill('fixture-provider-failure');
  await page.getByRole('button', { name: 'Generate planning revision', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Generation failed');
  await expect(page.getByRole('status')).not.toContainText('private provider detail');
  await page.getByLabel('Product planning idea').fill('fixture-invalid-output');
  await page.getByRole('button', { name: 'Generate planning revision', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('failed validation');
  await page.getByLabel('Product planning idea').fill('fixture-provider-unavailable');
  await page.getByRole('button', { name: 'Generate planning revision', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('provider is unavailable');
  expect(await revisions(owner, productId)).toEqual(before);
});

test('Studio composer saves a plan for the selected existing product', async ({ page }) => {
  const { owner, productId } = await product(page);
  await page.goto(`/studio?productId=${productId}`);
  await page.getByLabel('Product planning idea').fill('A reading journal from the Studio composer.');
  await page.getByRole('button', { name: 'Generate planning revision', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved');
  await expect(page.getByRole('heading', { name: /^Pages \(\d+\)$/ })).toBeVisible();
  expect(await revisions(owner, productId)).toHaveLength(2);
});

test('authenticated clients cannot bypass planning validation through the public revision RPC', async () => {
  const owner = await fixtureSession(ownerEmail);
  const created = await owner.rpc('create_product_with_revision', { p_name: 'CE021 direct RPC bypass' });
  expect(created.error).toBeNull();
  const { product_id: productId, revision_id: revisionId } = created.data[0];
  const result = await planProduct({ generate: async () => JSON.stringify(readingPlan) }, {
    productId, revisionId: randomUUID(), parentRevisionId: revisionId, revisionNumber: 2,
    idea: 'A reading journal', createdAt: new Date().toISOString(), promptVersion: 'fixture/1',
    generator: { id: 'browser-fixture', version: '1' }, sources: [], retainedPageIds: [],
  });
  if (!result.ok) throw new Error('Invalid planning fixture');
  const before = await revisions(owner, productId);
  for (const envelope of [result.envelope, { ...result.envelope, plan: {} }]) {
    const rejected = await owner.rpc('append_product_revision', {
      p_product_id: productId, p_expected_current_revision_id: revisionId,
      p_name: 'CE021 direct RPC bypass', p_product_type: null, p_content: envelope,
    });
    expect(rejected.error?.code).toBe('22023');
    expect(await revisions(owner, productId)).toEqual(before);
  }
  const audit = await owner.from('audit_events').select('id').eq('product_id', productId).eq('action', 'product.revision_created');
  expect(audit.error).toBeNull();
  expect(audit.data).toHaveLength(0);
});
