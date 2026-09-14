import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Atelier Aurelia Studio",
  description: "Private AI-native digital product studio",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">Atelier Aurelia</div>
            <nav className="nav" aria-label="Primary navigation">
              <Link href="/studio">Studio</Link>
              <Link href="/products">Products</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
