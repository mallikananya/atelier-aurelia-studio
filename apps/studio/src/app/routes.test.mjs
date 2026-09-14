import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Studio shell exposes the three intended Phase 0 surfaces", async () => {
  const layout = await readFile(new URL("./layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /href="\/studio"/);
  assert.match(layout, /href="\/products"/);
  assert.match(layout, /href="\/settings"/);
});

test("Etsy settings copy remains explicitly draft-only", async () => {
  const settings = await readFile(new URL("./settings/page.tsx", import.meta.url), "utf8");
  assert.match(settings, /Draft creation and verification only/);
  assert.match(settings, /Publication stays inside Etsy/);
});
