/**
 * Settings, and the one migration in them.
 *
 * The API moved from *.up.railway.app to api.curbsidescore.com, and the
 * manifest's `host_permissions` moved with it. Anyone who had ever saved the
 * options page has the old URL in `chrome.storage.sync`, where it outranks the
 * default -- so without a rewrite on read, the extension would keep aiming at a
 * host it no longer has permission for.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, loadSettings } from "../src/shared/settings";

let store: Record<string, unknown> = {};

beforeEach(() => {
  store = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      sync: {
        get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...store }),
        set: async (patch: Record<string, unknown>) => {
          Object.assign(store, patch);
        },
      },
    },
  };
});

describe("the retired API host", () => {
  it("is rewritten to the current one", async () => {
    store["apiBaseUrl"] = "https://deal-rater-production.up.railway.app";

    const settings = await loadSettings();

    expect(settings.apiBaseUrl).toBe("https://api.curbsidescore.com");
  });

  it("is rewritten even with a trailing slash or a path", async () => {
    store["apiBaseUrl"] = "https://deal-rater-production.up.railway.app/";

    expect((await loadSettings()).apiBaseUrl).toBe("https://api.curbsidescore.com");
  });

  it("is written back, so the options page stops showing the dead URL", async () => {
    store["apiBaseUrl"] = "https://deal-rater-production.up.railway.app";

    await loadSettings();
    // Let the fire-and-forget write settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store["apiBaseUrl"]).toBe("https://api.curbsidescore.com");
  });
});

describe("everything else is left alone", () => {
  it("keeps a deliberate local override", async () => {
    store["apiBaseUrl"] = "http://localhost:8000";

    expect((await loadSettings()).apiBaseUrl).toBe("http://localhost:8000");
  });

  it("keeps an unparseable value rather than discarding it", async () => {
    // `apiBaseUrl` is free text on the options page. Silently replacing a typo
    // would hide the typo; the request fails visibly instead.
    store["apiBaseUrl"] = "not a url";

    expect((await loadSettings()).apiBaseUrl).toBe("not a url");
  });

  it("returns the defaults when nothing is stored", async () => {
    const settings = await loadSettings();

    expect(settings.apiBaseUrl).toBe(DEFAULT_SETTINGS.apiBaseUrl);
    expect(settings.theme).toBe("auto");
    expect(settings.enabled).toBe(true);
  });

  it("does not touch other stored settings", async () => {
    store["apiBaseUrl"] = "https://deal-rater-production.up.railway.app";
    store["theme"] = "dark";
    store["extraMetroIds"] = ["105481929470199"];

    const settings = await loadSettings();

    expect(settings.theme).toBe("dark");
    expect(settings.extraMetroIds).toEqual(["105481929470199"]);
  });
});
