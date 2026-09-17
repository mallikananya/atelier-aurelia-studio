import type { CookieOptions } from "@supabase/ssr";
import { z } from "zod";

const destinations = new Set(["/studio", "/products", "/settings"]);
const formLimit = 4096;

export const confirmationInput = z.discriminatedUnion("type", [
  z.strictObject({
    token_hash: z.string().regex(/^(?:pkce_)?[a-f0-9]{56}$/u),
    type: z.literal("email"),
  }),
  z.strictObject({
    token_hash: z.string().regex(/^[a-f0-9]{56}$/u),
    type: z.literal("invite"),
  }),
]);

export const loginInput = z.strictObject({
  email: z.email().trim().max(254).transform((value) => value.toLowerCase()),
  next: z.string().optional(),
});

export function safeNext(value: string | null | undefined): string {
  return value && destinations.has(value) ? value : "/studio";
}

export function authConfig(environment: Record<string, string | undefined> = process.env) {
  const app = new URL(required(environment.NEXT_PUBLIC_APP_URL, "NEXT_PUBLIC_APP_URL"));
  const supabase = new URL(required(environment.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"));
  const publishableKey = required(
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

  for (const url of [app, supabase]) {
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash) {
      throw new Error("Authentication URLs must be trusted HTTP-local or HTTPS origins.");
    }
  }
  if (app.pathname !== "/" || supabase.pathname !== "/") {
    throw new Error("Authentication URLs must not contain paths.");
  }
  if (/secret|service_role/iu.test(publishableKey)) {
    throw new Error("Only a browser-safe Supabase publishable key is allowed.");
  }

  return {
    origin: app.origin,
    secureCookies: app.protocol === "https:",
    supabaseURL: supabase.origin,
    publishableKey,
  } as const;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export function trustedPost(request: Request, origin: string): boolean {
  const requestOrigin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return requestOrigin === origin && (!fetchSite || fetchSite === "same-origin");
}

export async function readForm(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (contentType !== "application/x-www-form-urlencoded" ||
    !Number.isFinite(declaredLength) || declaredLength > formLimit) {
    throw new Error("Invalid form request.");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > formLimit) {
    throw new Error("Form request is too large.");
  }
  const parameters = new URLSearchParams(body);
  for (const key of new Set(parameters.keys())) {
    if (parameters.getAll(key).length !== 1) throw new Error("Duplicate form field.");
  }
  return parameters;
}

export function secureOptions(options: CookieOptions, secure: boolean): CookieOptions {
  return { ...options, httpOnly: true, sameSite: "lax", secure, path: "/" };
}
