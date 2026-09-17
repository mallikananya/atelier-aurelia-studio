import { describe, expect, it } from "vitest";
import { authConfig, confirmationInput, safeNext, trustedPost, readForm } from "./policy";

describe("authentication boundaries", () => {
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/auth/logout", "/studio?next=evil", undefined])("rejects unsafe destination %s", (value) => {
    expect(safeNext(value)).toBe("/studio");
  });
  it.each(["/studio", "/products", "/settings"])("permits %s", (value) => expect(safeNext(value)).toBe(value));
  it("requires configured trusted URLs and browser-safe key", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://studio.example.test", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
    expect(authConfig(env).origin).toBe(env.NEXT_PUBLIC_APP_URL);
    expect(() => authConfig({})).toThrow();
    expect(() => authConfig({ ...env, NEXT_PUBLIC_APP_URL: "https://studio.example.test/evil" })).toThrow();
    expect(() => authConfig({ ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_bad" })).toThrow();
    expect(() => authConfig({ ...env, NEXT_PUBLIC_APP_URL: "http://public.example.test" })).toThrow();
  });
  it("accepts only invitation or email token hashes", () => {
    expect(confirmationInput.safeParse({ token_hash: "a".repeat(56), type: "email" }).success).toBe(true);
    expect(confirmationInput.safeParse({ token_hash: "a".repeat(56), type: "invite" }).success).toBe(true);
    expect(confirmationInput.safeParse({ token_hash: `pkce_${"a".repeat(56)}`, type: "email" }).success).toBe(true);
    expect(confirmationInput.safeParse({ token_hash: "a".repeat(64), type: "email" }).success).toBe(false);
    expect(confirmationInput.safeParse({ token_hash: `pkce_${"a".repeat(56)}`, type: "invite" }).success).toBe(false);
    expect(confirmationInput.safeParse({ token_hash: "<script>", type: "email" }).success).toBe(false);
    expect(confirmationInput.safeParse({ token_hash: "a".repeat(56), type: "recovery" }).success).toBe(false);
  });
  it("rejects forged/missing origin and cross-site POST", () => {
    const request = (origin?: string, site = "same-origin") => new Request("https://studio.test/auth/logout", { method: "POST", headers: { ...(origin ? { origin } : {}), "sec-fetch-site": site } });
    expect(trustedPost(request("https://studio.test"), "https://studio.test")).toBe(true);
    expect(trustedPost(request(), "https://studio.test")).toBe(false);
    expect(trustedPost(request("https://evil.test"), "https://studio.test")).toBe(false);
    expect(trustedPost(request("https://studio.test", "cross-site"), "https://studio.test")).toBe(false);
  });
  it("bounds form bodies and rejects duplicate fields", async () => {
    const request = (body: string, contentType = "application/x-www-form-urlencoded") => new Request("https://studio.test", { method: "POST", headers: { "content-type": contentType }, body });
    expect((await readForm(request("email=owner%40example.test"))).get("email")).toBe("owner@example.test");
    await expect(readForm(request("email=a&email=b"))).rejects.toThrow();
    await expect(readForm(request("a".repeat(5000)))).rejects.toThrow();
    await expect(readForm(request("{}", "application/json"))).rejects.toThrow();
  });
});
