import type { artifactDownload } from "./downloads";

export function downloadResponse(result: Awaited<ReturnType<typeof artifactDownload>>) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  if (result.kind === "ok") return new Response(null, { status: 302, headers: { ...headers, Location: result.url.toString() } });
  return new Response(result.kind === "missing" ? "Artifact not found." : "Artifact unavailable. Try again later.", {
    status: result.kind === "missing" ? 404 : 503, headers,
  });
}
