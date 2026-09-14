import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("storage ports require immutable writes and authorized reads", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /putImmutable\(/);
  assert.match(source, /createSignedDownload\(/);
  assert.doesNotMatch(source, /\b(?:overwrite|writeFile|mkdir)\b/);
});
