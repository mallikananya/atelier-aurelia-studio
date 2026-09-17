import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const appURL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000';
const supabaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const mailURL = 'http://127.0.0.1:54324';
const ownerEmail = 'milestone5-owner@example.test';
const nonmemberEmail = 'milestone5-nonmember@example.test';

function requireLocal(url: string) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
    throw new Error('Auth E2E fixtures may only run against local services');
  }
}
requireLocal(appURL);
requireLocal(supabaseURL);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for local E2E provisioning');
const admin = createClient(supabaseURL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function confirmation(email: string, next = '/studio') {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`Local link provisioning failed: ${error.code}`);
  return `/auth/confirm?${new URLSearchParams({
    token_hash: data.properties.hashed_token, type: 'email', next,
  })}`;
}

async function enter(page: Page, email = ownerEmail, next = '/studio') {
  await page.goto(await confirmation(email, next));
  await page.getByRole('button', { name: /continue to studio/i }).click();
}

async function mailboxLink(email: string, previous: Set<string>) {
  let link: string | undefined;
  await expect.poll(async () => {
    const response = await fetch(`${mailURL}/api/v1/messages`);
    if (!response.ok) throw new Error('Local Mailpit API is unavailable');
    const inbox = await response.json();
    const messages = inbox.messages.filter((message: { ID: string; To: { Address: string }[] }) =>
      !previous.has(message.ID) && message.To.some((recipient) => recipient.Address === email));
    for (const message of messages) {
      const detail = await (await fetch(`${mailURL}/api/v1/message/${message.ID}`)).json();
      const body = `${detail.HTML ?? ''} ${detail.Text ?? ''}`.replaceAll('&amp;', '&');
      link = body.match(/https?:\/\/[^\s"<>]+\/auth\/confirm\?[^\s"<>]+/)?.[0];
      if (link) break;
    }
    return Boolean(link);
  }, { timeout: 20_000, message: 'A local confirmation email is delivered' }).toBe(true);
  const parsed = new URL(link!);
  expect(parsed.origin).toBe(appURL);
  return `${parsed.pathname}${parsed.search}`;
}

async function messageIDs() {
  const response = await fetch(`${mailURL}/api/v1/messages`);
  if (!response.ok) throw new Error('Start the local Supabase email service before E2E tests');
  const inbox = await response.json();
  return new Set<string>(inbox.messages.map((message: { ID: string }) => message.ID));
}

test.describe.serial('Invite-only owner authentication against local Supabase', () => {
  let invitation: string | undefined;
  let invitationCreatedAt: number | undefined;

  test.beforeAll(async () => {
    const { data: memberships, error } = await admin.from('account_memberships')
      .select('user_id').eq('role', 'owner');
    if (error) throw new Error('Cannot inspect local owner fixture');
    if (memberships.length) {
      if (memberships.length !== 1) throw new Error('E2E requires exactly one local owner');
      const existing = await admin.auth.admin.getUserById(memberships[0].user_id);
      if (existing.data.user?.email !== ownerEmail) {
        throw new Error('Existing local owner is not the E2E fixture; refusing to modify user data');
      }
    } else {
      const before = await messageIDs();
      const invite = await admin.auth.admin.inviteUserByEmail(ownerEmail);
      if (invite.error) throw new Error(`Local invitation failed: ${invite.error.code}`);
      invitationCreatedAt = Date.now();
      invitation = await mailboxLink(ownerEmail, before);
    }
    const users = await admin.auth.admin.listUsers();
    if (users.error) throw new Error('Cannot inspect local user fixtures');
    if (!users.data.users.some((user) => user.email === nonmemberEmail)) {
      const result = await admin.auth.admin.createUser({ email: nonmemberEmail, email_confirm: true });
      if (result.error) throw new Error(`Nonmember fixture failed: ${result.error.code}`);
    }
  });

  test('anonymous users cannot open protected routes', async ({ page }) => {
    for (const route of ['/studio', '/products', '/settings']) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login\?/);
      expect(new URL(page.url()).searchParams.get('next')).toBe(route);
    }
  });

  test('an accepted invitation can request a later owner magic link', async ({ page, context }) => {
    test.setTimeout(90_000);
    if (invitation) {
      await page.goto(invitation);
      await page.getByRole('button', { name: /continue to studio/i }).click();
      await expect(page).toHaveURL(`${appURL}/studio`);
      await context.clearCookies();
    }
    if (invitationCreatedAt) {
      const remainingCooldown = 61_000 - (Date.now() - invitationCreatedAt);
      if (remainingCooldown > 0) await new Promise((resolve) => setTimeout(resolve, remainingCooldown));
    }
    const before = await messageIDs();
    await page.goto('/login?next=/products');
    await page.getByLabel(/email/i).fill(ownerEmail);
    await page.getByRole('button', { name: /send/i }).click();
    await expect(page).toHaveURL(/\/login\?status=sent/);
    await page.goto(await mailboxLink(ownerEmail, before));
    await page.getByRole('button', { name: /continue to studio/i }).click();
    await expect(page).toHaveURL(`${appURL}/products`);
    await page.reload();
    await expect(page).toHaveURL(`${appURL}/products`);
  });

  test('owner confirmation requires a human POST; replay fails; cookies are private', async ({ page, context }) => {
    const link = await confirmation(ownerEmail);
    await page.goto(link);
    await expect(page.getByRole('button', { name: /continue to studio/i })).toBeVisible();
    expect((await context.cookies()).filter((cookie) => cookie.name.includes('auth-token'))).toHaveLength(0);
    await page.reload();
    await page.getByRole('button', { name: /continue to studio/i }).click();
    await expect(page).toHaveURL(`${appURL}/studio`);
    const sessionCookies = (await context.cookies()).filter((cookie) => cookie.name.includes('auth-token'));
    expect(sessionCookies.length).toBeGreaterThan(0);
    expect(sessionCookies.every((cookie) => cookie.httpOnly && cookie.sameSite === 'Lax')).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain('auth-token');
    await context.clearCookies();
    await page.goto(link);
    await page.getByRole('button', { name: /continue to studio/i }).click();
    await expect(page).toHaveURL(/\/login\?status=expired/);
  });

  test('unknown addresses get the same response and cannot self-register', async ({ request }) => {
    const email = `milestone5-unknown-${Date.now()}@example.test`;
    const response = await request.post('/auth/login', {
      headers: { origin: appURL }, form: { email, next: '/studio' }, maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toContain('/login?status=sent');
    const users = await admin.auth.admin.listUsers();
    expect(users.data.users.some((user) => user.email === email)).toBe(false);
  });

  test('a valid nonmember session is denied', async ({ page }) => {
    await enter(page, nonmemberEmail);
    await expect(page).toHaveURL(`${appURL}/access-denied`);
    await page.goto('/settings');
    await expect(page).toHaveURL(`${appURL}/access-denied`);
  });

  test('external redirect input stays on the Studio origin', async ({ page }) => {
    await enter(page, ownerEmail, 'https://attacker.example/steal');
    await expect(page).toHaveURL(`${appURL}/studio`);
  });

  test('logout rejects cross-origin requests and clears a real owner session', async ({ page, request }) => {
    await enter(page);
    await expect(page).toHaveURL(`${appURL}/studio`);
    const rejected = await request.post('/auth/logout', { headers: { origin: 'https://attacker.example' } });
    expect(rejected.status()).toBe(403);
    await page.getByRole('button', { name: /sign out|log out/i }).click();
    await expect(page).toHaveURL(/\/login\?status=signed-out/);
    await page.goto('/studio');
    await expect(page).toHaveURL(/\/login\?/);
  });

  test('malformed session cookies fail closed', async ({ page, context }) => {
    await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-invalid', url: appURL }]);
    await page.goto('/studio');
    await expect(page).toHaveURL(/\/login\?/);
  });

  test('invalid confirmations and cross-origin login are rejected', async ({ page, request }) => {
    await page.goto('/auth/confirm?token_hash=invalid&type=recovery&next=/studio');
    await expect(page).toHaveURL(/\/login\?status=expired/);
    const response = await request.post('/auth/login', {
      headers: { origin: 'https://attacker.example' }, form: { email: ownerEmail },
    });
    expect(response.status()).toBe(403);
  });
});
