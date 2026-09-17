export default function AccessDeniedPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="access-title">
        <div className="brand">Atelier Aurelia</div>
        <div className="eyebrow">Private studio</div>
        <h1 id="access-title">Owner access required.</h1>
        <p className="lede">This account does not have access to the Studio. Sign out and use the email address invited as the account owner.</p>
        <form className="sign-out" action="/auth/logout" method="post">
          <button className="primary" type="submit">Sign out</button>
        </form>
      </section>
    </main>
  );
}
