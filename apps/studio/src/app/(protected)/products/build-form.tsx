"use client";

import { useActionState } from "react";
import { enqueueBuildAction } from "./build-actions";

export function BuildForm({ productId, revisionId }: { productId: string; revisionId: string }) {
  const [state, action, pending] = useActionState(enqueueBuildAction, { message: "" });
  return <form action={action} aria-busy={pending}>
    <input type="hidden" name="productId" value={productId} />
    <input type="hidden" name="revisionId" value={revisionId} />
    <p className="auth-note">Create a small test artifact from this saved revision. Repeated requests reuse the same build.</p>
    <button className="primary" type="submit" disabled={pending}>{pending ? "Requesting…" : "Run test build"}</button>
    {state.message && <p role="status">{state.message}</p>}
  </form>;
}
