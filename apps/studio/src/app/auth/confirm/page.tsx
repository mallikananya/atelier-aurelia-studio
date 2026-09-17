import { redirect } from "next/navigation";
import { confirmationInput, safeNext } from "@/lib/auth/policy";

export const dynamic = "force-dynamic";
export const metadata = { referrer: "origin" };

export default async function ConfirmPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parameters = await searchParams;
  const confirmation = confirmationInput.safeParse({
    token_hash: typeof parameters.token_hash === "string" ? parameters.token_hash : "",
    type: typeof parameters.type === "string" ? parameters.type : "",
  });
  if (!confirmation.success) redirect("/login?status=expired");
  const next = safeNext(typeof parameters.next === "string" ? parameters.next : undefined);

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="confirm-title">
        <div className="brand">Atelier Aurelia</div>
        <div className="eyebrow">Secure sign-in</div>
        <h1 id="confirm-title">Continue to the Studio.</h1>
        <p className="lede">Confirm this sign-in in the browser where you opened your private link.</p>
        <form className="auth-form" action="/auth/confirm/complete" method="post">
          <input type="hidden" name="token_hash" value={confirmation.data.token_hash} />
          <input type="hidden" name="type" value={confirmation.data.type} />
          <input type="hidden" name="next" value={next} />
          <button className="primary" type="submit">Continue to Studio →</button>
        </form>
        <p className="auth-note">This one-time link is consumed only after you continue.</p>
      </section>
    </main>
  );
}
