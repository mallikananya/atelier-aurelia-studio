import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Atelier Aurelia Studio",
  description: "Private AI-native digital product studio",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
