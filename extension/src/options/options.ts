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
  const save = byId<HTMLButtonElement>("save");
  const saved = byId<HTMLSpanElement>("saved");

  const settings = await loadSettings();
  apiBaseUrl.value = settings.apiBaseUrl;
  enabled.checked = settings.enabled;
  devMode.checked = settings.devMode;

  save.addEventListener("click", async () => {
    await saveSettings({
      apiBaseUrl: apiBaseUrl.value.trim().replace(/\/$/, ""),
      enabled: enabled.checked,
      devMode: devMode.checked,
      disclosureAcceptedAt: settings.disclosureAcceptedAt ?? new Date().toISOString(),
    });
    saved.hidden = false;
    setTimeout(() => {
      saved.hidden = true;
    }, 2000);
  });
}

void init();
