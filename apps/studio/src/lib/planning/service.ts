import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { planProduct, type StructuredPlanningProvider } from "../../../../../packages/ai/src/planning";
import { PlanningEnvelopeV1, type PlanningEnvelope } from "../../../../../packages/contracts/src/planning";
import { ownerAccess } from "../auth/access";

export interface PlanningProduct {
  id: string; name: string; product_type: string | null; status: string;
  current_revision_id: string | null; created_at: string;
}
export interface PlanningRevision {
  id: string; parent_revision_id: string | null; revision_number: number; name: string;
  content_sha256: string; created_at: string; envelope: PlanningEnvelope | null;
}
interface StoredRevision extends Omit<PlanningRevision, "envelope"> {
  product_id: string; schema_version: string; content: unknown;
}
export interface PlanningProviderConfig {
  provider: StructuredPlanningProvider; generator: { id: string; version: string }; promptVersion: string;
}
/** Adapters may signal absence without exposing transport details to the user. */
export class PlanningProviderUnavailableError extends Error {
  constructor() { super("Planning provider unavailable"); }
}

function inspectHistory(product: PlanningProduct, rows: StoredRevision[]): PlanningRevision[] | null {
  const ordered = [...rows].sort((a, b) => a.revision_number - b.revision_number);
  const revisions: PlanningRevision[] = [];
  for (const [index, row] of ordered.entries()) {
    const previous = revisions[index - 1];
    if (row.product_id !== product.id || row.revision_number !== index + 1
      || row.parent_revision_id !== (previous?.id ?? null)
      || revisions.some(revision => revision.id === row.id)) return null;
    const content = row.content as { schemaVersion?: unknown } | null;
    let envelope: PlanningEnvelope | null = null;
    if (row.schema_version === "planning-envelope/1" || content?.schemaVersion === "planning-envelope/1") {
      const parsed = PlanningEnvelopeV1.safeParse(content);
      if (!parsed.success) return null;
      envelope = parsed.data;
      if (envelope.productId !== product.id || envelope.revisionId !== row.id
        || envelope.parentRevisionId !== row.parent_revision_id || envelope.revisionNumber !== row.revision_number) return null;
      const retained = previous?.envelope?.plan.manifest.pages.map(page => page.id) ?? [];
      if (retained.length !== envelope.provenance.retainedPageIds.length
        || retained.some(id => !envelope!.provenance.retainedPageIds.includes(id))) return null;
    } else if (previous?.envelope || (typeof content?.schemaVersion === "string" && content.schemaVersion.startsWith("planning-envelope"))) return null;
    revisions.push({ id: row.id, parent_revision_id: row.parent_revision_id, revision_number: row.revision_number,
      name: row.name, content_sha256: row.content_sha256, created_at: row.created_at, envelope });
  }
  if (!revisions.length || revisions.at(-1)?.id !== product.current_revision_id) return null;
  return revisions.reverse();
}

export async function planningHistory(value: unknown, productId: string) {
  const access = await ownerAccess(value);
  if (access.kind !== "owner") return access;
  if (!z.uuid().safeParse(productId).success) return { kind: "missing" } as const;
  const client = value as SupabaseClient;
  try {
    const productResult = await client.from("products")
      .select("id, name, product_type, status, current_revision_id, created_at")
      .eq("account_id", access.accountId).eq("id", productId).maybeSingle();
    if (productResult.error) return { kind: "unavailable" } as const;
    if (!productResult.data) return { kind: "missing" } as const;
    const product = productResult.data as PlanningProduct;
    // Ascending pages retain a stable snapshot through the product's captured
    // current pointer, even if a concurrent append occurs while reading history.
    let rows: StoredRevision[] = [];
    while (true) {
      const result = await client.from("product_revisions")
        .select("id, product_id, parent_revision_id, revision_number, schema_version, name, content, content_sha256, created_at")
        .eq("account_id", access.accountId).eq("product_id", productId)
        .order("revision_number", { ascending: true }).range(rows.length, rows.length + 99);
      if (result.error || !result.data) return { kind: "unavailable" } as const;
      if (!result.data.length) break;
      const page = result.data as StoredRevision[];
      const end = page.findIndex(row => row.id === product.current_revision_id);
      rows = [...rows, ...(end >= 0 ? page.slice(0, end + 1) : page)];
      if (end >= 0 || page.length < 100) break;
    }
    const revisions = inspectHistory(product, rows);
    if (!revisions) return { kind: "invalid_history" } as const;
    return { kind: "ok", product, revisions } as const;
  } catch { return { kind: "unavailable" } as const; }
}

export async function generatePlanningRevision(value: unknown, form: FormData, config: PlanningProviderConfig | null) {
  // Authenticate before exposing parsing, product existence or provider availability.
  const access = await ownerAccess(value);
  if (access.kind !== "owner") return access;
  const fields = ["productId", "expectedRevisionId", "idea"] as const;
  if (fields.some(key => form.getAll(key).length !== 1 || typeof form.get(key) !== "string")) return { kind: "invalid_input" } as const;
  const productId = form.get("productId") as string;
  const expectedId = form.get("expectedRevisionId") as string;
  if (!z.uuid().safeParse(productId).success || !z.uuid().safeParse(expectedId).success) return { kind: "invalid_input" } as const;
  const history = await planningHistory(value, productId);
  if (history.kind !== "ok") return history;
  if (history.product.current_revision_id !== expectedId) return { kind: "conflict" } as const;
  if (!config) return { kind: "provider_unavailable" } as const;
  const current = history.revisions[0];
  const revisionId = randomUUID();
  let providerUnavailable = false;
  const provider: StructuredPlanningProvider = { generate: async request => {
    try { return await config.provider.generate(request); }
    catch (error) { providerUnavailable = error instanceof PlanningProviderUnavailableError; throw error; }
  } };
  const planned = await planProduct(provider, {
    productId, revisionId, parentRevisionId: expectedId, revisionNumber: current.revision_number + 1,
    idea: form.get("idea"), createdAt: new Date().toISOString(), generator: config.generator, promptVersion: config.promptVersion,
    sources: current.envelope?.provenance.sources ?? [],
    retainedPageIds: current.envelope?.plan.manifest.pages.map(page => page.id) ?? [],
  });
  if (!planned.ok) {
    if (providerUnavailable) return { kind: "provider_unavailable" } as const;
    return { kind: planned.error.code, issues: planned.error.issues } as const;
  }
  const client = value as SupabaseClient;
  try {
    // The RPC is atomic and has no idempotency key. An ambiguous response must never be retried.
    const { data, error } = await client.rpc("append_product_revision", {
      p_product_id: productId, p_expected_current_revision_id: expectedId,
      p_name: history.product.name, p_product_type: history.product.product_type, p_content: planned.envelope,
    });
    if (error) {
      const kinds = { "40001": "conflict", "42501": "denied", "P0002": "missing", "22023": "invalid_output" } as const;
      return { kind: kinds[error.code as keyof typeof kinds] ?? "uncertain" } as const;
    }
    if (data?.length !== 1 || data[0].product_id !== productId || data[0].revision_id !== revisionId
      || data[0].revision_number !== planned.envelope.revisionNumber) return { kind: "uncertain" } as const;
    return { kind: "saved", productId, revisionId } as const;
  } catch { return { kind: "uncertain" } as const; }
}
