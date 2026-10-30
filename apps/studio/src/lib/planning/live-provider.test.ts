import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getLivePlanningProvider } from "./live-provider";
import { PlanningProviderUnavailableError } from "./service";
const env = { PLANNING_LIVE_ENABLED: "true", PLANNING_LIVE_URL: "https://model.example/v1/chat/completions", PLANNING_LIVE_API_KEY: "test-secret", PLANNING_LIVE_MODEL: "test-model", PLANNING_LIVE_EXPECTED_REQUEST_COST_USD: "0.05" };
const request = { idea: "An original journal", sources: [], retainedPageIds: [], schemaVersion: "creative-plan/1" as const, attempt: 1, issues: [] };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
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
