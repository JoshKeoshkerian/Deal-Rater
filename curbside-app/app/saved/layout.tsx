import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Saved evaluations",
  description: "The Marketplace listings you saved from the Curbside extension.",
  // A signed-in list of somebody's saved cars has no business in a search
  // index. This used to be set on the root layout, which was correct when the
  // whole site was this one page and wrong once the landing page joined it.
  robots: { index: false, follow: false },
};

export default function SavedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
