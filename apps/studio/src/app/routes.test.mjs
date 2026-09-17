import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Studio shell exposes the three intended protected surfaces", async () => {
  const layout = await readFile(new URL("./(protected)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /href="\/studio"/);
  assert.match(layout, /href="\/products"/);
  assert.match(layout, /href="\/settings"/);
});

test("Etsy settings copy remains explicitly draft-only", async () => {
  const settings = await readFile(new URL("./(protected)/settings/page.tsx", import.meta.url), "utf8");
  assert.match(settings, /Draft creation and verification only/);
  assert.match(settings, /Publication stays inside Etsy/);
});

for (const route of ["studio", "products", "settings"]) {
  test(`${route} checks owner access before rendering`, async () => {
    const source = await readFile(new URL(`./(protected)/${route}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`await requireOwner\\("/${route}"\\)`));
  });
}

test("Login has an accessible invite-only email form", async () => {
  const source = await readFile(new URL("./login/page.tsx", import.meta.url), "utf8");
  assert.match(source, /action="\/auth\/login" method="post"/);
  assert.match(source, /htmlFor="email"/);
  assert.match(source, /type="email"/);
  assert.match(source, /maxLength=\{254\}/);
  assert.match(source, /required/);
  assert.match(source, /safeNext/);
  assert.match(source, /If this email has access/);
});

test("Public layout omits private navigation and sign-out uses POST", async () => {
  const root = await readFile(new URL("./layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(root, /Primary navigation/);
  for (const route of ["(protected)/layout.tsx", "access-denied/page.tsx"]) {
    const source = await readFile(new URL(`./${route}`, import.meta.url), "utf8");
    assert.match(source, /action="\/auth\/logout" method="post"/);
  }
});
