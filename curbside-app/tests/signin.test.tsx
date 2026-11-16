import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignIn } from "@/components/SignIn";
import { suggestEmail, webmailFor } from "@/lib/signin-helpers";

const requestSignInCode = vi.fn();
const verifySignInCode = vi.fn();
const setUser = vi.fn();

vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {
    status = 0;
  },
  requestSignInCode: (...args: unknown[]) => requestSignInCode(...args),
  verifySignInCode: (...args: unknown[]) => verifySignInCode(...args),
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ setUser }),
}));

const USER = { id: 1, email: "buyer@gmail.com", created_at: "2026-11-15T00:00:00Z" };

beforeEach(() => {
  requestSignInCode.mockReset().mockResolvedValue({});
  verifySignInCode.mockReset().mockResolvedValue({ user: USER });
  setUser.mockReset();
});

async function sendCode(address = "buyer@gmail.com") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  });
}

describe("sign-in", () => {
  it("shows no code box until the email has been sent", async () => {
    render(<SignIn initialEmail={null} initialCode={null} />);
    expect(screen.queryByLabelText("Code from the email")).toBeNull();

    await sendCode();

    expect(requestSignInCode).toHaveBeenCalledWith("buyer@gmail.com");
    expect(screen.getByText("Check your email")).toBeTruthy();
    expect(screen.getByLabelText("Code from the email")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByRole("link", { name: /Open Gmail/ }).getAttribute("href")).toContain(
      "mail.google.com",
    );
  });

  it("refuses an invalid address without calling the server", async () => {
    render(<SignIn initialEmail={null} initialCode={null} />);
    await sendCode("nope");
    expect(requestSignInCode).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Enter your email");
  });

  it("formats the code and signs in as soon as it is complete", async () => {
    const onSignedIn = vi.fn();
    render(<SignIn initialEmail={null} initialCode={null} onSignedIn={onSignedIn} />);
    await sendCode();

    const box = screen.getByLabelText("Code from the email") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "abcd" } });
    expect(box.value).toBe("ABCD");
    expect(verifySignInCode).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.change(box, { target: { value: "abcd-2345" } });
    });
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(USER));
    expect(verifySignInCode).toHaveBeenCalledWith("buyer@gmail.com", "ABCD2345");
  });

  it("goes back to the email, prefilled, on Change", async () => {
    render(<SignIn initialEmail={null} initialCode={null} />);
    await sendCode();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("buyer@gmail.com");
  });
});

describe("helpers", () => {
  it("suggests fixes for common domain typos", () => {
    expect(suggestEmail("jo@gmial.com")).toBe("jo@gmail.com");
    expect(suggestEmail("jo@gmail.com")).toBeNull();
  });

  it("knows the big webmail providers", () => {
    expect(webmailFor("a@hotmail.com")?.label).toBe("Open Outlook");
    expect(webmailFor("a@company.com")).toBeNull();
  });
});
