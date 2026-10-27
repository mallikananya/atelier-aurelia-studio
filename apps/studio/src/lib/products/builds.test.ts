import { describe, expect, it, vi } from "vitest";
vi.mock("./service", () => ({ productDetail: vi.fn() }));
import { productDetail } from "./service";
import { enqueueTestBuild, listTestBuilds } from "./builds";
const productId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const input = () => { const form = new FormData(); form.set("productId", productId); form.set("revisionId", revisionId); return form; };
const detail = { kind: "ok", product: { id: productId }, revision: { id: revisionId } };
describe("test build enqueue", () => {
  it.each(["anonymous", "denied", "missing", "unavailable"])("fails closed for %s", async kind => {
    vi.mocked(productDetail).mockResolvedValue({ kind } as never);
    const client = { rpc: vi.fn() };
    expect(await enqueueTestBuild(client, input())).toEqual({ kind });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each(["malformed", "duplicate", "stale"])("rejects %s identities", async mode => {
    vi.mocked(productDetail).mockResolvedValue(detail as never);
    const form = input();
    if (mode === "malformed") form.set("productId", "bad");
    if (mode === "duplicate") form.append("revisionId", revisionId);
    if (mode === "stale") form.set("revisionId", jobId);
    const client = { rpc: vi.fn() };
    expect(await enqueueTestBuild(client, form)).toEqual({ kind: "invalid" });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("uses database identities and a stable server-owned key for replay", async () => {
    vi.mocked(productDetail).mockResolvedValue(detail as never);
    const client = { rpc: vi.fn().mockResolvedValue({ data: [{ job_id: jobId }], error: null }) };
    const form = input(); form.set("accountId", "forged"); form.set("status", "succeeded"); form.set("idempotencyKey", "forged");
    expect(await enqueueTestBuild(client, form)).toEqual({ kind: "queued", productId, jobId });
    await enqueueTestBuild(client, form);
    expect(client.rpc).toHaveBeenNthCalledWith(2, "enqueue_phase1_test_build", { p_product_id: productId, p_revision_id: revisionId, p_idempotency_key: `phase1:${revisionId}` });
  });
  it.each(["error", "throw", "malformed"])("returns safe uncertain outcome on %s", async mode => {
    vi.mocked(productDetail).mockResolvedValue(detail as never);
    const client = { rpc: vi.fn().mockResolvedValue({ data: [], error: mode === "error" ? {} : null }) };
    if (mode === "throw") client.rpc.mockRejectedValue(new Error("secret"));
    expect(await enqueueTestBuild(client, input())).toEqual({ kind: "uncertain" });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("build status", () => {
  it.each(["missing", "denied"])("does not query jobs for %s products", async kind => {
    vi.mocked(productDetail).mockResolvedValue({ kind } as never);
    const client = { from: vi.fn() };
    expect(await listTestBuilds(client, productId)).toEqual({ kind });
    expect(client.from).not.toHaveBeenCalled();
  });
  it.each(["ok", "error", "throw", "null"])("handles %s database status reads", async mode => {
    vi.mocked(productDetail).mockResolvedValue(detail as never);
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: mode === "null" ? null : [], error: mode === "error" ? {} : null });
    if (mode === "throw") query.limit.mockRejectedValue(new Error("private"));
    const client = { from: vi.fn().mockReturnValue(query) };
    expect(await listTestBuilds(client, productId)).toEqual(mode === "ok" ? { kind: "ok", jobs: [] } : { kind: "unavailable" });
    expect(query.eq).toHaveBeenCalledWith("product_id", productId);
    expect(query.eq).toHaveBeenCalledWith("revision_id", revisionId);
  });
});

it('queues the fixed planner edition with a distinct idempotency namespace', async () => {
  vi.mocked(productDetail).mockResolvedValue(detail as never);
  const client = { rpc: vi.fn().mockResolvedValue({ data: [{ job_id: jobId }], error: null }) };
  const form = input(); form.set('buildType', 'planner_pdf_v1');
  expect(await enqueueTestBuild(client, form)).toEqual({ kind: 'queued', productId, jobId });
  expect(client.rpc).toHaveBeenCalledWith('enqueue_planner_build', {
    p_product_id: productId, p_revision_id: revisionId, p_idempotency_key: `planner-v1:${revisionId}`,
  });
});
it.each(['unknown', 'planner_pdf_v2'])('rejects unsupported build type %s', async type => {
  const client = { rpc: vi.fn() }; const form = input(); form.set('buildType', type);
  expect(await enqueueTestBuild(client, form)).toEqual({ kind: 'invalid' });
  expect(client.rpc).not.toHaveBeenCalled();
});
