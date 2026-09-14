import assert from "node:assert/strict";
import test from "node:test";
import { ArtifactRecord, ProductSpec } from "./index.ts";

const validProductSpec = {
  schemaVersion: "1.0",
  id: "product_01",
  revision: 0,
  name: "A product invented from data",
  productType: "interactive reflection card collection",
  customer: "A specific customer",
  positioning: "A specific promise",
  targetPageCount: 1,
  printable: true,
  digital: true,
  visualDNA: {
    mood: ["editorial"],
    palette: { ink: "#211d1b" },
    typographyDirection: "high-contrast serif",
    illustrationDirection: "original abstract forms",
    geometry: "asymmetric",
    whitespace: "generous",
  },
  pages: [{
    id: "page_01",
    order: 1,
    name: "Opening",
    purpose: "Orient the customer",
    density: "sparse",
    elements: [],
  }],
  inspiration: [],
};

test("accepts an open-ended product type as structured data", () => {
  assert.equal(ProductSpec.safeParse(validProductSpec).success, true);
});

test("rejects invalid product revisions", () => {
  assert.equal(ProductSpec.safeParse({ ...validProductSpec, revision: -1 }).success, false);
});

test("requires immutable artifact identity fields", () => {
  const result = ArtifactRecord.safeParse({
    id: "artifact_01",
    productId: "product_01",
    revision: 0,
    role: "preview",
    sha256: "a".repeat(64),
    sizeBytes: 42,
    mimeType: "image/png",
    storageKey: "objects/aa/sha256",
    createdAt: "2026-09-13T12:00:00.000Z",
    lineage: [],
  });
  assert.equal(result.success, true);
});

test("rejects malformed artifact hashes", () => {
  const result = ArtifactRecord.safeParse({
    id: "artifact_01",
    productId: "product_01",
    revision: 0,
    role: "preview",
    sha256: "not-a-hash",
    sizeBytes: 42,
    mimeType: "image/png",
    storageKey: "objects/invalid",
    createdAt: "2026-09-13T12:00:00.000Z",
    lineage: [],
  });
  assert.equal(result.success, false);
});
