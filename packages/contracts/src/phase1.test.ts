import { describe, expect, it } from "vitest";
import {
  ArtifactRecordV1,
  CreateProductInput,
  DummyBuildPayloadV1,
  JobProgressV1,
  ProductRevisionV1,
} from "./phase1.js";

const ids = {
  account: "3b9c05f3-2f35-4cc2-930e-d65d48dc3d34",
  artifact: "4f47225b-4fc0-4f96-935e-bf50e73f86f8",
  job: "5928138c-65f9-4f4a-af50-2f978fa6e83a",
  product: "82688c3e-3695-41fd-ae34-4ccd20019b85",
  revision: "9058c7cc-cdef-46a7-9a6f-ac959332236d",
  user: "ee0e9063-70a7-4891-b901-bf43d90dd181",
};

describe("Phase 1 contracts", () => {
  it("keeps product type as open-ended data", () => {
    const result = CreateProductInput.safeParse({
      name: "Soft Discipline",
      productType: "a contemplative habit reflection object",
    });

    expect(result.success).toBe(true);
  });

  it("requires immutable revisions to start at one", () => {
    const baseRevision = {
      id: ids.revision,
      accountId: ids.account,
      productId: ids.product,
      parentRevisionId: null,
      revisionNumber: 1,
      name: "Soft Discipline",
      productType: "open-ended concept",
      content: { schemaVersion: "phase1.1", name: "Soft Discipline" },
      contentSha256: "a".repeat(64),
      createdBy: ids.user,
      createdAt: "2026-09-14T12:00:00.000Z",
    };

    expect(ProductRevisionV1.safeParse(baseRevision).success).toBe(true);
    expect(ProductRevisionV1.safeParse({ ...baseRevision, revisionNumber: 0 }).success).toBe(false);
  });

  it("accepts only the closed Phase 1 dummy workflow payload", () => {
    const payload = {
      schemaVersion: "phase1.1",
      jobId: ids.job,
      accountId: ids.account,
      productId: ids.product,
      revisionId: ids.revision,
    };

    expect(DummyBuildPayloadV1.safeParse(payload).success).toBe(true);
    expect(DummyBuildPayloadV1.safeParse({ ...payload, arbitraryPayload: {} }).success).toBe(false);
  });

  it("bounds persisted job progress", () => {
    expect(JobProgressV1.safeParse({ percent: 100, message: "Complete" }).success).toBe(true);
    expect(JobProgressV1.safeParse({ percent: 101, message: "Impossible" }).success).toBe(false);
  });

  it("requires artifact SHA-256 provenance and immutable storage identity", () => {
    const result = ArtifactRecordV1.safeParse({
      id: ids.artifact,
      accountId: ids.account,
      productId: ids.product,
      revisionId: ids.revision,
      jobId: ids.job,
      role: "phase1-test-build",
      state: "available",
      sha256: "b".repeat(64),
      sizeBytes: 128,
      mediaType: "text/plain",
      storageKey: `accounts/${ids.account}/products/${ids.product}/revisions/${ids.revision}/artifacts/${ids.artifact}/payload.txt`,
      storageVersionId: "minio-version-id",
      createdAt: "2026-09-14T12:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });
});
