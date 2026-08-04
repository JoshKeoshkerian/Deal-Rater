import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account",
  description: "Your Curbside plan, remaining checks and billing history.",
  // Somebody's plan and balance has no business in a search index.
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
