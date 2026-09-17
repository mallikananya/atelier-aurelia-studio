import { safeNext } from "@/lib/auth/policy";

export const dynamic = "force-dynamic";

const messages: Readonly<Record<string, string>> = {
  sent: "If this email has access, a sign-in link is on its way. Check your inbox and open it in this browser.",
  invalid: "Enter a valid email address to request a sign-in link.",
  unavailable: "Sign-in is temporarily unavailable. Please try again shortly.",
  expired: "This sign-in link has expired or could not be verified. Request a new link below.",
  "signed-out": "You have been signed out.",
  "logout-failed": "We could not complete sign-out. Please try again.",
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "";
  const message = Object.hasOwn(messages, status) ? messages[status] : undefined;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand">Atelier Aurelia</div>
        <div className="eyebrow">Your private creative space</div>
        <h1 id="login-title">Welcome to the Studio.</h1>
        <p className="lede">Sign in with your invited email address. We’ll send you a secure link to continue.</p>
        {message && <p className="auth-message" role="status">{message}</p>}
        <form className="auth-form" action="/auth/login" method="post">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@example.com" />
          <button className="primary" type="submit">Send sign-in link →</button>
        </form>
        <p className="auth-note">The Studio is invite-only. Access is reserved for the account owner.</p>
      </section>
    </main>
  );
}
