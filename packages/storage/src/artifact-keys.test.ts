import { describe, expect, it } from "vitest";
import { artifactStorageKey } from "./artifact-keys.js";

describe("artifactStorageKey", () => {
  it("derives an immutable key exclusively from stable identifiers", () => {
    const key = artifactStorageKey({
      accountId: "3b9c05f3-2f35-4cc2-930e-d65d48dc3d34",
      artifactId: "4f47225b-4fc0-4f96-935e-bf50e73f86f8",
      productId: "82688c3e-3695-41fd-ae34-4ccd20019b85",
      revisionId: "9058c7cc-cdef-46a7-9a6f-ac959332236d",
    });

    expect(key).toBe(
      "accounts/3b9c05f3-2f35-4cc2-930e-d65d48dc3d34/products/82688c3e-3695-41fd-ae34-4ccd20019b85/revisions/9058c7cc-cdef-46a7-9a6f-ac959332236d/artifacts/4f47225b-4fc0-4f96-935e-bf50e73f86f8/payload.txt",
    );
  });

  it("rejects non-UUID path components", () => {
    expect(() => artifactStorageKey({
      accountId: "../../other-account",
      artifactId: "4f47225b-4fc0-4f96-935e-bf50e73f86f8",
      productId: "82688c3e-3695-41fd-ae34-4ccd20019b85",
      revisionId: "9058c7cc-cdef-46a7-9a6f-ac959332236d",
    })).toThrow();
  });
});
