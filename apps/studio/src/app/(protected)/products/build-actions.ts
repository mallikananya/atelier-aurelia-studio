"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authConfig, trustedPost } from "@/lib/auth/policy";
import { createAuthClient } from "@/lib/auth/server";
import { enqueueTestBuild } from "@/lib/products/builds";

export async function enqueueBuildAction(_previous: { message: string }, form: FormData) {
  const config = authConfig();
  const request = new Request(config.origin, { headers: await headers() });
  if (!trustedPost(request, config.origin)) return { message: "This request could not be verified. Reload and try again." };
  const result = await enqueueTestBuild(await createAuthClient(), form);
  if (result.kind === "anonymous") redirect("/login?next=%2Fproducts");
  if (result.kind === "denied") redirect("/access-denied");
  if (result.kind === "queued") {
    revalidatePath(`/products/${result.productId}`);
    return { message: "Test build requested. Refresh to see its progress." };
  }
  if (result.kind === "uncertain") return { message: "We could not confirm the request. Refresh or retry; the same revision reuses its existing build." };
  return { message: "Build unavailable. Refresh the product and try again." };
}
