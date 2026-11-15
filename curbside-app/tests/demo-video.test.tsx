import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DemoVideo, DemoVideoButton } from "@/components/DemoVideo";

const track = vi.fn();
vi.mock("@vercel/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));

/**
 * The embed must stay a plain image until someone asks for the video: a
 * YouTube iframe on first paint costs ~1MB and sets cookies for every visitor.
 */
describe("DemoVideo", () => {
  it("renders only a poster until play is clicked", () => {
    const { container } = render(<DemoVideo />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/video/demo-poster.webp");
  });

  it("swaps in an autoplaying no-cookie iframe on click, and records the play", () => {
    track.mockClear();
    const { container } = render(<DemoVideo location="demo-section" />);
    fireEvent.click(screen.getByRole("button", { name: /play video/i }));

    const src = container.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src).toContain("https://www.youtube-nocookie.com/embed/CEtO2R7D0hg");
    expect(src).toContain("autoplay=1");
    expect(track).toHaveBeenCalledWith("demo_play", { location: "demo-section" });
  });
});

describe("DemoVideoButton", () => {
  it("opens the player in a dialog and closes it again", () => {
    render(<DemoVideoButton location="hero" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /watch the demo/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("iframe")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape", () => {
    render(<DemoVideoButton />);
    fireEvent.click(screen.getByRole("button", { name: /watch the demo/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
