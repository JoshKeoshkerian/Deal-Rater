import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SiteHeader } from "@/components/SiteHeader";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    status: "signed-out",
    signOut: vi.fn(),
    signOutError: null,
  }),
}));

/**
 * Regression coverage for the confirmed live bug: the mobile menu used to
 * close only on a `usePathname()` change, which never fires for a same-page
 * hash link (`/#how`), leaving the menu open over the section it just
 * "navigated" to.
 */
describe("SiteHeader mobile menu", () => {
  function openMenu() {
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
  }

  it("closes when a same-page hash link inside the panel is clicked", () => {
    render(<SiteHeader />);
    openMenu();

    const panel = document.getElementById("mobile-nav");
    expect(panel).toBeInTheDocument();

    const link = screen.getAllByRole("link", { name: "How it works" })[1];
    fireEvent.click(link);

    expect(document.getElementById("mobile-nav")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the toggle button", () => {
    render(<SiteHeader />);
    openMenu();
    expect(document.getElementById("mobile-nav")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(document.getElementById("mobile-nav")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open menu/i })).toHaveFocus();
  });
});
