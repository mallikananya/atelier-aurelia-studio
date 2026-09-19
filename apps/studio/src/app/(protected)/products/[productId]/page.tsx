import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/auth/server";
import { productDetail } from "@/lib/products/service";

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  await requireOwner("/products");
  const { productId } = await params;
  const result = await productDetail(await createAuthClient(), productId);
  if (result.kind === "missing" || result.kind === "denied" || result.kind === "anonymous") notFound();
  if (result.kind !== "ok") return <><h1>Product unavailable</h1><p className="auth-message" role="alert">We could not load this product. Refresh to try again.</p><Link href="/products">Back to Products</Link></>;
  const { product, revision } = result;
  return <>
    <Link className="product-link" href="/products">← Back to Products</Link>
    <div className="eyebrow product-heading">Product</div>
    <h1>{product.name}</h1>
    <p className="status">{product.status.replaceAll("_", " ")}</p>
    <section className="card revision-card">
      <h2>Revision {revision.revision_number}</h2>
      <p className="lede">This saved revision is immutable. Its identity and contents are preserved.</p>
      <dl className="product-metadata">
        <dt>Revision name</dt><dd>{revision.name}</dd>
        <dt>Product ID</dt><dd>{product.id}</dd>
        <dt>Current revision ID</dt><dd>{revision.id}</dd>
        <dt>Schema version</dt><dd>{revision.schema_version}</dd>
        <dt>Content SHA-256</dt><dd>{revision.content_sha256}</dd>
        <dt>Saved at</dt><dd>{revision.created_at}</dd>
      </dl>
    </section>
  </>;
}
