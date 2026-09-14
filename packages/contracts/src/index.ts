import { z } from "zod";

export const ProductStatus = z.enum([
  "idea", "concept", "building", "qa", "ready_for_review", "approved", "etsy_draft", "archived"
]);

export const InspirationRef = z.object({
  id: z.string().min(1),
  kind: z.enum(["url", "upload"]),
  source: z.string().min(1),
  note: z.string().optional(),
  provenance: z.object({ capturedAt: z.string().datetime(), consentConfirmed: z.boolean() })
});

export const VisualDNA = z.object({
  mood: z.array(z.string()).min(1),
  palette: z.record(z.string(), z.string()),
  typographyDirection: z.string(),
  illustrationDirection: z.string(),
  geometry: z.string(),
  whitespace: z.string(),
  texture: z.string().optional(),
  motifs: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([])
});

export const PageElement = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), id: z.string(), role: z.string(), text: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  z.object({ type: z.literal("image"), id: z.string(), assetId: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  z.object({ type: z.literal("rule"), id: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  z.object({ type: z.literal("box"), id: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  z.object({ type: z.literal("checkbox"), id: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  z.object({ type: z.literal("grid"), id: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number(), rows: z.number().int().positive(), columns: z.number().int().positive() })
]);

export const PageSpec = z.object({
  id: z.string().min(1),
  order: z.number().int().positive(),
  name: z.string().min(1),
  purpose: z.string().min(1),
  density: z.enum(["sparse", "medium", "dense"]),
  elements: z.array(PageElement)
});

export const ProductSpec = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  name: z.string().min(1),
  productType: z.string().min(1),
  customer: z.string().min(1),
  positioning: z.string().min(1),
  targetPageCount: z.number().int().positive(),
  printable: z.boolean(),
  digital: z.boolean(),
  visualDNA: VisualDNA,
  pages: z.array(PageSpec).min(1),
  inspiration: z.array(InspirationRef).default([])
});

export const ArtifactRecord = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  role: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  storageKey: z.string().min(1),
  createdAt: z.string().datetime(),
  lineage: z.array(z.string()).default([])
});

export const ReleaseSeal = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  approvedAt: z.string().datetime(),
  artifactIds: z.array(z.string()).min(1),
  listingMetadataHash: z.string().regex(/^[a-f0-9]{64}$/),
  releaseHash: z.string().regex(/^[a-f0-9]{64}$/)
});

export type ProductSpec = z.infer<typeof ProductSpec>;
export type ReleaseSeal = z.infer<typeof ReleaseSeal>;
