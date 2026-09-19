import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/auth/server";
import { listProducts } from "@/lib/products/service";
import { CreateProductForm } from "./create-form";

export default async function ProductsPage() {
  await requireOwner("/products");
  const result = await listProducts(await createAuthClient());
  return <>
    <div className="eyebrow">Library</div>
    <h1>Products</h1>
    <p className="lede">Your saved products and their immutable revisions.</p>
    <CreateProductForm />
    {result.kind !== "ok" ? <p className="auth-message" role="alert">Products could not be loaded. Refresh to try again.</p> :
      result.products.length === 0 ? <section className="card product-empty"><h2>No products yet</h2><p className="lede">Create your first product to start your library.</p></section> :
        <div className="grid">{result.products.map(product => <article className="card" key={product.id}>
          <div className="status">{product.status.replaceAll("_", " ")}</div>
          <h2><Link href={`/products/${product.id}`}>{product.name}</Link></h2>
          <p className="lede">Created {new Date(product.created_at).toLocaleDateString("en-US", { timeZone: "UTC" })}</p>
          <Link className="product-link" href={`/products/${product.id}`}>Open product →</Link>
        </article>)}</div>}
  </>;
}
