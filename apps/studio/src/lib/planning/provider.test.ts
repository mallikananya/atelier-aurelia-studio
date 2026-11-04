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

it('cancels a stalled body when the planning lease is lost', async () => {
  const controller = new AbortController();
  const cancelled = vi.fn();
  let opened!: () => void;
  const bodyStarted = new Promise<void>(resolve => { opened = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.body).not.toContain('signal');
    return new Response(new ReadableStream({ pull() { opened(); }, cancel: cancelled }, { highWaterMark: 0 }));
  }));
  const pending = getPlanningProvider(env)!.provider.generate(request, controller.signal);
  const rejection = expect(pending).rejects.toThrow();
  await bodyStarted;
  controller.abort(new Error('private lease detail'));
  await rejection;
  expect(cancelled).toHaveBeenCalledTimes(1);
});
it('cancels waiting for headers even if a transport ignores cancellation', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const fetched = new Promise<void>(resolve => { started = resolve; });
  vi.stubGlobal('fetch', vi.fn(() => { started(); return new Promise(() => {}); }));
  const pending = getPlanningProvider(env)!.provider.generate(request, controller.signal);
  const rejection = expect(pending).rejects.toThrow();
  await fetched;
  controller.abort();
  await rejection;
});
it('does not start transport after cancellation', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(getPlanningProvider(env)!.provider.generate(request, AbortSignal.abort())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
