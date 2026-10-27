import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { artifactStorageKey } from "../../../../../packages/storage/src/artifact-keys";
import { ownerAccess } from "../auth/access";

const identifier = z.uuid();
const storedArtifact = z.object({
  media_type: z.enum(["text/plain", "application/pdf"]).default("text/plain"),
  id: identifier, account_id: identifier, product_id: identifier, revision_id: identifier,
  storage_bucket: z.string().min(1), storage_key: z.string().min(1),
  storage_version_id: z.string().min(1).refine(value => value !== "null"), state: z.literal("available"),
});
export interface DownloadStorage {
  bucket: string;
  expiresInSeconds: number;
  createSignedDownload(key: string, versionId: string, expiresInSeconds: number): Promise<URL>;
}
export interface ArtifactSummary { id: string; role: string; size_bytes: number }

/** Only authenticated, RLS-visible Postgres provenance may provide signing identity. */
export async function artifactDownload(value: unknown, id: string, getStorage: () => DownloadStorage) {
  const access = await ownerAccess(value);
  if (access.kind === "unavailable") return { kind: "unavailable" } as const;
  if (access.kind !== "owner" || !identifier.safeParse(id).success) return { kind: "missing" } as const;
  try {
    const client = value as SupabaseClient;
    const { data, error } = await client.from("artifacts")
      .select("id, account_id, product_id, revision_id, state, storage_bucket, storage_key, storage_version_id, media_type")
      .eq("account_id", access.accountId).eq("id", id).eq("state", "available").maybeSingle();
    if (error) return { kind: "unavailable" } as const;
    if (!data) return { kind: "missing" } as const;
    const row = storedArtifact.parse(data);
    const key = artifactStorageKey({ accountId: row.account_id, productId: row.product_id, revisionId: row.revision_id, artifactId: row.id, mediaType: row.media_type });
    if (row.account_id !== access.accountId || row.id !== id || row.storage_key !== key) return { kind: "unavailable" } as const;
    const storage = getStorage();
    if (row.storage_bucket !== storage.bucket) return { kind: "unavailable" } as const;
    const url = await storage.createSignedDownload(key, row.storage_version_id, storage.expiresInSeconds);
    return { kind: "ok", url } as const;
  } catch {
    return { kind: "unavailable" } as const;
  }
}

export async function listRevisionArtifacts(value: unknown, productId: string, revisionId: string) {
  const access = await ownerAccess(value);
  if (access.kind !== "owner" || !identifier.safeParse(productId).success || !identifier.safeParse(revisionId).success) return { kind: "missing" } as const;
  try {
    const client = value as SupabaseClient;
    const { data, error } = await client.from("artifacts").select("id, role, size_bytes")
      .eq("account_id", access.accountId).eq("product_id", productId).eq("revision_id", revisionId)
      .eq("state", "available").order("created_at", { ascending: true });
    if (error || !data) return { kind: "unavailable" } as const;
    return { kind: "ok", artifacts: data as ArtifactSummary[] } as const;
  } catch {
    return { kind: "unavailable" } as const;
  }
}
