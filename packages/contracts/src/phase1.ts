import { z } from "zod";

const Identifier = z.uuid();
const Timestamp = z.iso.datetime({ offset: true });
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const CreateProductInput = z.strictObject({
  name: z.string().trim().min(1).max(160),
  productType: z.string().trim().min(1).max(240).optional(),
});

export const ProductRevisionV1 = z.strictObject({
  id: Identifier,
  accountId: Identifier,
  productId: Identifier,
  parentRevisionId: Identifier.nullable(),
  revisionNumber: z.number().int().positive(),
  name: z.string().min(1).max(160),
  productType: z.string().min(1).max(240).nullable(),
  content: z.record(z.string(), z.unknown()),
  contentSha256: Sha256,
  createdBy: Identifier,
  createdAt: Timestamp,
});

export const DummyBuildPayloadV1 = z.strictObject({
  schemaVersion: z.literal("phase1.1"),
  jobId: Identifier,
  accountId: Identifier,
  productId: Identifier,
  revisionId: Identifier,
});

export const JobStatusV1 = z.enum([
  "queued",
  "dispatched",
  "running",
  "succeeded",
  "failed",
  "cancel_requested",
  "canceled",
]);

export const JobProgressV1 = z.strictObject({
  percent: z.number().int().min(0).max(100),
  message: z.string().trim().min(1).max(500),
});

export const ArtifactRecordV1 = z.strictObject({
  id: Identifier,
  accountId: Identifier,
  productId: Identifier,
  revisionId: Identifier,
  jobId: Identifier,
  role: z.literal("phase1-test-build"),
  state: z.enum(["pending", "available", "failed"]),
  sha256: Sha256,
  sizeBytes: z.number().int().nonnegative(),
  mediaType: z.string().trim().min(1).max(255),
  storageKey: z.string().trim().min(1).max(1024),
  storageVersionId: z.string().trim().min(1).max(1024),
  createdAt: Timestamp,
});

export type ArtifactRecordV1 = z.infer<typeof ArtifactRecordV1>;
export type CreateProductInput = z.infer<typeof CreateProductInput>;
export type DummyBuildPayloadV1 = z.infer<typeof DummyBuildPayloadV1>;
export type JobProgressV1 = z.infer<typeof JobProgressV1>;
export type JobStatusV1 = z.infer<typeof JobStatusV1>;
export type ProductRevisionV1 = z.infer<typeof ProductRevisionV1>;
