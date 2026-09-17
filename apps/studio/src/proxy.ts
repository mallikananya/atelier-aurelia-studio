import type { NextRequest } from "next/server";
import { refreshAuth } from "@/lib/auth/proxy";

export async function proxy(request: NextRequest) {
  const response = await refreshAuth(request);
  if (request.nextUrl.pathname === "/auth/confirm") {
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "origin");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
