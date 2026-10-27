import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const runner = path.resolve(import.meta.dirname, "../tools/run-with-env.mjs");

test("loads the working directory .env without forwarding --env-file to children", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "atelier-env-"));
  await writeFile(path.join(cwd, ".env"), "LOCAL_ENV_FIXTURE=loaded-locally\n");

  const { stdout } = await execFileAsync(process.execPath, [
    runner,
    "node",
    "-e",
    "process.stdout.write(process.env.LOCAL_ENV_FIXTURE ?? 'missing')",
  ], { cwd });

  assert.equal(stdout, "loaded-locally");
});

test("fails clearly when .env is missing", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "atelier-env-missing-"));

  await assert.rejects(
    execFileAsync(process.execPath, [runner, "node", "--version"], { cwd }),
    /Local environment file not found/u,
  );
});

test("rejects a missing command and an unavailable executable", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "atelier-env-command-"));
  await writeFile(path.join(cwd, ".env"), "LOCAL_ENV_FIXTURE=present\n");

  await assert.rejects(execFileAsync(process.execPath, [runner], { cwd }), /Usage:/u);
  await assert.rejects(
    execFileAsync(process.execPath, [runner, "atelier-command-that-does-not-exist"], { cwd }),
    /Unable to start local command/u,
  );
});

test("forwards termination signals to the child process", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "atelier-env-signal-"));
  await writeFile(path.join(cwd, ".env"), "LOCAL_ENV_FIXTURE=present\n");
  const child = spawn(process.execPath, [
    runner,
    "node",
    "-e",
    "setInterval(() => {}, 1000)",
  ], { cwd, stdio: "ignore" });

  await new Promise((resolve) => setTimeout(resolve, 100));
  child.kill("SIGTERM");
  const [code, signal] = await once(child, "exit");

  assert.equal(code, 1);
  assert.equal(signal, null);
});
