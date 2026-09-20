import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { test, expect, type Page } from '@playwright/test';
import { completeArtifactFixture, fixtureBytes, fixtureToken, ownerEmail, nonmemberEmail, otherEmail, provisionOtherOwnerFixture } from '../fixtures/storage';

async function enter(page: Page, email: string) {
  await page.goto(`/auth/confirm?${new URLSearchParams({ token_hash: await fixtureToken(email), type: 'email', next: '/products' })}`);
  await page.getByRole('button', { name: /continue to studio/i }).click();
  await expect(page).toHaveURL(/\/(products|access-denied)$/);
}

test.describe.serial('Private immutable storage acceptance', () => {
  let fixture: Awaited<ReturnType<typeof completeArtifactFixture>>;
  test.beforeAll(async () => { fixture = await completeArtifactFixture(); await provisionOtherOwnerFixture(); });

  test('owner downloads exact verified bytes from the persisted revision', async ({ page }) => {
    await enter(page, ownerEmail);
    await page.goto(`/products/${fixture.productId}`);
    const link = page.getByRole('link', { name: /download artifact/i });
    await expect(link).toHaveAttribute('href', `/artifacts/${fixture.artifactId}/download`);
    const downloadEvent = page.waitForEvent('download');
    await link.click();
    const browserDownload = await downloadEvent;
    expect(await buffer(await browserDownload.createReadStream())).toEqual(Buffer.from(fixtureBytes));
    const response = await page.request.get(`/artifacts/${fixture.artifactId}/download`, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    const location = response.headers().location;
    // Do not include capability URLs in assertion output.
    const url = new URL(location);
    expect(Boolean(url.searchParams.get('versionId'))).toBe(true);
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(300);
    const downloaded = await fetch(location);
    expect(downloaded.status).toBe(200);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(fixtureBytes);
    const unsigned = new URL(location); unsigned.search = '';
    expect((await fetch(unsigned)).status).toBe(403);
    const metadata = await fixture.owner.from('artifacts').select('state,size_bytes,storage_version_id,account_id,product_id,revision_id,job_id,role,sha256,media_type').eq('id', fixture.artifactId).single();
    expect(metadata.error).toBeNull();
    expect(metadata.data).toMatchObject({ state: 'available', account_id: fixture.accountId,
      product_id: fixture.productId, revision_id: fixture.revisionId, job_id: fixture.jobId,
      role: 'phase1-test-build', sha256: createHash('sha256').update(fixtureBytes).digest('hex'), media_type: 'text/plain' });
    expect(metadata.data?.size_bytes).toBe(fixtureBytes.byteLength);
    expect(Boolean(metadata.data?.storage_version_id)).toBe(true);
  });

  test('anonymous access cannot obtain an object capability', async ({ request }) => {
    const result = await request.get(`/artifacts/${fixture.artifactId}/download`, { maxRedirects: 0 });
    expect(result.status()).toBe(404);
    expect(result.headers().location).toBeUndefined();
  });

  for (const [name, email] of [['nonmember', nonmemberEmail], ['cross-account member', otherEmail], ['cross-account owner', 'milestone7-other-owner@example.test']]) {
    test(`${name} cannot obtain an artifact capability`, async ({ page }) => {
      await enter(page, email);
      const hidden = await page.request.get(`/artifacts/${fixture.artifactId}/download`, { maxRedirects: 0 });
      const missing = await page.request.get('/artifacts/00000000-0000-4000-8000-000000000009/download', { maxRedirects: 0 });
      expect(hidden.status()).toBe(404);
      expect(await hidden.text()).toBe(await missing.text());
      expect(hidden.headers().location).toBeUndefined();
    });
  }

  test('malformed and nonexistent IDs and arbitrary key injection cannot mint capabilities', async ({ page }) => {
    await enter(page, ownerEmail);
    for (const id of ['invalid-artifact', '00000000-0000-4000-8000-000000000009']) {
      const response = await page.request.get(`/artifacts/${id}/download?bucket=other&key=../../secret`, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
      expect(response.headers().location).toBeUndefined();
    }
    const injected = await page.request.get(`/artifacts/${fixture.artifactId}/download?bucket=other&key=../../secret`, { maxRedirects: 0 });
    // Extra query input cannot change the database-resolved object identity.
    expect(injected.status()).toBe(302);
    const downloaded = await fetch(injected.headers().location);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(fixtureBytes);
  });
});
