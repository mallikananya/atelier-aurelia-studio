import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const hook = resolve('tools/git-hooks/pre-push');
const push = 'refs/heads/main a111 refs/heads/main b111\n';
function run(t, { node = 'real', npm = 'ok', git = 'ok', runtimes = {}, files = [], manifest = JSON.stringify({ scripts: { lint: 'lint', typecheck: 'typecheck', test: 'test', build: 'build' } }), input = push, env = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'aurelia-hook-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const executable = (name, text) => writeFileSync(join(bin, name), `#!/bin/sh\n${text}\n`, { mode: 0o755 });
  if (git !== 'missing') executable('git', git === 'ok' ? 'exit 0' : 'exit 44');
  for (const [name, success] of Object.entries(runtimes)) executable(name, success ? 'exit 0' : 'exit 45');
  for (const file of files) writeFileSync(join(directory, file), '');
  if (node === 'real') executable('node', `exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"`);
  else if (node !== 'missing') executable('node', 'exit 42');
  if (npm !== 'missing') executable('npm', npm === 'ok' ? 'echo "CHECK:$*"' : 'exit 43');
  if (manifest !== null) writeFileSync(join(directory, 'package.json'), manifest);
  return spawnSync('/bin/bash', [hook], { cwd: directory, input, encoding: 'utf8', env: { PATH: bin, ...env } });
}

for (const node of ['missing', 'broken']) {
  test(`rejects ${node} Node runtime rather than skipping scripts`, (t) => assert.notEqual(run(t, { node }).status, 0));
}
for (const npm of ['missing', 'broken']) {
  test(`rejects ${npm} package manager`, (t) => assert.notEqual(run(t, { npm }).status, 0));
}
test('rejects malformed package metadata', (t) => assert.notEqual(run(t, { manifest: '{' }).status, 0));
for (const scripts of [42, [], { test: '' }, { lint: false }]) {
  test(`rejects invalid verification script definitions ${JSON.stringify(scripts)}`, (t) => assert.notEqual(run(t, { manifest: JSON.stringify({ scripts }) }).status, 0));
}
test('runs each existing authoritative npm script', (t) => {
  const result = run(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.match(/CHECK:run \w+/g), ['CHECK:run lint', 'CHECK:run typecheck', 'CHECK:run test', 'CHECK:run build']);
});
test('permits genuinely absent scripts after successful discovery', (t) => {
  const result = run(t, { manifest: JSON.stringify({ scripts: { test: 'test' } }) });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.match(/CHECK:run \w+/g), ['CHECK:run test']);
});
test('preserves explicit opt-out and deletion-only behavior', (t) => {
  assert.equal(run(t, { node: 'missing', env: { ECC_SKIP_PREPUSH: '1' } }).status, 0);
  assert.equal(run(t, { node: 'missing', input: 'refs/heads/main 0000000000000000000000000000000000000000 refs/heads/main b111\n' }).status, 0);
});

for (const git of ['missing', 'broken']) {
  test(`rejects ${git} Git worktree discovery`, (t) => assert.notEqual(run(t, { git }).status, 0));
}
for (const [runtime, file] of [['go', 'go.mod'], ['pytest', 'pyproject.toml'], ['pytest', 'requirements.txt']]) {
  test(`rejects missing ${runtime} for ${file}`, (t) => assert.notEqual(run(t, { manifest: null, files: [file] }).status, 0));
  test(`propagates failed ${runtime} checks for ${file}`, (t) => assert.notEqual(run(t, { manifest: null, files: [file], runtimes: { [runtime]: false } }).status, 0));
  test(`accepts successful ${runtime} checks for ${file}`, (t) => assert.equal(run(t, { manifest: null, files: [file], runtimes: { [runtime]: true } }).status, 0));
}
