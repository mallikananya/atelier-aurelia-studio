import type { PlanningEnvelope } from "../../../../../../packages/contracts/src/planning";

type Revision = {
  id: string; parent_revision_id: string | null; revision_number: number; name: string;
  content_sha256: string; created_at: string; envelope: PlanningEnvelope | null;
};

function PlanningResult({ envelope }: { envelope: PlanningEnvelope }) {
  const { plan, provenance } = envelope;
  return <>
    <p>{provenance.generator.id === "fixture-not-ai" ? "Fixture preview — not AI-generated." : provenance.generator.id === "live-chat-completions" ? "Generated through the configured text-model endpoint." : "Generated through the configured planning provider."}</p>
    <h3>Creative brief</h3>
    <dl className="product-metadata">
      {Object.entries(plan.brief).filter(([key]) => key !== "schemaVersion").map(([key, value]) =>
        <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join("; ") || "None" : value}</dd></div>)}
    </dl>
    <h3>Visual direction</h3>
    <dl className="product-metadata">
      {Object.entries(plan.visualDNA).map(([key, value]) => <div key={key}>
        <dt>{key}</dt><dd>{Array.isArray(value) ? value.join("; ") || "None" : typeof value === "object" ? Object.entries(value).map(([name, color]) => `${name}: ${color}`).join("; ") : value}</dd>
      </div>)}
    </dl>
    <h3>Pages ({plan.manifest.targetPageCount})</h3>
    <ol>{plan.manifest.pages.map(page => <li key={page.id}>
      <strong>{page.name}</strong> — {page.purpose}
      <dl className="product-metadata">
        <dt>Page ID</dt><dd>{page.id}</dd>
        <dt>Density</dt><dd>{page.density}</dd>
        <dt>Dependencies</dt><dd>{page.dependsOnPageIds.join(", ") || "None"}</dd>
        <dt>Sources</dt><dd>{page.sourceIds.join(", ") || "None"}</dd>
      </dl>
    </li>)}</ol>
    <h3>Deliverables</h3>
    <ul>{plan.deliverables.items.map(item => <li key={item.id}>
      <strong>{item.name}</strong> — {item.format.toUpperCase()}, {item.usage}, {item.pageSize}
      <p>Deliverable ID: {item.id}. Pages in order: {item.pageIds.join(", ")}</p>
    </li>)}</ul>
    <h3>Planning provenance</h3>
    <dl className="product-metadata">
      <dt>Idea</dt><dd>{provenance.idea}</dd>
      <dt>Generator</dt><dd>{provenance.generator.id} ({provenance.generator.version})</dd>
      <dt>Prompt version</dt><dd>{provenance.promptVersion}</dd>
      <dt>Generated at</dt><dd>{provenance.createdAt}</dd>
      <dt>Generation attempts</dt><dd>{provenance.attempts}</dd>
      <dt>Input SHA-256</dt><dd>{provenance.inputSha256}</dd>
      <dt>Retained page IDs</dt><dd>{provenance.retainedPageIds.join(", ") || "None"}</dd>
    </dl>
    <details><summary>Validated planning envelope</summary><pre>{JSON.stringify(envelope, null, 2)}</pre></details>
  </>;
}

export function PlanningResults({ revisions, currentRevisionId }: { revisions: Revision[]; currentRevisionId: string }) {
  return <section className="card revision-card">
    <h2>Revision history</h2>
    <p className="auth-note">Saved revisions are immutable. Expand an earlier revision to inspect its original plan and lineage.</p>
    {revisions.map(revision => <details key={revision.id} open={revision.id === currentRevisionId}>
      <summary>Revision {revision.revision_number} — {revision.name}</summary>
      <dl className="product-metadata">
        <dt>Revision ID</dt><dd>{revision.id}</dd>
        <dt>Parent revision ID</dt><dd>{revision.parent_revision_id ?? "None (first revision)"}</dd>
        <dt>Saved at</dt><dd>{revision.created_at}</dd>
        <dt>Content SHA-256</dt><dd>{revision.content_sha256}</dd>
      </dl>
      {revision.envelope ? <PlanningResult envelope={revision.envelope} /> : <p>This legacy revision has no CE-01 planning envelope. Its original saved content is preserved.</p>}
    </details>)}
  </section>;
}
