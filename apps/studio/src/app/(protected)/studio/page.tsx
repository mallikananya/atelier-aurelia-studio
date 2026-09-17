import { requireOwner } from "@/lib/auth/session";

export default async function StudioPage() {
  await requireOwner("/studio");
  return (
    <>
      <div className="eyebrow">Creative Director</div>
      <h1>What should we create next?</h1>
      <p className="lede">Start with a rough idea. The Studio will help shape the customer, product, structure, visual world, and deliverables before anything is generated.</p>
      <section className="composer" aria-label="Product idea composer">
        <textarea placeholder="I want to make something for women in their 20s who feel like they're drifting. Feminine and editorial, but not cheesy..." />
        <div className="row">
          <div>
            <button className="pill" type="button">+ Inspiration links</button>{" "}
            <button className="pill" type="button">+ Upload references</button>
          </div>
          <button className="primary" type="button">Start concept →</button>
        </div>
      </section>
    </>
  );
}
