import { loadSettings, saveSettings } from "../shared/settings";

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

async function init(): Promise<void> {
  const apiBaseUrl = byId<HTMLInputElement>("apiBaseUrl");
  const enabled = byId<HTMLInputElement>("enabled");
  const devMode = byId<HTMLInputElement>("devMode");
  const extraMetroIds = byId<HTMLTextAreaElement>("extraMetroIds");
  const save = byId<HTMLButtonElement>("save");
  const saved = byId<HTMLSpanElement>("saved");

  const settings = await loadSettings();
  apiBaseUrl.value = settings.apiBaseUrl;
  enabled.checked = settings.enabled;
  devMode.checked = settings.devMode;
  extraMetroIds.value = settings.extraMetroIds.join("\n");

  save.addEventListener("click", async () => {
    await saveSettings({
      apiBaseUrl: apiBaseUrl.value.trim().replace(/\/$/, ""),
      enabled: enabled.checked,
      devMode: devMode.checked,
      // Kept to forms Marketplace actually accepts: a 15-digit place id or a
      // vanity slug. A 16-digit number is neither, and Facebook answers an
      // unrecognised location by silently returning the account's own metro --
      // which looks exactly like a market with nothing in it.
      extraMetroIds: extraMetroIds.value
        .split(/[\s,]+/)
        .map((id) => id.trim().toLowerCase())
        .filter((id) => /^(?:[0-9]{15}|[a-z][a-z0-9-]{2,40})$/.test(id)),
      disclosureAcceptedAt: settings.disclosureAcceptedAt ?? new Date().toISOString(),
    });
    saved.hidden = false;
    setTimeout(() => {
      saved.hidden = true;
    }, 2000);
  });
}

void init();
