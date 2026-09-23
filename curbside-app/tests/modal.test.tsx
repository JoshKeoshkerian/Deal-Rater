import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/Modal";

/**
 * Regression coverage for the confirmed live bug: Tab from "Got it" used to
 * escape the dialog into the page behind it (no focus trap at all), and focus
 * was never returned to whatever opened the dialog on close.
 *
 * Was `coming-soon-dialog.test.tsx` against `ComingSoonDialog`, renamed
 * alongside the component once billing became real -- the focus-management
 * behaviour under test never had anything to do with "coming soon" copy.
 */
describe("Modal focus handling", () => {
  it("moves focus to the dismiss button on open", () => {
    render(
      <Modal title="A title" onClose={vi.fn()}>
        <p>Some content.</p>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Got it" })).toHaveFocus();
  });

  it("wraps Tab back to the first focusable element instead of leaving the dialog", () => {
    render(
      <Modal title="A title" onClose={vi.fn()}>
        <p>Some content.</p>
      </Modal>,
    );
    const dismiss = screen.getByRole("button", { name: "Got it" });
    expect(dismiss).toHaveFocus();

    // Only one focusable element in this dialog's content (the dismiss
    // button itself) — Tab should keep focus right there, not let it fall
    // through to something outside the dialog.
    fireEvent.keyDown(dismiss, { key: "Tab" });
    expect(dismiss).toHaveFocus();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal title="A title" onClose={onClose}>
        <p>Some content.</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to whatever was focused before the dialog opened", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <Modal title="A title" onClose={() => setOpen(false)}>
              <p>Some content.</p>
            </Modal>
          )}
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("button", { name: "Got it" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger).toHaveFocus();
  });

  it("renders no trailing button when dismissLabel is null", () => {
    render(
      <Modal title="A title" onClose={vi.fn()} dismissLabel={null}>
        <button type="button">Only action</button>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Only action" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Got it" })).not.toBeInTheDocument();
  });
});
