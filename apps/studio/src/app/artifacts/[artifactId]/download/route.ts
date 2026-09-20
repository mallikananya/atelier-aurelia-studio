import { createAuthClient } from "@/lib/auth/server";
import { artifactDownload } from "@/lib/products/downloads";
import { downloadResponse } from "@/lib/products/download-response";
import { downloadStorage } from "@/lib/products/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const { artifactId } = await params;
    return downloadResponse(await artifactDownload(await createAuthClient(), artifactId, downloadStorage));
  } catch {
    return downloadResponse({ kind: "unavailable" });
  }
}
