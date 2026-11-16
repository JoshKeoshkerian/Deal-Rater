/** The install id used for acquisition attribution (`src/shared/install.ts`). */

import { beforeEach, describe, expect, it } from "vitest";

import { createInstallId, loadInstallId } from "../src/shared/install";

let local: Record<string, unknown> = {};

beforeEach(() => {
  local = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in local ? { [key]: local[key] } : {}),
        set: async (patch: Record<string, unknown>) => {
          Object.assign(local, patch);
        },
      },
    },
  };
});

describe("install id", () => {
  it("is a random UUID, stored locally and read back", async () => {
    const id = await createInstallId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await loadInstallId()).toBe(id);
  });

  it("differs between installs", async () => {
    const first = await createInstallId();
    local = {};
    expect(await createInstallId()).not.toBe(first);
  });

  it("is absent for an install from before it existed", async () => {
    expect(await loadInstallId()).toBeNull();
  });
});
