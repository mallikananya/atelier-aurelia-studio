import { describe, expect, it, vi } from "vitest";
import { artifactDownload, listRevisionArtifacts } from "./downloads";

const accountId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const revisionId = "44444444-4444-4444-8444-444444444444";
const key = `accounts/${accountId}/products/${productId}/revisions/${revisionId}/artifacts/${id}/payload.txt`;
const record = { id, account_id: accountId, product_id: productId, revision_id: revisionId, storage_bucket: "private", storage_key: key, storage_version_id: "version-1", state: "available" };
function backend(role: string | null = "owner") {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), order: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: record, error: null });
  query.order.mockResolvedValue({ data: [{ id, role: "phase1-test-build", size_bytes: 12 }], error: null });
  const membership = { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: role ? [{ account_id: accountId, role }] : [], error: null }) }) }) };
  return { query, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user" } }, error: null }) }, from: vi.fn((table: string) => table === "account_memberships" ? membership : query) };
}
const signer = () => ({ bucket: "private", expiresInSeconds: 60, createSignedDownload: vi.fn().mockResolvedValue(new URL("https://private.example/object?signature=opaque")) });

describe("authorized artifact downloads", () => {
  it("signs only account-authorized database identity, exact version and a 60-second expiry", async () => {
    const client = backend(); const storage = signer();
    expect(await artifactDownload(client, id, () => storage)).toEqual({ kind: "ok", url: new URL("https://private.example/object?signature=opaque") });
    expect(client.query.eq).toHaveBeenCalledWith("account_id", accountId);
    expect(client.query.eq).toHaveBeenCalledWith("id", id);
    expect(client.query.eq).toHaveBeenCalledWith("state", "available");
    expect(storage.createSignedDownload).toHaveBeenCalledExactlyOnceWith(key, "version-1", 60);
  });
  it.each([null, "member"])("does not load storage or artifacts for nonowners (%s)", async role => {
    const client = backend(role); const getStorage = vi.fn();
    expect(await artifactDownload(client, id, getStorage)).toEqual({ kind: "missing" });
    expect(getStorage).not.toHaveBeenCalled(); expect(client.query.select).not.toHaveBeenCalled();
  });
  it("denies anonymous requests before signing", async () => {
    const client = backend(); const getStorage = vi.fn();
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await artifactDownload(client, id, getStorage)).toEqual({ kind: "missing" });
    expect(getStorage).not.toHaveBeenCalled();
  });
  it.each(["../private", "bad", "", `${id}/payload.txt`])("rejects malformed/untrusted ids (%s)", async value => {
    const client = backend(); const getStorage = vi.fn();
    expect(await artifactDownload(client, value, getStorage)).toEqual({ kind: "missing" });
    expect(getStorage).not.toHaveBeenCalled(); expect(client.query.select).not.toHaveBeenCalled();
  });
  it("makes missing and cross-account rows invisible before loading storage", async () => {
    const client = backend(); const getStorage = vi.fn();
    client.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await artifactDownload(client, id, getStorage)).toEqual({ kind: "missing" });
    expect(getStorage).not.toHaveBeenCalled();
  });
  it.each([
    { account_id: productId }, { id: productId }, { storage_bucket: "other" },
    { storage_key: "../private" }, { storage_version_id: "" }, { storage_version_id: "null" },
    { product_id: "bad" }, { state: "pending" },
  ])("fails closed for inconsistent trusted metadata %j", async change => {
    const client = backend(); const storage = signer();
    client.query.maybeSingle.mockResolvedValue({ data: { ...record, ...change }, error: null });
    expect(await artifactDownload(client, id, () => storage)).toEqual({ kind: "unavailable" });
    expect(storage.createSignedDownload).not.toHaveBeenCalled();
  });
  it.each(["query", "throw", "signer", "config", "auth"])("sanitizes backend failures (%s)", async failure => {
    const client = backend(); const storage = signer();
    if (failure === "query") client.query.maybeSingle.mockResolvedValue({ data: null, error: new Error("secret bucket") });
    if (failure === "throw") client.query.maybeSingle.mockRejectedValue(new Error("secret bucket"));
    if (failure === "signer") storage.createSignedDownload.mockRejectedValue(new Error("secret key"));
    if (failure === "auth") client.auth.getUser.mockRejectedValue(new Error("secret auth"));
    expect(await artifactDownload(client, id, () => { if (failure === "config") throw new Error("secret config"); return storage; })).toEqual({ kind: "unavailable" });
  });
  it("lists only public artifact metadata for the exact account/product/revision", async () => {
    const client = backend();
    expect(await listRevisionArtifacts(client, productId, revisionId)).toEqual({ kind: "ok", artifacts: [{ id, role: "phase1-test-build", size_bytes: 12 }] });
    expect(client.query.eq).toHaveBeenCalledWith("account_id", accountId);
    expect(client.query.eq).toHaveBeenCalledWith("product_id", productId);
    expect(client.query.eq).toHaveBeenCalledWith("revision_id", revisionId);
    expect(client.query.select).toHaveBeenCalledWith("id, role, size_bytes");
  });
  it("rejects unauthorized and malformed lists", async () => {
    expect(await listRevisionArtifacts(backend(null), productId, revisionId)).toEqual({ kind: "missing" });
    expect(await listRevisionArtifacts(backend(), "bad", revisionId)).toEqual({ kind: "missing" });
  });
  it.each(["error", "throw", "null"])("sanitizes list failures (%s)", async failure => {
    const client = backend();
    if (failure === "throw") client.query.order.mockRejectedValue(new Error("secret"));
    else client.query.order.mockResolvedValue({ data: null, error: failure === "error" ? {} : null });
    expect(await listRevisionArtifacts(client, productId, revisionId)).toEqual({ kind: "unavailable" });
  });
});

it("honors validated server-configured expiration", async () => {
  const client = backend();
  const storage = { ...signer(), expiresInSeconds: 120 };
  await artifactDownload(client, id, () => storage);
  expect(storage.createSignedDownload).toHaveBeenCalledExactlyOnceWith(key, "version-1", 120);
});

it('signs the PDF key only when trusted media type matches its canonical path', async () => {
  const client = backend(); const storage = signer();
  const pdfKey = key.replace('payload.txt', 'planner.pdf');
  client.query.maybeSingle.mockResolvedValue({ data: { ...record, storage_key: pdfKey, media_type: 'application/pdf' }, error: null } as never);
  expect((await artifactDownload(client, id, () => storage)).kind).toBe('ok');
  expect(storage.createSignedDownload).toHaveBeenCalledWith(pdfKey, 'version-1', 60);
  client.query.maybeSingle.mockResolvedValue({ data: { ...record, media_type: 'application/pdf' }, error: null } as never);
  expect((await artifactDownload(client, id, () => storage)).kind).toBe('unavailable');
});
