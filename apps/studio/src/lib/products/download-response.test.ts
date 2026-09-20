import { describe, expect, it } from "vitest";
import { downloadResponse } from "./download-response";

describe("download HTTP responses", () => {
  it("redirects with no caching or referrer disclosure", () => {
    const response = downloadResponse({ kind: "ok", url: new URL("https://storage.example/object?opaque=signature") });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://storage.example/object?opaque=signature");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
  it.each(["missing", "unavailable"] as const)("returns a safe noncacheable %s response", async kind => {
    const response = downloadResponse({ kind });
    expect(response.status).toBe(kind === "missing" ? 404 : 503);
    expect(await response.text()).toBe(kind === "missing" ? "Artifact not found." : "Artifact unavailable. Try again later.");
    expect(response.headers.has("Location")).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
