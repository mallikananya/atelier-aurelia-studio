import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ headers: vi.fn(), enqueueTestBuild: vi.fn(), client: {}, revalidate: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/server", () => ({ createAuthClient: vi.fn(async () => mocks.client) }));
vi.mock("@/lib/products/builds", () => ({ enqueueTestBuild: mocks.enqueueTestBuild }));
vi.mock("@/lib/auth/policy", async () => {
  const actual = await import("../../../lib/auth/policy");
  return { ...actual, authConfig: () => ({ origin: "http://localhost:3000" }) };
});
import { enqueueBuildAction } from "./build-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }));
});
describe("product creation action", () => {
  it.each(["https://evil.example", ""])("rejects foreign or missing origins before invoking command (%s)", async origin => {
    mocks.headers.mockResolvedValue(new Headers({ origin }));
    expect((await enqueueBuildAction({ message: "" }, new FormData())).message).toContain("could not be verified");
    expect(mocks.enqueueTestBuild).not.toHaveBeenCalled();
  });
  it.each([["anonymous", "/login?next=%2Fproducts"], ["denied", "/access-denied"]])("handles %s authentication result", async (kind, destination) => {
    mocks.enqueueTestBuild.mockResolvedValue({ kind });
    await expect(enqueueBuildAction({ message: "" }, new FormData())).rejects.toThrow(`redirect:${destination}`);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each(["invalid", "missing", "unavailable"])("returns safe %s errors", async kind => {
    mocks.enqueueTestBuild.mockResolvedValue({ kind });
    expect((await enqueueBuildAction({ message: "forged state" }, new FormData())).message).toContain("Build unavailable");
  });
  it("reports uncertain requests without exposing errors", async () => {
    mocks.enqueueTestBuild.mockResolvedValue({ kind: "uncertain" });
    expect((await enqueueBuildAction({ message: "" }, new FormData())).message).toContain("same revision reuses");
  });
  it("refreshes only the database-returned product after enqueue", async () => {
    mocks.enqueueTestBuild.mockResolvedValue({ kind: "queued", productId: "product-id" });
    expect((await enqueueBuildAction({ message: "" }, new FormData())).message).toContain("Test build requested");
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/products/product-id");
  });
});
