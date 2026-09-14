import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Etsy port exposes draft creation and verification only", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const interfaceMatch = source.match(/interface EtsyDraftPort\s*{(?<body>[\s\S]*?)\n}/);
  assert.notEqual(interfaceMatch, null);
  const interfaceBody = interfaceMatch.groups.body;
  const methods = [...interfaceBody.matchAll(/^\s*(\w+)\(/gm)].map((match) => match[1]);
  assert.deepEqual(methods, ["createDraftFromSealedRelease", "verifyDraft"]);
});
