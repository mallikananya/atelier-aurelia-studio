import { NextResponse } from "next/server";
import { authConfig, trustedPost } from "@/lib/auth/policy";
import { createAuthClient } from "@/lib/auth/server";

export async function POST(request: Request) {
  let config: ReturnType<typeof authConfig>;
  try {
    config = authConfig();
  } catch {
    return new Response("Authentication is unavailable.", { status: 503 });
  }
  if (!trustedPost(request, config.origin)) return new Response("Forbidden", { status: 403 });
  const client = await createAuthClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  const value = error ? "logout-failed" : "signed-out";
  return NextResponse.redirect(new URL(`/login?status=${value}`, config.origin), 303);
}
