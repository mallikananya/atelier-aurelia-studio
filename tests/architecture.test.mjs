import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  }));
  return nestedFiles.flat();
}

test("workspace lint scripts perform real linting", async () => {
  const packageDirectories = await readdir(path.join(repositoryRoot, "packages"));

  for (const packageDirectory of packageDirectories) {
    const packageJsonPath = path.join(repositoryRoot, "packages", packageDirectory, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    assert.doesNotMatch(packageJson.scripts.lint, /^echo\b/, `${packageJson.name} has a placeholder lint command`);
  }
});

test("source exposes no Etsy publish or arbitrary-payload operation", async () => {
  const files = [
    ...await sourceFiles(path.join(repositoryRoot, "apps")),
    ...await sourceFiles(path.join(repositoryRoot, "packages")),
  ];
  const forbiddenDeclaration = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+)?(?:publish(?:ToEtsy)?|submitArbitraryPayload)\s*\(/i;

  for (const file of files) {
    assert.doesNotMatch(await readFile(file, "utf8"), forbiddenDeclaration, `forbidden marketplace operation in ${file}`);
  }
});

test("creative architecture defines no fixed aesthetic or product catalog", async () => {
  const files = [
    ...await sourceFiles(path.join(repositoryRoot, "apps")),
    ...await sourceFiles(path.join(repositoryRoot, "packages")),
  ];
  const fixedCatalogDeclaration = /\b(?:const|let|var|enum|type|interface|class)\s+(?:aesthetics?|themes?|productFamilies?|designProfiles?|plannerTemplates?)\b/i;

  for (const file of files) {
    assert.doesNotMatch(await readFile(file, "utf8"), fixedCatalogDeclaration, `fixed creative catalog in ${file}`);
  }

  const contracts = await readFile(path.join(repositoryRoot, "packages/contracts/src/index.ts"), "utf8");
  assert.match(contracts, /productType:\s*z\.string\(\)/);
});

test("runtime storage boundary does not use filesystem paths as durable truth", async () => {
  const storageSource = await readFile(path.join(repositoryRoot, "packages/storage/src/index.ts"), "utf8");
  assert.doesNotMatch(storageSource, /from\s+["'](?:node:)?fs(?:\/promises)?["']/);
  assert.match(storageSource, /interface BlobStore/);
  assert.match(storageSource, /interface ProjectStore/);
});

test("Phase 1 provider decisions and simplifications are recorded", async () => {
  const adr = await readFile(
    path.join(repositoryRoot, "docs/adr/0003-phase-1-platform.md"),
    "utf8",
  );

  for (const requiredDecision of [
    "Supabase Auth",
    "Supabase Postgres",
    "AWS S3",
    "MinIO",
    "Trigger.dev Cloud v4",
    "invite-only",
    "Block Public Access",
    "conditional no-overwrite",
  ]) {
    assert.match(adr, new RegExp(requiredDecision.replace(".", "\\."), "i"));
  }

  assert.match(adr, /AWS KMS[^\n]*deferred/i);
  assert.match(adr, /single-owner/i);
  assert.match(adr, /managed backups/i);
  assert.doesNotMatch(adr, /secret_records/i);
});

test("Phase 1 scope documents the durable browser-close acceptance flow", async () => {
  const plan = await readFile(path.join(repositoryRoot, "docs/IMPLEMENTATION_PLAN.md"), "utf8");

  assert.match(plan, /Run Test Build/);
  assert.match(plan, /browser closure/i);
  assert.match(plan, /immutable dummy artifact/i);
  assert.match(plan, /Do not begin Phase 2/i);
});
