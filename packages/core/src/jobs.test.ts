import { describe, expect, it } from "vitest";
import { canTransitionJob, nextJobProgress } from "./jobs.js";

describe("job state machine", () => {
  it.each([
    ["queued", "dispatched"],
    ["dispatched", "running"],
    ["running", "succeeded"],
    ["running", "failed"],
    ["failed", "queued"],
  ] as const)("allows %s to transition to %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(true);
  });

  it.each([
    ["succeeded", "running"],
    ["canceled", "queued"],
    ["running", "queued"],
  ] as const)("rejects %s to %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(false);
  });

  it("never moves progress backwards", () => {
    expect(nextJobProgress(40, 72)).toBe(72);
    expect(() => nextJobProgress(72, 40)).toThrow(/backwards/i);
  });
});
