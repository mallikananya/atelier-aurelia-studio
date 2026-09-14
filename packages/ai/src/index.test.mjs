import assert from "node:assert/strict";
import test from "node:test";
import { aiRoles } from "./index.ts";

test("AI roles describe responsibilities rather than fixed creative catalogs", () => {
  assert.ok(aiRoles.includes("creative_director"));
  assert.ok(aiRoles.includes("product_architect"));
  assert.equal(aiRoles.some((role) => /theme|template|family|profile/i.test(role)), false);
});
