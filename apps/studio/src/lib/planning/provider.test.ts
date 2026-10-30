import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getPlanningProvider } from "./provider";
import { PlanningProviderUnavailableError } from "./service";

const env = { PLANNING_PROVIDER_URL: "http://127.0.0.1:11435/plan", PLANNING_PROVIDER_ID: "local-generator",
  PLANNING_PROVIDER_VERSION: "1", PLANNING_PROMPT_VERSION: "1" };
const request = { idea: "A journal", sources: [], retainedPageIds: [], schemaVersion: "creative-plan/1" as const, attempt: 1, issues: [] };
afterEach(() => vi.unstubAllGlobals());
it("is unavailable unless explicitly configured with loopback transport and metadata", () => {
  expect(getPlanningProvider({})).toBeNull();
  for (const url of ["bad", "https://remote.example/plan", "http://localhost/plan", "http://127.0.0.1@evil.test/", "http://user:pass@127.0.0.1/", "http://127.0.0.1/#fragment"]) {
    expect(getPlanningProvider({ ...env, PLANNING_PROVIDER_URL: url })).toBeNull();
  }
  expect(getPlanningProvider({ ...env, PLANNING_PROVIDER_VERSION: "" })).toBeNull();
});
it("sends provider-neutral requests with bounded transport, no redirects and no caching", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"plan":true}'));
  vi.stubGlobal("fetch", fetcher);
  const config = getPlanningProvider(env)!;
  expect(config.generator).toEqual({ id: "local-generator", version: "1" });
  expect(await config.provider.generate(request)).toBe('{"plan":true}');
  expect(fetcher).toHaveBeenCalledWith(env.PLANNING_PROVIDER_URL, expect.objectContaining({ method: "POST", redirect: "error", cache: "no-store", body: JSON.stringify(request), signal: expect.any(AbortSignal) }));
});
it.each([new Response("private details", { status: 500 }), new Response(null)])("rejects failed or missing responses", async response => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(getPlanningProvider(env)!.provider.generate(request)).rejects.toThrow("Planning transport failed");
});
it("hands oversized output to CE01's validation budget without retaining provider content", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(65_537))));
  expect(await getPlanningProvider(env)!.provider.generate(request)).toBe(" ".repeat(65_537));
});
it("distinguishes a stopped endpoint or unavailable service from generation failures", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(getPlanningProvider(env)!.provider.generate(request)).rejects.toBeInstanceOf(PlanningProviderUnavailableError);
  fetcher.mockResolvedValue(new Response("private details", { status: 503 }));
  await expect(getPlanningProvider(env)!.provider.generate(request)).rejects.toBeInstanceOf(PlanningProviderUnavailableError);
  fetcher.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
  await expect(getPlanningProvider(env)!.provider.generate(request)).rejects.not.toBeInstanceOf(PlanningProviderUnavailableError);
});
it("supports an explicit fixture mode without network calls or aesthetic routing", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const config = getPlanningProvider({ PLANNING_PROVIDER_MODE: "fixture", PLANNING_FIXTURE: "travel" })!;
  expect(config.generator.id).toBe("fixture-not-ai");
  const output = JSON.parse(await config.provider.generate(request));
  expect(output.brief.name).toBe("Departure Club");
  expect(fetcher).not.toHaveBeenCalled();
  expect(getPlanningProvider({ PLANNING_PROVIDER_MODE: "invalid", ...env })).toBeNull();
  expect(getPlanningProvider({ PLANNING_PROVIDER_MODE: "live", ...env })).toBeNull();
});
