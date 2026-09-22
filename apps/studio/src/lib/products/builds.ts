import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { productDetail } from "./service";

export async function enqueueTestBuild(value: unknown, form: FormData) {
  const productId = z.uuid().safeParse(form.get("productId"));
  const revisionId = z.uuid().safeParse(form.get("revisionId"));
  if (!productId.success || !revisionId.success || form.getAll("productId").length !== 1 || form.getAll("revisionId").length !== 1) return { kind: "invalid" } as const;
  const detail = await productDetail(value, productId.data);
  if (detail.kind !== "ok") return detail;
  if (detail.revision.id !== revisionId.data) return { kind: "invalid" } as const;
  try {
    // One Phase 1 proof build per immutable revision. Replays reuse the same job,
    // including after uncertain transport responses; ownership is derived in SQL.
    const { data, error } = await (value as SupabaseClient).rpc("enqueue_phase1_test_build", {
      p_product_id: detail.product.id,
      p_revision_id: detail.revision.id,
      p_idempotency_key: `phase1:${detail.revision.id}`,
    });
    const jobId = z.uuid().safeParse(data?.[0]?.job_id);
    if (error || !jobId.success) return { kind: "uncertain" } as const;
    return { kind: "queued", productId: detail.product.id, jobId: jobId.data } as const;
  } catch {
    return { kind: "uncertain" } as const;
  }
}

export async function listTestBuilds(value: unknown, id: string) {
  const detail = await productDetail(value, id);
  if (detail.kind !== "ok") return detail;
  try {
    const { data, error } = await (value as SupabaseClient).from("jobs")
      .select("id, status, progress_percent, progress_message")
      .eq("product_id", detail.product.id).eq("revision_id", detail.revision.id)
      .order("created_at", { ascending: false }).limit(10);
    if (error || !data) return { kind: "unavailable" } as const;
    return { kind: "ok", jobs: data as { id: string; status: string; progress_percent: number; progress_message: string }[] } as const;
  } catch {
    return { kind: "unavailable" } as const;
  }
}
