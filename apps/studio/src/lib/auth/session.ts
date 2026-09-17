import "server-only";

import { redirect } from "next/navigation";
import { ownerAccess } from "./access";
import { safeNext } from "./policy";
import { createAuthClient } from "./server";

export async function requireOwner(destination: string) {
  const access = await ownerAccess(await createAuthClient());
  if (access.kind === "anonymous") {
    redirect(`/login?next=${encodeURIComponent(safeNext(destination))}`);
  }
  if (access.kind === "denied") redirect("/access-denied");
  if (access.kind === "unavailable") redirect("/login?status=unavailable");
  return access;
}
