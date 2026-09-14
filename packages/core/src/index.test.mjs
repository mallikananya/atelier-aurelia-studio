import assert from "node:assert/strict";
import test from "node:test";
import { canTransition, forbiddenCapabilityIds, productTransitions } from "./index.ts";

test("allows every declared product transition", () => {
  for (const [from, destinations] of Object.entries(productTransitions)) {
    for (const to of destinations) assert.equal(canTransition(from, to), true);
  }
});

test("rejects transitions that are not declared", () => {
  assert.equal(canTransition("idea", "approved"), false);
  assert.equal(canTransition("archived", "idea"), false);
  assert.equal(canTransition("etsy_draft", "approved"), false);
});

test("records the non-negotiable forbidden capabilities", () => {
  assert.deepEqual(forbiddenCapabilityIds, [
    "etsy-live-publication",
    "etsy-arbitrary-payload-submission",
    "generation-hard-coded-theme-template-selection",
  ]);
});
