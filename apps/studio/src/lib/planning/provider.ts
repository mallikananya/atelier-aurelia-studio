import "server-only";
import { getLivePlanningProvider } from "./live-provider";
import { z } from "zod";
import { PLANNING_MAX_BYTES, PlanningRequestV1 } from "../../../../../packages/contracts/src/planning";
import type { GenerationRequest } from "../../../../../packages/ai/src/planning";
import { PlanningProviderUnavailableError, type PlanningProviderConfig } from "./service";

/** Optional local transport. The endpoint implements GenerationRequest -> raw plan JSON.
 * A literal loopback address and rejected redirects keep configuration local-only.
 * Creative validation and repair remain exclusively in the CE-01 service.
 */
export function getPlanningProvider(env: Record<string, string | undefined> = process.env): PlanningProviderConfig | null {
  if (env.PLANNING_PROVIDER_MODE === "live") return getLivePlanningProvider(env);
  if (env.PLANNING_PROVIDER_MODE === "fixture") {
    if (!["reading", "travel"].includes(env.PLANNING_FIXTURE ?? "reading")) return null;
    return { generator: { id: "fixture-not-ai", version: env.PLANNING_FIXTURE ?? "reading" },
      promptVersion: "fixture/1", provider: { generate: async () => {
        const fixtures = await import("../../../../../packages/ai/src/fixtures/planning");
        return JSON.stringify(env.PLANNING_FIXTURE === "travel" ? fixtures.travelPlan : fixtures.readingPlan);
      } } };
  }
  if (env.PLANNING_PROVIDER_MODE && env.PLANNING_PROVIDER_MODE !== "local") return null;
  let endpoint: URL;
  try { endpoint = new URL(env.PLANNING_PROVIDER_URL ?? ""); } catch { return null; }
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.hash) return null;
  const metadata = z.object({ generator: PlanningRequestV1.shape.generator, promptVersion: PlanningRequestV1.shape.promptVersion }).safeParse({
    generator: { id: env.PLANNING_PROVIDER_ID, version: env.PLANNING_PROVIDER_VERSION },
    promptVersion: env.PLANNING_PROMPT_VERSION,
  });
  if (!metadata.success) return null;
  return { ...metadata.data, provider: { generate: request => generate(endpoint, request) } };
}

async function generate(endpoint: URL, request: GenerationRequest): Promise<string> {
  const response = await fetch(endpoint.href, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(request), signal: AbortSignal.timeout(30_000), redirect: "error", cache: "no-store" })
    .catch((error: unknown) => {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      if (code && ["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(code)) throw new PlanningProviderUnavailableError();
      throw error;
    });
  if ([404, 429, 503].includes(response.status)) {
    await response.body?.cancel();
    throw new PlanningProviderUnavailableError();
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Planning transport failed");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let output = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      // Keep the stream bounded, but let CE-01 classify oversize as invalid output
      // and apply its repair budget instead of mislabeling it a transport failure.
      if (size > PLANNING_MAX_BYTES) return " ".repeat(PLANNING_MAX_BYTES + 1);
      output += decoder.decode(chunk.value, { stream: true });
    }
    return output + decoder.decode();
  } finally { await reader.cancel(); reader.releaseLock(); }
}
