import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function text(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("root scripts expose local infrastructure and Phase 1 validation", async () => {
  const packageJson = JSON.parse(await text("package.json"));

  for (const script of [
    "infra:start",
    "infra:stop",
    "db:start",
    "db:reset",
    "db:test",
    "test:e2e",
  ]) {
    assert.equal(typeof packageJson.scripts[script], "string", `missing npm script ${script}`);
  }

  assert.equal(packageJson.devDependencies.vitest !== undefined, true);
  assert.equal(packageJson.devDependencies["@playwright/test"] !== undefined, true);
  assert.equal(packageJson.devDependencies.supabase !== undefined, true);
});

test("local Supabase authentication is private and redirect-scoped", async () => {
  const config = await text("supabase/config.toml");
  const invite = await text("supabase/templates/invite.html");
  const magicLink = await text("supabase/templates/magic_link.html");

  assert.match(config, /site_url\s*=\s*"http:\/\/127\.0\.0\.1:3000"/);
  assert.match(config, /\[auth\][\s\S]*?enable_signup\s*=\s*false/);
  assert.match(config, /\[auth\.email\][\s\S]*?enable_signup\s*=\s*true/);
  assert.match(config, /enable_anonymous_sign_ins\s*=\s*false/);
  assert.match(config, /additional_redirect_urls\s*=\s*\["http:\/\/127\.0\.0\.1:3000\/auth\/confirm"\]/);
  assert.match(config, /auth\.email\.template\.invite/);
  assert.match(config, /auth\.email\.template\.magic_link/);
  for (const template of [invite, magicLink]) {
    assert.match(template, /TokenHash/);
    assert.doesNotMatch(template, /ConfirmationURL/);
  }
});

test("local object storage enables private versioned MinIO objects", async () => {
  const compose = await text("infra/compose.yml");

  assert.match(compose, /minio\/minio:/);
  assert.match(compose, /mc version enable/);
  assert.match(compose, /mc anonymous set none/);
  assert.doesNotMatch(compose, /public-read/);
});

test("environment example separates public and server-only values", async () => {
  const environment = await text(".env.example");

  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DATABASE_URL",
    "OBJECT_STORAGE_BUCKET",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "TRIGGER_SECRET_KEY",
    "TRIGGER_PROJECT_REF",
  ]) {
    assert.match(environment, new RegExp(`^${name}=`, "m"), `missing ${name}`);
  }

  assert.doesNotMatch(environment, /^NEXT_PUBLIC_(?:DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|AWS_|TRIGGER_SECRET_KEY)/m);
});
