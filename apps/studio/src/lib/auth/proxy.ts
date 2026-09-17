import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, secureOptions } from "./policy";

export async function refreshAuth(request: NextRequest) {
  const config = authConfig();
  let response = NextResponse.next({ request });
  const client = createServerClient(config.supabaseURL, config.publishableKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.secureCookies,
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) {
          response.cookies.set(name, value, secureOptions(options, config.secureCookies));
        }
      },
    },
  });
  try {
    await client.auth.getClaims();
  } catch {
    // The data-access layer still fails closed; malformed cookies must not break a request.
  }
  return response;
}
