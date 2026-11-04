import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getLivePlanningProvider } from "./live-provider";
import { PlanningProviderUnavailableError } from "./service";
const env = { PLANNING_LIVE_ENABLED: "true", PLANNING_LIVE_URL: "https://model.example/v1/chat/completions", PLANNING_LIVE_API_KEY: "test-secret", PLANNING_LIVE_MODEL: "test-model", PLANNING_LIVE_EXPECTED_REQUEST_COST_USD: "0.05" };
const request = { idea: "An original journal", sources: [], retainedPageIds: [], schemaVersion: "creative-plan/1" as const, attempt: 1, issues: [] };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
it.each(["127.0.0.1", "[::1]"])("allows an explicit five-minute timeout for local Ollama at %s", async host => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"choices":[{"message":{"content":"{}"}}]}')));
  const config = getLivePlanningProvider({ ...env, PLANNING_LIVE_URL: `http://${host}:11434/v1/chat/completions`, PLANNING_LIVE_TIMEOUT_MS: "300000" });
  expect(config).not.toBeNull();
  await config!.provider.generate(request);
  expect(timeout).toHaveBeenCalledWith(300_000);
});
it("preserves default and unrelated provider timeout limits", async () => {
  const url = "http://127.0.0.1:11434/v1/chat/completions";
  expect(getLivePlanningProvider({ ...env, PLANNING_LIVE_URL: url, PLANNING_LIVE_TIMEOUT_MS: "300001" })).toBeNull();
  for (const endpoint of [env.PLANNING_LIVE_URL, "http://127.0.0.1:8080/v1/chat/completions", "http://127.0.0.1:11434/other", "https://127.0.0.1:11434/v1/chat/completions", "http://localhost:11434/v1/chat/completions"]) {
    expect(getLivePlanningProvider({ ...env, PLANNING_LIVE_URL: endpoint, PLANNING_LIVE_TIMEOUT_MS: "300000" })).toBeNull();
  }
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response('{"choices":[{"message":{"content":"{}"}}]}'))));
  for (const endpoint of [url, env.PLANNING_LIVE_URL]) await getLivePlanningProvider({ ...env, PLANNING_LIVE_URL: endpoint })!.provider.generate(request);
  expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
});
it("fails closed without explicit authorization and complete bounded configuration", () => {
  expect(getLivePlanningProvider({})).toBeNull();
  for (const patch of [{ PLANNING_LIVE_ENABLED: "false" }, { PLANNING_LIVE_API_KEY: "" }, { PLANNING_LIVE_MODEL: "" }, { PLANNING_LIVE_EXPECTED_REQUEST_COST_USD: "NaN" }, { PLANNING_LIVE_TIMEOUT_MS: "60001" }, { PLANNING_LIVE_MAX_TOKENS: "100000" }]) expect(getLivePlanningProvider({ ...env, ...patch })).toBeNull();
  for (const url of ["bad", "http://remote.example", "http://localhost", "https://user:password@example.com", "https://example.com?key=secret", "https://example.com#secret"]) expect(getLivePlanningProvider({ ...env, PLANNING_LIVE_URL: url })).toBeNull();
  expect(getLivePlanningProvider({ ...env, PLANNING_LIVE_URL: "http://127.0.0.1:8080/v1/chat/completions" })).not.toBeNull();
});
it("uses existing instructions and contract, keeps credentials out of messages, and passes repair context", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"result":true}' } }] })));
  vi.stubGlobal("fetch", fetcher);
  const config = getLivePlanningProvider(env)!;
  expect(await config.provider.generate({ ...request, attempt: 2, previousOutput: "{}", issues: [{ path: "brief", code: "invalid_type" }] })).toBe('{"result":true}');
  const options = fetcher.mock.calls[0][1];
  expect(options).toMatchObject({ redirect: "error", cache: "no-store", headers: { authorization: "Bearer test-secret" } });
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({ model: "test-model", max_completion_tokens: 6000, response_format: { type: "json_object" } });
  expect(body.messages[0].content).toContain("Never constrain the idea to a predefined product family");
  expect(body.messages[0].content).toContain("creative-plan/1");
  expect(body.messages[1].content).toContain('"previousOutput":"{}"');
  expect(options.body).not.toContain("test-secret");
});
it.each(["127.0.0.1", "[::1]"])("uses Ollama's supported max_tokens limit for local %s", async host => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"choices":[{"message":{"content":"{}"}}]}'));
  vi.stubGlobal("fetch", fetcher);
  await getLivePlanningProvider({ ...env, PLANNING_LIVE_URL: `http://${host}:11434/v1/chat/completions`, PLANNING_LIVE_MAX_TOKENS: "700" })!.provider.generate(request);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.max_tokens).toBe(700);
  expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "creative_plan", strict: true,
    schema: { type: "object", additionalProperties: false, required: ["schemaVersion", "brief", "visualDNA", "manifest", "deliverables"] } } });
  expect(body).not.toHaveProperty("max_completion_tokens");
});
it.each([new Response("secret", { status: 401 }), new Response("secret", { status: 429 }), new Response(null), new Response("not json"), new Response('{"choices":[]}'), new Response("x".repeat(262145))])("sanitizes unavailable, malformed and oversized responses", async response => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(getLivePlanningProvider(env)!.provider.generate(request)).rejects.toThrow(PlanningProviderUnavailableError);
});
it("sanitizes network errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private URL and secret")));
  await expect(getLivePlanningProvider(env)!.provider.generate(request)).rejects.toThrow("Planning provider unavailable");
});
it("bounds a stalled response stream", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {} }))));
  await expect(getLivePlanningProvider({ ...env, PLANNING_LIVE_TIMEOUT_MS: "100" })!.provider.generate(request)).rejects.toThrow(PlanningProviderUnavailableError);
});
it("reports provider execution failure without exposing the response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private details", { status: 500 })));
  await expect(getLivePlanningProvider(env)!.provider.generate(request)).rejects.toThrow("Planning generation failed");
});
it("uses the same live path for contrasting concepts and bounded repair", async () => {
  const { planProduct } = await import("../../../../../packages/ai/src/planning");
  const { readingPlan, travelPlan, planningRequest } = await import("../../../../../packages/ai/src/fixtures/planning");
  for (const plan of [readingPlan, travelPlan]) {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "{" } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] })));
    vi.stubGlobal("fetch", fetcher);
    const configured = getLivePlanningProvider(env)!;
    const result = await planProduct(configured.provider, { ...planningRequest, idea: plan.brief.visualDirection,
      generator: configured.generator, promptVersion: configured.promptVersion });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.plan).toEqual(plan);
      expect(result.envelope.provenance.attempts).toBe(2);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(JSON.parse(fetcher.mock.calls[1][1].body).messages[1].content);
    expect(repair).toMatchObject({ previousOutput: "{", issues: [{ code: "invalid_json" }], attempt: 2 });
  }
});

it("loads the same server prompt when running from the Studio directory", async () => {
  const { resolve } = await import("node:path");
  const studio = resolve(process.cwd(), "apps/studio");
  vi.spyOn(process, "cwd").mockReturnValue(studio);
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] })));
  vi.stubGlobal("fetch", fetcher);
  expect(await getLivePlanningProvider(env)!.provider.generate(request)).toBe("{}");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content).toContain("# Creative Director");
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
  const pending = getLivePlanningProvider(env)!.provider.generate(request, controller.signal);
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
  const pending = getLivePlanningProvider(env)!.provider.generate(request, controller.signal);
  const rejection = expect(pending).rejects.toThrow();
  await fetched;
  controller.abort();
  await rejection;
});
it('does not start transport after cancellation', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(getLivePlanningProvider(env)!.provider.generate(request, AbortSignal.abort())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
