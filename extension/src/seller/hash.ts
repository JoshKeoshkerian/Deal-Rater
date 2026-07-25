/**
 * Seller pseudonymisation (spec 8.2).
 *
 * The seller's Facebook identifier is hashed here and never leaves the browser
 * in any other form. Display name, profile URL, profile photo and join date are
 * not read, not derived, and have no field to travel in.
 *
 * What this is, precisely: a pseudonym, not an anonymisation. The pepper is
 * shipped in the extension bundle and is therefore not secret — anyone with the
 * bundle and a candidate seller id can confirm a match. It is a stable
 * identifier that keeps identity out of the database, which is what 8.2 asks
 * for, and it must be stable across users and across time because the
 * longitudinal seller behaviour in 4.4 depends on it. A per-install random salt
 * would break that outright.
 *
 * HASH_VERSION exists so the pepper can be rotated. Rotating it severs the link
 * to every seller observed under the previous version; that is the cost, and it
 * is deliberate that it has to be an explicit decision.
 */

const PEPPER = "deal-rater/seller/v1/2f4c8a1d6b93e05f";

export const HASH_VERSION = 1;

/** SHA-256 of pepper + identifier, lowercase hex. */
export async function hashSellerId(sellerId: string): Promise<string> {
  const normalised = sellerId.trim();
  if (normalised === "") throw new Error("hashSellerId: empty seller id");

  const bytes = new TextEncoder().encode(`${PEPPER}:${normalised}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
