import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ownerAccess } from "../auth/access";

const productId = z.uuid();
const productName = z.string().trim().min(1).max(160);
export interface Product {
  id: string; name: string; status: string; current_revision_id: string | null; created_at: string;
}
export interface Revision {
  id: string; revision_number: number; name: string; schema_version: string; content_sha256: string; created_at: string;
}
const productColumns = "id, name, status, current_revision_id, created_at";
const revisionColumns = "id, revision_number, name, schema_version, content_sha256, created_at";

export async function listProducts(value: unknown) {
  const access = await ownerAccess(value);
  if (access.kind !== "owner") return access;
  const client = value as SupabaseClient;
  try {
    const { data, error } = await client.from("products").select(productColumns)
      .eq("account_id", access.accountId).order("created_at", { ascending: false });
    if (error || !data) return { kind: "unavailable" } as const;
    return { kind: "ok", products: data as Product[] } as const;
  } catch {
    return { kind: "unavailable" } as const;
  }
}

export async function productDetail(value: unknown, id: string) {
  const access = await ownerAccess(value);
  if (access.kind !== "owner") return access;
  if (!productId.safeParse(id).success) return { kind: "missing" } as const;
  const client = value as SupabaseClient;
  try {
    const result = await client.from("products").select(productColumns)
      .eq("account_id", access.accountId).eq("id", id).maybeSingle();
    if (result.error) return { kind: "unavailable" } as const;
    if (!result.data) return { kind: "missing" } as const;
    const product = result.data as Product;
    if (!product.current_revision_id) return { kind: "unavailable" } as const;
    const revision = await client.from("product_revisions").select(revisionColumns)
      .eq("account_id", access.accountId).eq("product_id", id)
      .eq("id", product.current_revision_id).maybeSingle();
    if (revision.error || !revision.data) return { kind: "unavailable" } as const;
    return { kind: "ok", product, revision: revision.data as Revision } as const;
  } catch {
    return { kind: "unavailable" } as const;
  }
}

export async function createProduct(value: unknown, form: FormData) {
  const access = await ownerAccess(value);
  if (access.kind !== "owner") return access;
  const name = productName.safeParse(form.get("name"));
  if (!name.success || form.getAll("name").length !== 1) return { kind: "invalid" } as const;
  const client = value as SupabaseClient;
  try {
    // This command owns the transaction, revision contents, provenance and hash.
    // It has no idempotency key: never retry after an uncertain response.
    const { data, error } = await client.rpc("create_product_with_revision", { p_name: name.data });
    const id = productId.safeParse(data?.[0]?.product_id);
    if (error || !id.success) return { kind: "uncertain" } as const;
    return { kind: "created", productId: id.data } as const;
  } catch {
    return { kind: "uncertain" } as const;
  }
}
