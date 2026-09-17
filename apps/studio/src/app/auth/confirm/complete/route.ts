import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { ownerAccess } from "@/lib/auth/access";
import { authConfig, confirmationInput, readForm, safeNext, trustedPost } from "@/lib/auth/policy";
import { createAuthClient } from "@/lib/auth/server";

export async function POST(request: Request) {
  let config: ReturnType<typeof authConfig>;
  try {
    config = authConfig();
  } catch {
    return new Response("Authentication is unavailable.", { status: 503 });
  }
  if (!trustedPost(request, config.origin)) return new Response("Forbidden", { status: 403 });

  try {
    const form = await readForm(request);
    const input = confirmationInput.parse({
      token_hash: form.get("token_hash"),
      type: form.get("type"),
    });
    const next = safeNext(form.get("next"));
    const client = await createAuthClient();
    const verification = await client.auth.verifyOtp({
      token_hash: input.token_hash,
      type: input.type as EmailOtpType,
    });
    if (verification.error) return status(config.origin, "expired");

    const access = await ownerAccess(client);
    if (access.kind === "owner") return NextResponse.redirect(new URL(next, config.origin), 303);
    if (access.kind === "denied") {
      return NextResponse.redirect(new URL("/access-denied", config.origin), 303);
    }
    await client.auth.signOut({ scope: "local" });
    return status(config.origin, access.kind === "unavailable" ? "unavailable" : "expired");
  } catch {
    return status(config.origin, "expired");
  }
}

function status(origin: string, value: string) {
  return NextResponse.redirect(new URL(`/login?status=${value}`, origin), 303);
}
