import Link from "next/link";
import type { ReactNode } from "react";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Atelier Aurelia</div>
        <nav className="nav" aria-label="Primary navigation">
          <Link href="/studio">Studio</Link>
          <Link href="/products">Products</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <form className="sign-out" action="/auth/logout" method="post">
          <button className="pill" type="submit">Sign out</button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
