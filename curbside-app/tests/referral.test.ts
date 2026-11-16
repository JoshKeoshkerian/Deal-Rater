import { afterEach, describe, expect, it } from "vitest";

import { captureReferralFromUrl, normalizeReferralCode, REFERRAL_COOKIE } from "@/lib/referral";

function clearCookie() {
  document.cookie = `${REFERRAL_COOKIE}=; Path=/; Max-Age=0`;
}

describe("referral links", () => {
  afterEach(() => {
    clearCookie();
    window.history.replaceState(null, "", "/");
  });

  it("normalizes codes and rejects junk", () => {
    expect(normalizeReferralCode(" abcd2345 ")).toBe("ABCD2345");
    expect(normalizeReferralCode("ABCD234O")).toBeNull();
    expect(normalizeReferralCode("short")).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });

  it("stores ?ref= in the cookie and strips it from the address bar", () => {
    window.history.replaceState(null, "", "/pricing?utm_source=x&ref=abcd2345#faq");
    expect(captureReferralFromUrl()).toBe("ABCD2345");
    expect(document.cookie).toContain(`${REFERRAL_COOKIE}=ABCD2345`);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/pricing?utm_source=x#faq",
    );
  });

  it("drops a malformed code without setting anything", () => {
    window.history.replaceState(null, "", "/?ref=<script>");
    expect(captureReferralFromUrl()).toBeNull();
    expect(document.cookie).not.toContain(REFERRAL_COOKIE);
    expect(window.location.search).toBe("");
  });

  it("does nothing without a ref parameter", () => {
    window.history.replaceState(null, "", "/?utm_source=x");
    expect(captureReferralFromUrl()).toBeNull();
    expect(window.location.search).toBe("?utm_source=x");
  });
});
