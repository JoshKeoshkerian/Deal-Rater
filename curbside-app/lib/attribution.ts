/**
 * Install attribution for the welcome page (`app/welcome`).
 *
 * The extension opens `/welcome?install_id=<random uuid>` once, on first
 * install. This joins that id with the visitor's first-touch UTMs, which
 * `public/utm.js` keeps in localStorage under `cs_utm` as
 * `{ params: { utm_source, ... }, ts }`. No `cs_utm` means organic/direct, and
 * is reported as nulls. See `backend/app/attribution.py`.
 */

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type InstallAttribution = {
  install_id: string;
  landed_at: string | null;
} & Record<(typeof UTM_KEYS)[number], string | null>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The body to report, or null when the URL carries no valid install id. */
export function buildInstallAttribution(
  search: string,
  storedUtm: string | null,
): InstallAttribution | null {
  const installId = new URLSearchParams(search).get("install_id");
  if (!installId || !UUID_RE.test(installId)) return null;

  let params: Record<string, unknown> = {};
  let ts: unknown = null;
  try {
    const parsed = storedUtm ? (JSON.parse(storedUtm) as { params?: unknown; ts?: unknown }) : null;
    if (parsed && typeof parsed.params === "object" && parsed.params !== null) {
      params = parsed.params as Record<string, unknown>;
      ts = parsed.ts;
    }
  } catch {
    /* unreadable cs_utm: treat as organic */
  }

  const body = { install_id: installId.toLowerCase(), landed_at: null } as InstallAttribution;
  for (const key of UTM_KEYS) {
    const value = params[key];
    body[key] = typeof value === "string" && value ? value : null;
  }
  if (typeof ts === "number" && Number.isFinite(ts) && UTM_KEYS.some((k) => body[k])) {
    body.landed_at = new Date(ts).toISOString();
  }
  return body;
}
