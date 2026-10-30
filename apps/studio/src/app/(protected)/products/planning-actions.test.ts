import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ headers: vi.fn(), generate: vi.fn(), provider: vi.fn(), persistence: vi.fn(), client: {}, revalidate: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/server", () => ({ createAuthClient: vi.fn(async () => mocks.client) }));
vi.mock("@/lib/planning/service", () => ({ generatePlanningRevision: mocks.generate }));
vi.mock("@/lib/planning/provider", () => ({ getPlanningProvider: mocks.provider }));
vi.mock("@/lib/auth/policy", async () => ({ ...await import("../../../lib/auth/policy"), authConfig: () => ({ origin: "http://localhost:3000" }) }));
vi.mock("@/lib/planning/persistence", () => ({ getPlanningPersistence: mocks.persistence }));
import { generatePlanningAction } from "./planning-actions";
const previous = { message: "forged state", idea: "forged idea", saved: false };
const form = () => { const data = new FormData(); data.set("idea", "A botanical reading journal"); return data; };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }));
  mocks.provider.mockReturnValue(null);
  mocks.persistence.mockReturnValue(null);
});
describe("planning action", () => {
  it.each(["https://evil.example", ""])("rejects untrusted origins (%s)", async origin => {
    mocks.headers.mockResolvedValue(new Headers({ origin }));
    expect((await generatePlanningAction(previous, form())).message).toContain("could not be verified");
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it.each([["anonymous", "/login?next=%2Fproducts"], ["denied", "/access-denied"]])("handles %s", async (kind, destination) => {
    mocks.generate.mockResolvedValue({ kind });
    await expect(generatePlanningAction(previous, form())).rejects.toThrow(`redirect:${destination}`);
  });
  it.each([
    ["provider_unavailable", "provider is unavailable"], ["persistence_unavailable", "persistence is unavailable"],
    ["duplicate_request", "already submitted"], ["rate_limited", "request limit"], ["reservation_expired", "reservation expired"], ["provider_failure", "Generation failed"],
    ["invalid_output", "failed validation"], ["invalid_input", "Check your idea"],
    ["conflict", "newer revision"], ["uncertain", "could not confirm"],
    ["invalid_history", "history failed validation"], ["unavailable", "Planning is unavailable"], ["missing", "Planning is unavailable"],
  ])("preserves input and safely explains %s", async (kind, message) => {
    mocks.generate.mockResolvedValue({ kind, error: "secret internal details" });
    const result = await generatePlanningAction(previous, form());
    expect(result).toMatchObject({ idea: "A botanical reading journal", saved: false });
    expect(result.message).toContain(message);
    expect(result.message).not.toContain("secret");
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("delegates validation and refreshes product and Studio planning", async () => {
    mocks.generate.mockResolvedValue({ kind: "saved", productId: "actual-product", revisionId: "revision" });
    const data = form();
    expect(await generatePlanningAction(previous, data)).toMatchObject({ saved: true, idea: "A botanical reading journal" });
    expect(mocks.generate).toHaveBeenCalledWith(mocks.client, data, null, null);
    expect(mocks.revalidate.mock.calls).toEqual([["/products/actual-product"], ["/studio"]]);
  });
});
