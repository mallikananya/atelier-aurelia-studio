import { randomUUID } from "node:crypto";
import Link from "next/link";
import { planningHistory } from "@/lib/planning/service";
import { PlanningForm } from "../planning-form";
import { PlanningResults } from "../planning-results";
import { listTestBuilds } from "@/lib/products/builds";
import { BuildForm } from "../build-form";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/session";
import { createAuthClient } from "@/lib/auth/server";
import { productDetail } from "@/lib/products/service";
import { listRevisionArtifacts } from "@/lib/products/downloads";

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  await requireOwner("/products");
  const { productId } = await params;
  const result = await productDetail(await createAuthClient(), productId);
  if (result.kind === "missing" || result.kind === "denied" || result.kind === "anonymous") notFound();
  if (result.kind !== "ok") return <><h1>Product unavailable</h1><p className="auth-message" role="alert">We could not load this product. Refresh to try again.</p><Link href="/products">Back to Products</Link></>;
  const { product, revision } = result;
  const artifacts = await listRevisionArtifacts(await createAuthClient(), product.id, revision.id);
  const builds = await listTestBuilds(await createAuthClient(), product.id);
  const history = await planningHistory(await createAuthClient(), product.id);
  return <>
    <Link className="product-link" href="/products">← Back to Products</Link>
    <div className="eyebrow product-heading">Product</div>
    <h1>{product.name}</h1>
    <p className="status">{product.status.replaceAll("_", " ")}</p>
    <section className="card revision-card">
      <h2>Product planning</h2>
      {history.kind === "ok" ? <PlanningForm requestId={randomUUID()} productId={product.id} revisionId={revision.id} /> : <p role="alert">Planning history could not be verified. Saved revisions are unchanged; ask the operator to inspect the history before recovery.</p>}
    </section>
    {history.kind === "ok" && <PlanningResults revisions={history.revisions} currentRevisionId={revision.id} />}
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
      <h3>Undated weekly planner</h3>
      <BuildForm productId={product.id} revisionId={revision.id} planner />
      <h3>Test build</h3>
      <BuildForm productId={product.id} revisionId={revision.id} />
      {builds.kind === "ok" && <ul>{builds.jobs.map(job => <li key={job.id}>
        <strong>{job.status.replaceAll("_", " ")}</strong> — {job.progress_percent}%: {job.progress_message}
        <br /><small>Job {job.id}</small>
      </li>)}</ul>}
      {builds.kind !== "ok" && <p role="alert">Build status could not be loaded. Refresh to try again.</p>}
      <a href={`/products/${product.id}`}>Refresh build status</a>
      {artifacts.kind === "ok" && artifacts.artifacts.length > 0 && <>
        <h3>Artifacts</h3>
        <ul>{artifacts.artifacts.map(artifact => <li key={artifact.id}>
          <a href={`/artifacts/${artifact.id}/download`} rel="noreferrer">{artifact.role === "planner-pdf" ? "Download planner PDF" : "Download artifact"} ({artifact.size_bytes} bytes)</a>
        </li>)}</ul>
      </>}
      {artifacts.kind === "unavailable" && <p role="alert">Artifacts could not be loaded. Refresh to try again.</p>}
    </section>
  </>;
}
