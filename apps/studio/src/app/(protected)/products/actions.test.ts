import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ headers: vi.fn(), createProduct: vi.fn(), client: {}, revalidate: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/server", () => ({ createAuthClient: vi.fn(async () => mocks.client) }));
vi.mock("@/lib/products/service", () => ({ createProduct: mocks.createProduct }));
vi.mock("@/lib/auth/policy", async () => {
  const actual = await import("../../../lib/auth/policy");
  return { ...actual, authConfig: () => ({ origin: "http://localhost:3000" }) };
});
import { createProductAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }));
});
describe("product creation action", () => {
  it.each(["https://evil.example", ""])("rejects foreign or missing origins before invoking command (%s)", async origin => {
    mocks.headers.mockResolvedValue(new Headers({ origin }));
    expect((await createProductAction({ message: "" }, new FormData())).message).toContain("could not be verified");
    expect(mocks.createProduct).not.toHaveBeenCalled();
  });
  it.each([["anonymous", "/login?next=%2Fproducts"], ["denied", "/access-denied"]])("handles %s authentication result", async (kind, destination) => {
    mocks.createProduct.mockResolvedValue({ kind });
    await expect(createProductAction({ message: "" }, new FormData())).rejects.toThrow(`redirect:${destination}`);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each([["invalid", "1 and 160"], ["unavailable", "verify your access"], ["uncertain", "may already have been saved"]])("returns safe %s errors without navigation or retry", async (kind, message) => {
    mocks.createProduct.mockResolvedValue({ kind });
    expect((await createProductAction({ message: "forged state" }, new FormData())).message).toContain(message);
    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("invalidates the library and navigates to the database-returned product", async () => {
    mocks.createProduct.mockResolvedValue({ kind: "created", productId: "product-id" });
    const form = new FormData();
    await expect(createProductAction({ message: "" }, form)).rejects.toThrow("redirect:/products/product-id");
    expect(mocks.createProduct).toHaveBeenCalledExactlyOnceWith(mocks.client, form);
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/products");
  });
});
