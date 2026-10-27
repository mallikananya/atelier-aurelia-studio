"use client";

import { useActionState } from "react";
import { enqueueBuildAction } from "./build-actions";

export function BuildForm({ productId, revisionId, planner = false }: { productId: string; revisionId: string; planner?: boolean }) {
  const [state, action, pending] = useActionState(enqueueBuildAction, { message: "" });
  return <form action={action} aria-busy={pending}>
    <input type="hidden" name="buildType" value={planner ? "planner_pdf_v1" : "phase1_test_build"} />
    <input type="hidden" name="productId" value={productId} />
    <input type="hidden" name="revisionId" value={revisionId} />
    <p className="auth-note">{planner ? "Generate the Atelier Aurelia undated planner: 146 A4 pages, 12 monthly sets and 52 weekly spreads. Repeated requests reuse this edition’s build." : "Create a small test artifact from this saved revision. Repeated requests reuse the same build."}</p>
    <button className="primary" type="submit" disabled={pending}>{pending ? "Requesting…" : planner ? "Generate planner PDF" : "Run test build"}</button>
    {state.message && <p role="status">{state.message}</p>}
  </form>;
}
