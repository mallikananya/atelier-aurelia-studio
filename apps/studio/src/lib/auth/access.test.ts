import { describe, expect, it, vi } from "vitest";
import { ownerAccess } from "./access";

function client(user: { id: string } | null, memberships: unknown[] = [], failure = false) {
  const limit = vi.fn().mockResolvedValue({ data: memberships, error: failure ? new Error("private details") : null });
  const eq = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ eq });
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) }, from: vi.fn().mockReturnValue({ select }) };
}
describe("owner authorization", () => {
  it("denies anonymous access without querying membership", async () => {
    const backend = client(null);
    expect(await ownerAccess(backend)).toEqual({ kind: "anonymous" });
    expect(backend.from).not.toHaveBeenCalled();
  });
  it("permits exactly one verified owner membership", async () => {
    const backend = client({ id: "user" }, [{ account_id: "account", role: "owner" }]);
    expect(await ownerAccess(backend)).toEqual({ kind: "owner", userId: "user", accountId: "account" });
  });
  it.each([
    { memberships: [] },
    { memberships: [{ account_id: "a", role: "member" }] },
    { memberships: [{ account_id: "a", role: "owner" }, { account_id: "b", role: "owner" }] },
  ])("denies missing/member/ambiguous membership", async ({ memberships }) => {
    expect(await ownerAccess(client({ id: "user" }, memberships))).toEqual({ kind: "denied" });
  });
  it("fails closed on provider/database errors", async () => {
    expect(await ownerAccess(client({ id: "user" }, [], true))).toEqual({ kind: "unavailable" });
    const backend = client(null);
    backend.auth.getUser.mockRejectedValue(new Error("private backend error"));
    expect(await ownerAccess(backend)).toEqual({ kind: "unavailable" });
    backend.auth.getUser.mockResolvedValue({ data: { user: { id: "forged" } }, error: new Error("invalid token") });
    expect(await ownerAccess(backend)).toEqual({ kind: "anonymous" });
  });
});
