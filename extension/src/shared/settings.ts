export interface Settings {
  /** Where captures are posted. No default production host is baked in. */
  apiBaseUrl: string;
  /** Master off switch. When false the trigger button is not mounted at all. */
  enabled: boolean;
  /** Adds the fixture-snapshot control used to build the regression corpus. */
  devMode: boolean;
  /** Set once the user has read the disclosure in spec 8.3. */
  disclosureAcceptedAt: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: "http://localhost:8000",
  enabled: true,
  devMode: false,
  disclosureAcceptedAt: null,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}
