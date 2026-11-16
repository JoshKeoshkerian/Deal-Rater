"use client";

import { useEffect } from "react";

import { reportInstall } from "@/lib/api";
import { buildInstallAttribution } from "@/lib/attribution";

declare global {
  interface Window {
    qp?: (...args: unknown[]) => void;
  }
}

/** Reported once per page load, even under React's dev double-mount. */
let reported = false;

/**
 * On the welcome page: report this install with the ad that drove it, and tell
 * Quora an install completed. Renders nothing. Only runs when the extension
 * opened the page (`?install_id=`), so a visitor who navigates to /welcome by
 * hand is not counted as an install. Failures are silent: attribution must
 * never get in the way of onboarding.
 */
export function InstallAttribution() {
  useEffect(() => {
    if (reported) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("cs_utm");
    } catch {
      /* storage blocked: organic */
    }
    const body = buildInstallAttribution(window.location.search, stored);
    if (!body) return;
    reported = true;
    reportInstall(body).catch(() => undefined);
    window.qp?.("track", "CompleteRegistration");
  }, []);
  return null;
}
