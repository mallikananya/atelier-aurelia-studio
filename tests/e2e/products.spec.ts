import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const appURL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000';
const supabaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ownerEmail = 'milestone5-owner@example.test';
const nonmemberEmail = 'milestone5-nonmember@example.test';
const otherEmail = 'milestone6-other-account@example.test';
for (const url of [appURL, supabaseURL]) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
    throw new Error('Products E2E fixtures may only run against local services');
  }
}
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!serviceKey || !publicKey) throw new Error('Local Supabase fixture and public keys are required');
const admin = createClient(supabaseURL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function link(email: string) {
  const result = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (result.error) throw new Error(`Local fixture link failed: ${result.error.code}`);
  return result.data.properties.hashed_token;
}

async function enter(page: Page, email = ownerEmail) {
  await page.goto(`/auth/confirm?${new URLSearchParams({
    token_hash: await link(email), type: 'email', next: '/products',
  })}`);
  await page.getByRole('button', { name: /continue to studio/i }).click();
}

async function session(email: string) {
  const client = createClient(supabaseURL, publicKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({ token_hash: await link(email), type: 'email' });
  if (verified.error) throw new Error('Local fixture session failed');
  return client;
}

test.describe.serial('Persisted owner Products against local Supabase', () => {
  let productId: string;
  let revisionId: string;

  test.beforeAll(async () => {
    const memberships = await admin.from('account_memberships').select('user_id').eq('role', 'owner');
    if (memberships.error) throw new Error('Cannot inspect local owner fixture');
    if (memberships.data.length) {
      if (memberships.data.length !== 1) throw new Error('E2E requires exactly one local owner');
      const existing = await admin.auth.admin.getUserById(memberships.data[0].user_id);
      if (existing.error || existing.data.user?.email !== ownerEmail) {
        throw new Error('Existing local owner is not the E2E fixture; refusing to modify user data');
      }
    } else {
      const invitation = await admin.auth.admin.inviteUserByEmail(ownerEmail);
      if (invitation.error) throw new Error(`Local invitation failed: ${invitation.error.code}`);
    }
    const users = await admin.auth.admin.listUsers();
    if (users.error) throw new Error('Cannot inspect local user fixtures');
    if (!users.data.users.some((user) => user.email === nonmemberEmail)) {
      const created = await admin.auth.admin.createUser({ email: nonmemberEmail, email_confirm: true });
      if (created.error) throw new Error(`Nonmember fixture failed: ${created.error.code}`);
    }
  });

  test('an empty account has a useful Products view without example products', async ({ page }) => {
    const owner = await session(ownerEmail);
    const existing = await owner.from('products').select('id');
    expect(existing.error).toBeNull();
    expect(existing.data, 'Run db:reset before the full acceptance suite; fixtures are never deleted').toEqual([]);
    await enter(page);
    await expect(page).toHaveURL(`${appURL}/products`);
    await expect(page.getByText(/no products yet/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Soft Discipline' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sunday Reset' })).toHaveCount(0);
    await expect(page.getByLabel('Product name')).toBeVisible();
  });

  test('create submits once while pending and persists exactly one immutable Revision 1', async ({ page }) => {
    await enter(page);
    await expect(page).toHaveURL(`${appURL}/products`);
    await page.getByLabel('Product name').fill('Soft Discipline');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let submissions = 0;
    await page.route('**/products', async (route) => {
      if (route.request().method() === 'POST') {
        submissions += 1;
        await gate;
      }
      await route.continue();
    });
    const button = page.getByRole('button', { name: /create product/i });
    await button.click();
    try {
      await expect.poll(() => submissions).toBe(1);
      await expect(page.locator('button[type="submit"]').filter({ hasText: /creat/i })).toBeDisabled();
      await page.locator('button[type="submit"]').filter({ hasText: /creat/i })
        .evaluate((element: HTMLButtonElement) => element.click());
      expect(submissions).toBe(1);
    } finally {
      release();
    }
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
    productId = new URL(page.url()).pathname.split('/').at(-1)!;
    await expect(page.getByRole('heading', { name: 'Soft Discipline' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Revision 1' })).toBeVisible();
    const owner = await session(ownerEmail);
    const products = await owner.from('products').select('id,current_revision_id,created_by').eq('name', 'Soft Discipline');
    expect(products.error).toBeNull();
    expect(products.data).toHaveLength(1);
    expect(products.data![0].id).toBe(productId);
    const revisions = await owner.from('product_revisions')
      .select('id,revision_number,parent_revision_id,schema_version,created_by').eq('product_id', productId);
    expect(revisions.error).toBeNull();
    expect(revisions.data).toHaveLength(1);
    const revision = revisions.data![0];
    revisionId = revision.id;
    expect(revision).toMatchObject({ revision_number: 1, parent_revision_id: null, schema_version: 'phase1.1' });
    expect(products.data![0].current_revision_id).toBe(revisionId);
    expect(revision.created_by).toBe(products.data![0].created_by);
    await expect(page.getByText(revisionId, { exact: true })).toBeVisible();
  });

  test('reload and library reopening retain the same persisted identity', async ({ page }) => {
    await enter(page);
    await expect(page).toHaveURL(`${appURL}/products`);
    await page.getByRole('link', { name: /Soft Discipline/i }).click();
    await expect(page).toHaveURL(`${appURL}/products/${productId}`);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Revision 1' })).toBeVisible();
    await expect(page.getByText(revisionId, { exact: true })).toBeVisible();
  });

  test('malformed and nonexistent product IDs fail safely', async ({ page }) => {
    await enter(page);
    await expect(page).toHaveURL(`${appURL}/products`);
    for (const id of ['invalid-product-id', '00000000-0000-4000-8000-000000000001']) {
      await page.goto(`/products/${id}`);
      await expect(page.getByRole('heading', { name: /404|not found/i }).first()).toBeVisible();
      await expect(page.getByText(revisionId, { exact: true })).toHaveCount(0);
    }
  });

  test('nonmembers cannot view Products or invoke its creation command', async ({ page }) => {
    await enter(page, nonmemberEmail);
    await expect(page).toHaveURL(`${appURL}/access-denied`);
    await page.goto(`/products/${productId}`);
    await expect(page).toHaveURL(`${appURL}/access-denied`);
    const nonmember = await session(nonmemberEmail);
    const created = await nonmember.rpc('create_product_with_revision', { p_name: 'Forbidden product' });
    expect(created.error?.code).toBe('42501');
    const rows = await nonmember.from('products').select('id');
    expect(rows.error).toBeNull();
    expect(rows.data).toEqual([]);
  });

  test('another account product is absent from the library and indistinguishable from missing', async ({ page }) => {
    const users = await admin.auth.admin.listUsers();
    if (users.error) throw new Error('Cannot inspect local fixture users');
    let other = users.data.users.find((user) => user.email === otherEmail);
    if (!other) {
      const created = await admin.auth.admin.createUser({ email: otherEmail, email_confirm: true });
      if (created.error || !created.data.user) throw new Error('Cannot provision other-account fixture');
      other = created.data.user;
    }
    const membership = await admin.from('account_memberships').select('account_id').eq('user_id', other.id);
    if (membership.error) throw new Error('Cannot inspect local fixture membership');
    if (!membership.data.length) {
      const account = await admin.from('accounts').insert({ name: 'Other acceptance account', created_by: other.id }).select('id').single();
      if (account.error) throw new Error('Cannot provision local fixture account');
      const added = await admin.from('account_memberships').insert({ account_id: account.data.id, user_id: other.id, role: 'member' });
      if (added.error) throw new Error('Cannot provision local fixture membership');
    }
    const otherSession = await session(otherEmail);
    const created = await otherSession.rpc('create_product_with_revision', { p_name: 'Private other-account product' });
    expect(created.error).toBeNull();
    const otherProductId = created.data[0].product_id;
    await enter(page);
    await expect(page).toHaveURL(`${appURL}/products`);
    await expect(page.getByText('Private other-account product', { exact: true })).toHaveCount(0);
    await page.goto(`/products/${otherProductId}`);
    await expect(page.getByRole('heading', { name: /404|not found/i }).first()).toBeVisible();
    await expect(page.getByText('Private other-account product', { exact: true })).toHaveCount(0);
    const hidden = await otherSession.from('products').select('id').eq('id', productId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  });
});
