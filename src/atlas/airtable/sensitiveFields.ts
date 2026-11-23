/**
 * The response fields this atlas withholds, named by KIND rather than by bare name.
 *
 * ## Why this table exists BEFORE the first entity does
 *
 * Nothing in this generation carries an entity yet — the account has no Airtable membership. This file is
 * still here, and reviewed, because the alternative is writing it in the same change that first fetches
 * real data, which is the change least able to review it carefully. The Datadog atlas's own lesson was that
 * the INSTRUMENT matters more than any row: an incomplete denial table is worse than a missing one, because
 * it makes the table look finished.
 *
 * ## A bare-name denylist would be wrong in BOTH directions here, and that is measured
 *
 * Scanning every schema in the pinned document for credential-shaped property names returns 23 hits.
 * Reproduce with:
 *
 * ```bash
 * yarn tsx tools/generateAirtableSurfaces.ts --verify   # confirms the document these names were read from
 * ```
 *
 * Of those 23, exactly four carry credential material. The other nineteen include `primaryKey` and
 * `foreignKey` (a HyperDB data table's own key columns), `tokenId`, `oauthAccessTokenId` and
 * `personalAccessTokenId` (identifiers, never values), `profileUrl` and `profilePicUrl` (a person's avatar),
 * and `isPasswordProtected` (a boolean about a share, not a password). Denying on the substring `key`,
 * `token` or `password` would drop all of those and keep nothing extra — the same conclusion the Datadog
 * atlas reached against its own SDK, arrived at independently on a platform a fifth of the size.
 *
 * So every denial names the field AND the kind it is denied under, and `airtableFieldIsWithheld` is the one
 * place that decision is made.
 */
import type { AirtableAtlasKind } from "./kinds.js";

/**
 * One withheld field: the name, the kinds it is withheld under, and why.
 * @internal
 */
export interface AirtableFieldDenial {
  /** The property name exactly as the response carries it. */
  readonly field: string;
  /** The kinds this name carries credential material under. Never "every kind". */
  readonly kinds: readonly AirtableAtlasKind[];
  /** Why it is material, in English, so a reader can disagree with the judgement rather than the list. */
  readonly reason: string;
}

/**
 * Every field withheld from a stored entity, and where.
 *
 * Four rows. Each names a value that grants access on its own — a signing key, a bearer-in-a-URL, or a
 * capability prefix — rather than merely describing one.
 */
export const AIRTABLE_FIELD_DENIALS: readonly AirtableFieldDenial[] = [
  {
    field: "macSecretBase64",
    kinds: ["webhook"],
    reason:
      "the HMAC key Airtable signs a webhook's pings with. Its own documentation states there is no way to" +
      " retrieve it after creation, so a copy here would be the only one anywhere and would forge a ping",
  },
  {
    field: "csvZipDownloadUrl",
    kinds: ["export-request"],
    reason:
      "a signed URL that hands over a whole eDiscovery export — every base's contents as CSV — to anyone" +
      " holding the link, with no further authentication. A capability, not an address",
  },
  {
    field: "jsonDownloadUrl",
    kinds: ["export-request"],
    reason: "the same capability URL in JSON form, and required rather than optional on a completed export",
  },
  {
    field: "shareTokenPrefix",
    kinds: ["share"],
    reason:
      "the leading segment of a publicly shared view's URL token. A share link grants ANONYMOUS read of the" +
      " view it points at, and a prefix is the half of that token an attacker cannot guess",
  },
];

/**
 * Whether one field of one kind is withheld from storage.
 *
 * @param field the property name as the response carries it
 * @param kind the kind the entity being projected belongs to
 * @returns the denial that applies, or `null` when the field may be stored
 */
export function airtableFieldIsWithheld({
  field,
  kind,
}: {
  field: string;
  kind: AirtableAtlasKind;
}): AirtableFieldDenial | null {
  const denial = AIRTABLE_FIELD_DENIALS.find((row) => row.field === field && row.kinds.includes(kind));
  if (denial === undefined) {
    return null;
  }
  return denial;
}
