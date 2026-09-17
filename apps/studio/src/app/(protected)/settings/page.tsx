import { requireOwner } from "@/lib/auth/session";

export default async function SettingsPage() {
  await requireOwner("/settings");
  return <>
    <div className="eyebrow">Configuration</div>
    <h1>Settings</h1>
    <p className="lede">This area will hold secure OpenAI, storage and Etsy connections, brand defaults, and shop-specific marketplace capabilities. Secrets will never be stored in client-side code.</p>
    <div className="grid">
      <article className="card"><div className="status">Connection</div><h2>OpenAI</h2><p className="lede">Creative direction, structured generation, image generation and visual critique.</p></article>
      <article className="card"><div className="status">Connection</div><h2>Etsy</h2><p className="lede">Draft creation and verification only. Publication stays inside Etsy.</p></article>
      <article className="card"><div className="status">Brand</div><h2>Atelier Aurelia</h2><p className="lede">Reusable preferences without hard-coding a fixed aesthetic.</p></article>
    </div>
  </>;
}
