"use client";

import { useActionState, useState } from "react";
import { generatePlanningAction } from "./planning-actions";

export function PlanningForm({ productId, revisionId, requestId }: { productId: string; revisionId: string; requestId: string }) {
  const [state, action, pending] = useActionState(generatePlanningAction, { message: "", idea: "", saved: false, requestId });
  const [idea, setIdea] = useState("");
  return <form action={action} aria-busy={pending}>
    <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
    <input type="hidden" name="productId" value={productId} />
    <input type="hidden" name="expectedRevisionId" value={revisionId} />
    <label htmlFor="planning-idea">Product planning idea</label>
    <p id="planning-help" className="auth-note">Describe the audience, purpose, style, and pages you have in mind. Each successful plan saves a new immutable revision. For another revision, enter a complete brief; existing page identities are retained. Conversational refinement of the prior concept is deferred to CE-02.3.</p>
    <textarea id="planning-idea" name="idea" rows={6} maxLength={2000} required value={idea}
      onChange={event => setIdea(event.target.value)} disabled={pending} aria-describedby="planning-help" />
    <button className="primary" type="submit" disabled={pending}>{pending ? "Planning…" : "Generate planning revision"}</button>
    {state.message && <p role="status">{state.message}</p>}
  </form>;
}
