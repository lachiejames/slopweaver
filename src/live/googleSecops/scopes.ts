/**
 * Which Google scope each Google SecOps capability needs — this door's own vocabulary, read by the shared
 * helpers in `src/live/google/scopes.ts`.
 *
 * ## Exactly two scopes, and the second is the narrowest Chronicle publishes
 *
 * `chronicle.readonly` alone, on a client of its own. Of the Chronicle v1 GET methods
 * `src/atlas/googleSecops/generated/surfaces.ts` lists, the service
 * config grants 21 to `chronicle.readonly` and 18 to `cloud-platform` only, and `cloud-platform` is a
 * write-capable token over every GCP API the owner's account can reach. So the 18 stay dark until a later yes, and
 * widening this table is that yes's own pull request — `actsOnlyAsTheBoundAccount.test.ts` pins it exactly.
 *
 * `impliedBy` is empty for `chronicle`, unlike the admin table's write parents: the door's `readOnly` flag
 * refuses to store a grant carrying any scope that is not provably read-only, so a `chronicle` write grant
 * can never be present to imply anything.
 *
 * Pure: no I/O, no clock.
 */
import type { GoogleScopeTable } from "../google/scopes.js";

/** The Google SecOps capability a caller needs. One capability maps to exactly one scope URI. */
export type GoogleSecopsCapability = "chronicle" | "identity";

/** The scope URI granted for each capability. */
const GOOGLE_SECOPS_SCOPES: Readonly<Record<GoogleSecopsCapability, string>> = {
  chronicle: "https://www.googleapis.com/auth/chronicle.readonly",
  identity: "https://www.googleapis.com/auth/userinfo.email",
};

/** The Google SecOps door's scope vocabulary, in the shape every shared grant helper reads. */
export const GOOGLE_SECOPS_SCOPE_TABLE: GoogleScopeTable<GoogleSecopsCapability> = {
  identity: "identity",
  impliedBy: { chronicle: [], identity: [] },
  scopes: GOOGLE_SECOPS_SCOPES,
};

/** What a landed SecOps grant may carry: the table's two scopes, and the `openid` Google adds beside an email one. */
const STORABLE_SCOPES: ReadonlySet<string> = new Set([...Object.values(GOOGLE_SECOPS_SCOPES), "openid"]);

/**
 * Every scope in a landed grant this door did not ask for. The shared shell's `readOnly` refuses a WRITE
 * scope; this refuses a READ one wider than the table too, so the grant on disk is exactly what was asked.
 *
 * @param scopes the scope URIs Google returned
 * @returns the scopes outside the table, in the order given
 */
export function secopsScopesOutsideTable({ scopes }: { scopes: readonly string[] }): readonly string[] {
  return scopes.filter((scope) => !STORABLE_SCOPES.has(scope));
}
