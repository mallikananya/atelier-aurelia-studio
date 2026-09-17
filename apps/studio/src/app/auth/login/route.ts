import { NextResponse } from "next/server";
import { authConfig, loginInput, readForm, safeNext, trustedPost } from "@/lib/auth/policy";
import { createAuthClient } from "@/lib/auth/server";

export async function POST(request: Request) {
  let config: ReturnType<typeof authConfig>;
  try {
    config = authConfig();
  } catch {
    return new Response("Authentication is unavailable.", { status: 503 });
  }
  if (!trustedPost(request, config.origin)) return new Response("Forbidden", { status: 403 });

  let parsed: ReturnType<typeof loginInput.safeParse>;
  try {
    const form = await readForm(request);
    parsed = loginInput.safeParse({ email: form.get("email"), next: form.get("next") ?? undefined });
  } catch {
    parsed = loginInput.safeParse({});
  }
  if (!parsed.success) return redirect(config.origin, "/login?status=invalid");

  const next = safeNext(parsed.data.next);
  const callback = new URL("/auth/confirm", config.origin);
  callback.searchParams.set("next", next);
  const client = await createAuthClient();
  await client.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false, emailRedirectTo: callback.toString() },
  });

  const destination = new URL("/login", config.origin);
  destination.searchParams.set("status", "sent");
  destination.searchParams.set("next", next);
  return NextResponse.redirect(destination, 303);
}

function redirect(origin: string, path: string) {
  return NextResponse.redirect(new URL(path, origin), 303);
}
