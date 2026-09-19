"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authConfig, trustedPost } from "@/lib/auth/policy";
import { createAuthClient } from "@/lib/auth/server";
import { createProduct } from "@/lib/products/service";

export async function createProductAction(_previous: { message: string }, form: FormData) {
  const config = authConfig();
  const request = new Request(config.origin, { headers: await headers() });
  if (!trustedPost(request, config.origin)) return { message: "This request could not be verified. Reload Products and try again." };
  const result = await createProduct(await createAuthClient(), form);
  if (result.kind === "anonymous") redirect("/login?next=%2Fproducts");
  if (result.kind === "denied") redirect("/access-denied");
  if (result.kind === "invalid") return { message: "Enter a product name between 1 and 160 characters." };
  if (result.kind === "unavailable") return { message: "We could not verify your access. Reload Products and try again." };
  if (result.kind === "uncertain") return { message: "We could not confirm creation. Check your Products library before trying again; the product may already have been saved." };
  if (result.kind === "created") {
    revalidatePath("/products");
    redirect(`/products/${result.productId}`);
  }
  return { message: "Creation is unavailable. Reload Products and try again." };
}
