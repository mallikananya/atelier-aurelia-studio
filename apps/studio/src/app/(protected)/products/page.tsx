import { requireOwner } from "@/lib/auth/session";

const examples = [
  ["Soft Discipline", "Ready for review", "68 pages"],
  ["Sunday Reset", "Generating", "Planning structure"],
  ["Amalfi Journal", "Etsy draft", "64 pages"],
];
export default async function ProductsPage() {
  await requireOwner("/products");
  return <>
    <div className="eyebrow">Library</div>
    <h1>Products</h1>
    <p className="lede">Every concept, revision, deliverable, listing and Etsy state will live here.</p>
    <div className="grid">{examples.map(([name,status,detail]) => <article className="card" key={name}><div className="thumb"/><div className="status">{status}</div><h2>{name}</h2><p className="lede">{detail}</p></article>)}</div>
  </>;
}
