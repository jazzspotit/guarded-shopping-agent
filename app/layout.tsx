import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Guarded Shopping Agent",
  description: "Give an AI a budget, not your card. Channel3 product search + PayPal checkout with enforced guardrails.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
