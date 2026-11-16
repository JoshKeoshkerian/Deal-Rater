"use client";

import { useEffect } from "react";

import { captureReferralFromUrl } from "@/lib/referral";

/** Mounted once in the root layout, so a `?ref=` link works on any page. */
export function ReferralCapture() {
  useEffect(() => {
    captureReferralFromUrl();
  }, []);
  return null;
}
