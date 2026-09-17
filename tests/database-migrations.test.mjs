import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationsDirectory = path.join(repositoryRoot, "supabase/migrations");

async function migrationSource() {
  const migrations = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  assert.deepEqual(migrations, [
    "202609140001_phase1_schema.sql",
    "202609140002_phase1_api.sql",
    "202609140003_phase1_security.sql",
  ]);
  return Promise.all(migrations.map((file) => readFile(path.join(migrationsDirectory, file), "utf8")))
    .then((sources) => sources.join("\n"));
}

test("Phase 1 migrations create only the approved durable entities", async () => {
  const source = await migrationSource();
  const requiredTables = [
    "users",
    "accounts",
    "account_memberships",
    "products",
    "product_revisions",
    "artifacts",
    "artifact_lineage",
    "jobs",
    "job_attempts",
    "job_events",
    "workflow_bindings",
    "workflow_outbox",
    "audit_events",
  ];

  for (const table of requiredTables) {
    assert.match(source, new RegExp(`create table public\\.${table}\\b`, "i"), `missing ${table}`);
  }

  assert.doesNotMatch(source, /create table public\.(?:conversations|pages|approvals|shops|secret_records)\b/i);
});

test("revisions and journals are append-only", async () => {
  const source = await migrationSource();

  for (const table of ["product_revisions", "job_attempts", "job_events", "audit_events"]) {
    assert.match(source, new RegExp(`append_only_${table}`, "i"), `missing append-only trigger for ${table}`);
  }

  assert.match(source, /unique\s*\(product_id, revision_number\)/i);
});

test("authenticated mutations use closed transactional functions", async () => {
  const source = await migrationSource();

  assert.match(source, /function public\.create_product_with_revision/i);
  assert.match(source, /function public\.append_product_revision/i);
  assert.match(source, /function public\.enqueue_phase1_test_build/i);
  assert.match(source, /revoke all on all tables in schema public from anon, authenticated/i);
  assert.doesNotMatch(source, /p_(?:payload|task_name|workflow_name)\b/i);
  assert.doesNotMatch(source, /workflow_outbox[\s\S]{0,500}\b(?:payload|message)\s+jsonb/i);
});

test("RLS uses account membership and keeps worker mutation private", async () => {
  const source = await migrationSource();

  assert.match(source, /enable row level security/gi);
  assert.match(source, /private\.is_account_member/i);
  assert.match(source, /create role atelier_worker noinherit nologin/i);
  assert.match(source, /grant execute on function private\.worker_/i);
  assert.doesNotMatch(source, /grant .*service_role/i);
});

test("database tests cover account isolation and immutable revisions", async () => {
  const pgTap = await readFile(
    path.join(repositoryRoot, "supabase/tests/database/phase1_schema.test.sql"),
    "utf8",
  );

  assert.match(pgTap, /row-level security isolates accounts/i);
  assert.match(pgTap, /prior revision cannot be updated/i);
  assert.match(pgTap, /enqueue is idempotent/i);
});

test("database job transitions match the approved domain state machine", async () => {
  const source = await migrationSource();
  const domain = await readFile(path.join(repositoryRoot, "packages/core/src/jobs.ts"), "utf8");
  const transitionBlock = source.match(/v_transition_allowed :=[\s\S]*?;/u)?.[0];
  assert.ok(transitionBlock, "SQL transition predicate must exist");
  const sqlTransitions = [...transitionBlock.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/gu)]
    .map((match) => `${match[1]}->${match[2]}`).sort();
  const domainTransitions = [...domain.matchAll(/^ {2}([a-z_]+): \[([^\]]*)\]/gmu)]
    .flatMap((match) => [...match[2].matchAll(/"([a-z_]+)"/gu)]
      .map((target) => `${match[1]}->${target[1]}`)).sort();
  assert.ok(domainTransitions.length > 0);
  assert.deepEqual(sqlTransitions, domainTransitions);
});
