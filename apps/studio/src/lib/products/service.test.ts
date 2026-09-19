import { describe, expect, it, vi } from "vitest";
import { createProduct, listProducts, productDetail } from "./service";

const id = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
function backend(role: string | null = "owner") {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.order.mockResolvedValue({ data: [], error: null });
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  const membership = { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: role ? [{ account_id: "account", role }] : [], error: null }) }) }) };
  return { query, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user" } }, error: null }) }, from: vi.fn((table: string) => table === "account_memberships" ? membership : query), rpc: vi.fn().mockResolvedValue({ data: [{ product_id: id, revision_id: revisionId }], error: null }) };
}
const form = (name: string) => { const value = new FormData(); value.set("name", name); return value; };
describe("persisted Products", () => {
  it("loads empty and persisted account-scoped libraries", async () => {
    const client = backend();
    expect(await listProducts(client)).toEqual({ kind: "ok", products: [] });
    client.query.order.mockResolvedValue({ data: [{ id, name: "Soft Discipline" }], error: null });
    expect(await listProducts(client)).toEqual({ kind: "ok", products: [{ id, name: "Soft Discipline" }] });
    expect(client.query.eq).toHaveBeenCalledWith("account_id", "account");
  });
  it.each([null, "member"])("denies nonowners at every operation (%s)", async role => {
    const client = backend(role);
    expect(await listProducts(client)).toEqual({ kind: "denied" });
    expect(await productDetail(client, id)).toEqual({ kind: "denied" });
    expect(await createProduct(client, form("Soft Discipline"))).toEqual({ kind: "denied" });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("denies anonymous and unavailable authorization", async () => {
    const client = backend();
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await createProduct(client, form("Test"))).toEqual({ kind: "anonymous" });
    client.auth.getUser.mockRejectedValue(new Error("private"));
    expect(await listProducts(client)).toEqual({ kind: "unavailable" });
  });
  it.each(["", "  ", "a".repeat(161)])("validates names before executing RPC", async name => {
    const client = backend();
    expect(await createProduct(client, form(name))).toEqual({ kind: "invalid" });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("rejects duplicate and file name inputs", async () => {
    const client = backend(); const input = form("Test"); input.append("name", "Other");
    expect(await createProduct(client, input)).toEqual({ kind: "invalid" });
    input.set("name", new Blob(["name"]));
    expect(await createProduct(client, input)).toEqual({ kind: "invalid" });
  });
  it("calls the single atomic command once, with a trimmed name only", async () => {
    const client = backend();
    expect(await createProduct(client, form(" Soft Discipline "))).toEqual({ kind: "created", productId: id });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("create_product_with_revision", { p_name: "Soft Discipline" });
  });
  it.each(["error", "throw", "empty", "invalid"])("never retries an ambiguous creation (%s)", async failure => {
    const client = backend();
    if (failure === "throw") client.rpc.mockRejectedValue(new Error("private"));
    else client.rpc.mockResolvedValue({ data: failure === "invalid" ? [{ product_id: "bad" }] : [], error: failure === "error" ? { message: "private" } : null });
    expect(await createProduct(client, form("Test"))).toEqual({ kind: "uncertain" });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
  it("returns the same safe missing result for malformed and invisible ids", async () => {
    const client = backend();
    expect(await productDetail(client, "bad")).toEqual({ kind: "missing" });
    expect(client.query.select).not.toHaveBeenCalled();
    expect(await productDetail(client, id)).toEqual({ kind: "missing" });
    expect(client.query.eq).toHaveBeenCalledWith("account_id", "account");
  });
  it("loads the product and its current revision scoped to account and product", async () => {
    const client = backend(); const product = { id, current_revision_id: revisionId }; const revision = { id: revisionId, revision_number: 1 };
    client.query.maybeSingle.mockResolvedValueOnce({ data: product, error: null }).mockResolvedValueOnce({ data: revision, error: null });
    expect(await productDetail(client, id)).toEqual({ kind: "ok", product, revision });
    expect(client.query.eq).toHaveBeenCalledWith("product_id", id);
    expect(client.query.eq).toHaveBeenCalledWith("id", revisionId);
  });
  it.each(["product", "revision", "missing revision", "missing pointer", "throw"])("fails closed on detail read failure (%s)", async failure => {
    const client = backend();
    if (failure === "throw") client.query.maybeSingle.mockRejectedValue(new Error("private"));
    else client.query.maybeSingle.mockResolvedValueOnce({ data: { id, current_revision_id: failure === "missing pointer" ? null : revisionId }, error: failure === "product" ? {} : null }).mockResolvedValueOnce({ data: null, error: failure === "revision" ? {} : null });
    expect(await productDetail(client, id)).toEqual({ kind: "unavailable" });
  });
  it.each(["error", "throw", "null"])("returns safe library errors (%s)", async failure => {
    const client = backend();
    if (failure === "throw") client.query.order.mockRejectedValue(new Error("private"));
    else client.query.order.mockResolvedValue({ data: null, error: failure === "error" ? {} : null });
    expect(await listProducts(client)).toEqual({ kind: "unavailable" });
  });
});
