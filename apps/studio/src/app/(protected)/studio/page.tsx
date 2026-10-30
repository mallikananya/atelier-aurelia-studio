import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/auth/session";
import Link from "next/link";
import { createAuthClient } from "@/lib/auth/server";
import { listProducts } from "@/lib/products/service";
import { planningHistory } from "@/lib/planning/service";
import { PlanningComposer } from "../products/planning-composer";
import { PlanningResults } from "../products/planning-results";

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ productId?: string }> }) {
  await requireOwner("/studio");
  const client = await createAuthClient();
  const library = await listProducts(client);
  const { productId } = await searchParams;
  const selected = library.kind === "ok" ? library.products.find(product => product.id === productId) ?? (!productId ? library.products[0] : undefined) : undefined;
  const history = selected ? await planningHistory(client, selected.id) : null;
  return (
    <>
      <div className="eyebrow">Creative Director</div>
      <h1>What should we create next?</h1>
      <p className="lede">Start with a rough idea. The Studio will help shape the customer, product, structure, visual world, and deliverables before anything is generated.</p>
      <p><Link href="/products">Create or open a product</Link> to keep its planning revisions together.</p>
      {library.kind !== "ok" ? <p role="alert">Products could not be loaded. Refresh to try again.</p> : library.products.length === 0 ? <p>Create your first product to start planning.</p> : <>
        <form action="/studio" method="get">
          <label htmlFor="planning-product">Product to plan</label>
          <select id="planning-product" name="productId" defaultValue={selected?.id}>
            {library.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <button type="submit">Open planning</button>
        </form>
        {history?.kind === "ok" && history.product.current_revision_id ? <>
          <section className="composer" aria-label="Product idea composer">
            <PlanningComposer requestId={randomUUID()} key={history.product.id} productId={history.product.id} revisionId={history.product.current_revision_id} />
            <p><Link href={`/products/${history.product.id}`}>Open product details and builds</Link></p>
          </section>
          <PlanningResults revisions={history.revisions} currentRevisionId={history.product.current_revision_id} />
        </> : <p role="alert">{history?.kind === "invalid_history" ? "This product’s revision history failed validation. Planning is blocked; saved revisions are unchanged. Ask the operator to inspect the history before recovery." : "Select an available product with a valid revision history to begin."}</p>}
      </>}
    </>
  );
}
