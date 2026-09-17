import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authConfig, secureOptions } from "./policy";

export async function createAuthClient() {
  const config = authConfig();
  const cookieStore = await cookies();
  return createServerClient(config.supabaseURL, config.publishableKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.secureCookies,
      path: "/",
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) {
            cookieStore.set(name, value, secureOptions(options, config.secureCookies));
          }
        } catch {
          // Server Components cannot write cookies. The request Proxy refreshes them.
        }
      },
    },
  });
}
