"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authConfig, trustedPost } from "@/lib/auth/policy";
import { createAuthClient } from "@/lib/auth/server";
import { generatePlanningRevision } from "@/lib/planning/service";
import { getPlanningProvider } from "@/lib/planning/provider";
import { getPlanningPersistence } from "@/lib/planning/persistence";

type PlanningState = { message: string; idea: string; saved: boolean; requestId?: string };

export async function generatePlanningAction(_previous: PlanningState, form: FormData): Promise<PlanningState> {
  const input = form.get("idea");
  const idea = typeof input === "string" ? input : "";
  const requestId = randomUUID();
  const failure = (message: string): PlanningState => ({ message, idea, saved: false, requestId });
  const config = authConfig();
  const request = new Request(config.origin, { headers: await headers() });
  if (!trustedPost(request, config.origin)) return failure("This request could not be verified. Reload and try again.");
  const result = await generatePlanningRevision(await createAuthClient(), form, getPlanningProvider(), getPlanningPersistence());
  if (result.kind === "anonymous") redirect("/login?next=%2Fproducts");
  if (result.kind === "denied") redirect("/access-denied");
  if (result.kind === "saved") {
    revalidatePath(`/products/${result.productId}`);
    revalidatePath("/studio");
    return { message: "Planning revision saved. Inspect the results and revision history below.", idea, saved: true, requestId };
  }
  const messages: Record<string, string> = {
    provider_unavailable: "The planning provider is unavailable. Ask the operator to check provider configuration, authorization, credentials, model availability and timeout, then try again.",
    persistence_unavailable: "Planning persistence is unavailable. Ask the operator to configure the dedicated planning database connection.",
    duplicate_request: "This planning request was already submitted. Inspect revision history before submitting another request.",
    rate_limited: "The planning request limit has been reached. Wait for active planning to finish or try again after ten minutes.",
    reservation_expired: "The planning reservation expired or was closed. No revision was saved by this attempt. Refresh before trying again.",
    provider_failure: "Generation failed. No revision was saved. Your idea is preserved; try again.",
    invalid_output: "The generated plan failed validation. No revision was saved. Revise your idea or try again.",
    invalid_input: "Check your idea and revision selection. Enter an idea of up to 2,000 characters, then try again.",
    conflict: "A newer revision was saved. Refresh to inspect it before generating again. Copy your idea before refreshing.",
    uncertain: "We could not confirm whether the revision was saved. Refresh and inspect revision history before retrying. Copy your idea before refreshing.",
    invalid_history: "This product’s revision history failed validation. Planning is blocked; existing revisions remain unchanged. Ask the operator to inspect the history before any manual recovery.",
  };
  return failure(messages[result.kind] ?? "Planning is unavailable. Refresh the product and try again.");
}
