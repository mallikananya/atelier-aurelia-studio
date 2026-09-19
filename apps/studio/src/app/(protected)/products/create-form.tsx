"use client";

import { useActionState } from "react";
import { createProductAction } from "./actions";

export function CreateProductForm() {
  const [state, action, pending] = useActionState(createProductAction, { message: "" });
  return <form action={action} className="product-form" aria-busy={pending}>
    <h2>Create a product</h2>
    <label htmlFor="product-name">Product name</label>
    <input id="product-name" name="name" required maxLength={160} placeholder="e.g. Soft Discipline" aria-describedby="creation-note" readOnly={pending} />
    <p id="creation-note" className="auth-note">Start with a name. Your product and its first immutable revision will be saved together.</p>
    <button className="primary" type="submit" disabled={pending}>{pending ? "Creating…" : "Create product"}</button>
    {state.message && <p className="auth-message" role="alert">{state.message}</p>}
  </form>;
}
