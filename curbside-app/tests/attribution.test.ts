import { describe, expect, it } from "vitest";

import { buildInstallAttribution } from "@/lib/attribution";

const ID = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
const stored = JSON.stringify({
  params: { utm_campaign: "test2_offer", utm_content: "web_offer" },
  ts: Date.UTC(2026, 10, 16, 10),
});

describe("buildInstallAttribution", () => {
  it("joins the install id with the stored first touch", () => {
    expect(buildInstallAttribution(`?install_id=${ID}`, stored)).toEqual({
      install_id: ID,
      utm_source: null,
      utm_medium: null,
      utm_campaign: "test2_offer",
      utm_content: "web_offer",
      utm_term: null,
      landed_at: "2026-11-16T10:00:00.000Z",
    });
  });

  it("reports organic installs as nulls", () => {
    const body = buildInstallAttribution(`?install_id=${ID}`, null);
    expect(body).toMatchObject({ install_id: ID, utm_source: null, utm_campaign: null, landed_at: null });
  });

  it("treats unreadable storage as organic", () => {
    expect(buildInstallAttribution(`?install_id=${ID}`, "{nope")?.utm_campaign).toBeNull();
  });

  it("reports nothing without a valid install id", () => {
    expect(buildInstallAttribution("", stored)).toBeNull();
    expect(buildInstallAttribution("?install_id=abc", stored)).toBeNull();
  });
});
