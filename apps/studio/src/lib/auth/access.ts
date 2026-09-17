interface AuthBackend {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
  from(table: "account_memberships"): {
    select(columns: "account_id, role"): {
      eq(column: "user_id", value: string): {
        limit(count: number): PromiseLike<{
          data: Array<{ account_id: string; role: string }> | null;
          error: unknown;
        }>;
      };
    };
  };
}

export type OwnerAccess =
  | { kind: "anonymous" | "denied" | "unavailable" }
  | { kind: "owner"; userId: string; accountId: string };

export async function ownerAccess(value: unknown): Promise<OwnerAccess> {
  const backend = value as AuthBackend;
  try {
    const { data, error } = await backend.auth.getUser();
    if (error || !data.user) return { kind: "anonymous" };

    const memberships = await backend.from("account_memberships")
      .select("account_id, role")
      .eq("user_id", data.user.id)
      .limit(2);
    if (memberships.error || !memberships.data) return { kind: "unavailable" };
    if (memberships.data.length !== 1 || memberships.data[0]?.role !== "owner") {
      return { kind: "denied" };
    }
    return {
      kind: "owner",
      userId: data.user.id,
      accountId: memberships.data[0].account_id,
    };
  } catch {
    return { kind: "unavailable" };
  }
}
