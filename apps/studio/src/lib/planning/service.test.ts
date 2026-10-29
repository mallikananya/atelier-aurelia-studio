import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { planningHistory, generatePlanningRevision, PlanningProviderUnavailableError } from "./service";
import { readingPlan, planningRequest } from "../../../../../packages/ai/src/fixtures/planning";
import { planProduct } from "../../../../../packages/ai/src/planning";
const id = planningRequest.productId;
const parent = planningRequest.revisionId;
const product = { id, name: "Journal", product_type: "journal", current_revision_id: parent };
const legacy = { id: parent, product_id: id, parent_revision_id: null, revision_number: 1, schema_version: "phase1.1", content: {}, name: "Journal", content_sha256: "a".repeat(64), created_at: planningRequest.createdAt };
function backend(role = "owner") {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue({ data: [legacy], error: null });
  query.maybeSingle.mockResolvedValue({ data: product, error: null });
  const membership = { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ account_id: "account", role }], error: null }) }) }) };
  return { query, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user" } }, error: null }) }, from: vi.fn((table: string) => table === "account_memberships" ? membership : query), rpc: vi.fn(async (_name, args) => ({ data: [{ product_id: id, revision_id: args.p_content.revisionId, revision_number: 2 }], error: null })) };
}
function form() { const value = new FormData(); value.set("productId", id); value.set("expectedRevisionId", parent); value.set("idea", "A literary journal"); return value; }
const config = () => ({ provider: { generate: vi.fn().mockResolvedValue(JSON.stringify(readingPlan)) }, generator: { id: "test", version: "1" }, promptVersion: "1" });
describe("Studio planning", () => {
  it("paginates complete history beyond the server page limit using the captured pointer", async () => {
    const ids = Array.from({ length: 102 }, () => randomUUID());
    const rows = ids.map((rowId, index) => ({ ...legacy, id: rowId, parent_revision_id: ids[index - 1] ?? null, revision_number: index + 1 }));
    const client = backend();
    client.query.maybeSingle.mockResolvedValue({ data: { ...product, current_revision_id: ids[100] }, error: null });
    client.query.range.mockResolvedValueOnce({ data: rows.slice(0, 100), error: null })
      .mockResolvedValueOnce({ data: rows.slice(100), error: null });
    const history = await planningHistory(client, id);
    expect(history.kind).toBe("ok");
    if (history.kind === "ok") expect(history.revisions).toHaveLength(101);
    expect(client.query.range.mock.calls).toEqual([[0, 99], [100, 199]]);
  });
  it("validates retained lineage across saved plans and fails closed on downgraded content", async () => {
    const first = await planProduct(config().provider, planningRequest);
    if (!first.ok) throw Error("fixture");
    const nextId = randomUUID();
    const second = await planProduct(config().provider, { ...planningRequest, revisionId: nextId,
      parentRevisionId: parent, revisionNumber: 2, retainedPageIds: readingPlan.manifest.pages.map(page => page.id) });
    if (!second.ok) throw Error("fixture");
    const firstRow = { ...legacy, content: first.envelope };
    const nextRow = { ...legacy, id: nextId, parent_revision_id: parent, revision_number: 2, content: second.envelope };
    const client = backend();
    client.query.maybeSingle.mockResolvedValue({ data: { ...product, current_revision_id: nextId }, error: null });
    client.query.range.mockResolvedValue({ data: [firstRow, nextRow], error: null });
    expect((await planningHistory(client, id)).kind).toBe("ok");
    for (const content of [{}, { schemaVersion: "planning-envelope/2" }, { ...second.envelope,
      provenance: { ...second.envelope.provenance, retainedPageIds: [] } }]) {
      client.query.range.mockResolvedValue({ data: [firstRow, { ...nextRow, content }], error: null });
      expect(await planningHistory(client, id)).toEqual({ kind: "invalid_history" });
    }
  });
  it("shows legacy history without inventing envelopes", async () => {
    const client = backend(); const result = await planningHistory(client, id);
    expect(result.kind).toBe("ok"); if (result.kind === "ok") expect(result.revisions[0].envelope).toBeNull();
    expect(client.query.eq).toHaveBeenCalledWith("account_id", "account");
  });
  it("persists a validated, server-identified envelope once", async () => {
    const client = backend(); const result = await generatePlanningRevision(client, form(), config());
    expect(result.kind).toBe("saved"); expect(client.rpc).toHaveBeenCalledTimes(1);
    const args = client.rpc.mock.calls[0][1]; expect(args.p_content.parentRevisionId).toBe(parent);
    expect(args.p_content.revisionNumber).toBe(2); expect(args.p_name).toBe(product.name);
  });
  it("denies nonowners before reads or provider calls", async () => {
    const client = backend("member"); const provider = config();
    expect(await planningHistory(client, id)).toEqual({ kind: "denied" });
    expect(await generatePlanningRevision(client, form(), provider)).toEqual({ kind: "denied" });
    expect(provider.provider.generate).not.toHaveBeenCalled();
  });
  it("distinguishes unavailable providers and failures", async () => {
    expect(await generatePlanningRevision(backend(), form(), null)).toEqual({ kind: "provider_unavailable" });
    const provider = config(); provider.provider.generate.mockRejectedValue(new Error("secret"));
    expect(await generatePlanningRevision(backend(), form(), provider)).toEqual({ kind: "provider_failure", issues: [] });
    provider.provider.generate.mockRejectedValue(new PlanningProviderUnavailableError());
    expect(await generatePlanningRevision(backend(), form(), provider)).toEqual({ kind: "provider_unavailable" });
  });
  it("rejects stale revisions and duplicate inputs without generation", async () => {
    const provider = config(); const input = form(); input.set("expectedRevisionId", id);
    expect(await generatePlanningRevision(backend(), input, provider)).toEqual({ kind: "conflict" });
    input.append("idea", "Other"); expect(await generatePlanningRevision(backend(), input, provider)).toEqual({ kind: "invalid_input" });
    expect(provider.provider.generate).not.toHaveBeenCalled();
  });
  it("reuses CE01 input and output validation", async () => {
    const input = form(); input.set("idea", " "); const provider = config();
    expect((await generatePlanningRevision(backend(), input, provider)).kind).toBe("invalid_input");
    expect(provider.provider.generate).not.toHaveBeenCalled();
    provider.provider.generate.mockResolvedValue("{}"); expect((await generatePlanningRevision(backend(), form(), provider)).kind).toBe("invalid_output");
  });
  it.each([["40001", "conflict"], ["42501", "denied"], ["P0002", "missing"], ["22023", "invalid_output"], ["other", "uncertain"]])("maps persistence %s safely", async (code, kind) => {
    const client = backend(); client.rpc.mockResolvedValue({ data: [], error: { code } } as never);
    expect(await generatePlanningRevision(client, form(), config())).toEqual({ kind }); expect(client.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not retry a thrown or mismatched persistence response", async () => {
    const client = backend(); client.rpc.mockRejectedValue(new Error("private"));
    expect(await generatePlanningRevision(client, form(), config())).toEqual({ kind: "uncertain" });
    client.rpc.mockResolvedValue({ data: [{ product_id: id, revision_id: parent, revision_number: 2 }], error: null });
    expect(await generatePlanningRevision(client, form(), config())).toEqual({ kind: "uncertain" });
  });
  it("retains every current page and rejects corrupted history", async () => {
    const generated = await planProduct(config().provider, planningRequest); if (!generated.ok) throw Error("fixture");
    const row = { ...legacy, schema_version: "planning-envelope/1", content: generated.envelope };
    const client = backend(); client.query.range.mockResolvedValue({ data: [row], error: null });
    const provider = config(); expect((await generatePlanningRevision(client, form(), provider)).kind).toBe("saved");
    expect(provider.provider.generate.mock.calls[0][0].retainedPageIds).toEqual(readingPlan.manifest.pages.map(page => page.id));
    client.query.range.mockResolvedValue({ data: [{ ...row, content: { ...generated.envelope, revisionId: id } }], error: null });
    expect(await planningHistory(client, id)).toEqual({ kind: "invalid_history" });
  });
  it.each(["anonymous", "membership", "malformed", "missing", "read", "throw", "empty", "pointer"])("fails closed on %s history", async failure => {
    const client = backend();
    if (failure === "anonymous") client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null } as never);
    if (failure === "membership") client.auth.getUser.mockRejectedValue(new Error("private"));
    if (failure === "missing") client.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    if (failure === "read") client.query.range.mockResolvedValue({ data: null, error: {} });
    if (failure === "throw") client.query.maybeSingle.mockRejectedValue(new Error("private"));
    if (failure === "empty") client.query.range.mockResolvedValue({ data: [], error: null });
    if (failure === "pointer") client.query.maybeSingle.mockResolvedValue({ data: { ...product, current_revision_id: id }, error: null });
    const kind = failure === "anonymous" ? "anonymous" : ["missing", "malformed"].includes(failure) ? "missing" : ["empty", "pointer"].includes(failure) ? "invalid_history" : "unavailable";
    expect(await planningHistory(client, failure === "malformed" ? "bad" : id)).toEqual({ kind });
  });
  it("rejects malformed form identities and file inputs", async () => {
    const input = form(); input.set("productId", "bad");
    expect(await generatePlanningRevision(backend(), input, config())).toEqual({ kind: "invalid_input" });
    input.set("idea", new Blob(["idea"]));
    expect(await generatePlanningRevision(backend(), input, config())).toEqual({ kind: "invalid_input" });
  });
  it("rejects broken chain, foreign rows and invalid envelopes", async () => {
    for (const row of [{ ...legacy, revision_number: 2 }, { ...legacy, product_id: parent }, { ...legacy, parent_revision_id: id }, { ...legacy, schema_version: "planning-envelope/1" }]) {
      const client = backend(); client.query.range.mockResolvedValue({ data: [row], error: null });
      expect(await planningHistory(client, id)).toEqual({ kind: "invalid_history" });
    }
  });

});
