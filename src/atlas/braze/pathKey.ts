/**
 * The one normalisation both published channels match on.
 *
 * Two sources describe the same REST surface in different spellings, and an entity has to be the SAME entity
 * whichever one saw it. So `providerId` is `<METHOD> <key>` where the key is computed here, once, and every
 * channel keeps its own verbatim path in its own detail — a reader can still see exactly what each source
 * wrote, while the store holds one row rather than two.
 *
 * ## Every rule below exists because a real input needed it
 *
 * Measured against Braze's published reference and its official Postman collection:
 *
 * - **A host variable.** The collection writes `https://{{instance_url}}/catalogs`; the reference writes
 *   `/catalogs`. Braze's REST host is per-cluster and is a deployment fact, never part of an operation.
 * - **A query string.** `GET scim/v2/Users?filter=userName eq "user@test.com"` is what the reference's own
 *   machine-readable block contains, complete with URL-encoding and TYPOGRAPHIC quotation marks. That is a
 *   defect in Braze's page rather than a different endpoint, and the atlas records it as one
 *   (`published-path-malformed`) instead of publishing a second operation.
 * - **Internal whitespace.** The collection contains `https://{{instance_url}} /v2/subscription/status/set`
 *   — a literal space — alongside the same operation spelled correctly. Without this rule the broken copy
 *   would be reported as an operation only the collection has, which is a manufactured disagreement and
 *   exactly the kind of false finding that would make the report worthless.
 * - **Parameter NAMES.** Collapsing `{catalog_name}` to `{}` means a source that renames a placeholder
 *   cannot silently split one operation into two. The names themselves are not lost: each channel's detail
 *   keeps the path shape as that source wrote it.
 * - **A trailing slash and repeated separators.** The reference documents both `/templates/email/translations/`
 *   and `/templates/translations/email`; the first is the same operation with a trailing slash and the second
 *   is genuinely a different path. Only the first is normalised away.
 *
 * A rule that stopped being needed would be a rule that stopped firing, so `sync.ts` reports one that matches
 * nothing rather than leaving it to rot — the same posture `microsoft365/dispositions.ts` takes.
 */

/**
 * The match key for one declared path.
 *
 * @param path the path exactly as a published source wrote it, host variable and query string included
 * @returns the normalised key both channels are indexed by
 */
export function brazePathKey({ path }: { path: string }): string {
  // `!`: String.prototype.split always yields at least one element, so index 0 is never absent.
  const withoutQuery = path.split("?")[0]!;
  const withoutScheme = withoutQuery.replace(/^https?:\/\//, "");
  const withoutHostVariable = withoutScheme.replace(/\{\{[^}]*\}\}/g, "");
  const withoutSpaces = withoutHostVariable.replace(/\s+/g, "");
  const collapsedParams = withoutSpaces.replace(/\{[^}]*\}/g, "{}");
  const rooted = collapsedParams.startsWith("/") ? collapsedParams : `/${collapsedParams}`;
  const single = rooted.replace(/\/{2,}/g, "/");
  const trimmed = single.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * The provider key one operation is stored under, whichever channel saw it.
 *
 * @param method the HTTP method, in any case
 * @param path the path exactly as the source wrote it
 * @returns `<METHOD> <normalised path>`
 */
export function brazeOperationProviderId({ method, path }: { method: string; path: string }): string {
  return `${method.toUpperCase()} ${brazePathKey({ path })}`;
}

/**
 * What kind of published address this is, because the two channels are allowed different things.
 *
 * - `declaration` — Braze's `api_type` block, whose whole job is to state the endpoint address. A query
 *   string there is a defect: `GET scim/v2/Users?filter=userName eq "user@test.com"` is a usage example that
 *   has leaked into the machine-readable declaration, complete with typographic quotation marks.
 * - `request` — a Postman request URL, which is a real call and legitimately carries a query string. Flagging
 *   those was a real defect in this reader, caught by running the verb: it reported 40 disagreements that
 *   were nothing but Braze documenting its query parameters properly.
 *
 * @internal
 */
export type BrazeAddressForm = "declaration" | "request";

/**
 * Whether a published address carries something no address of its FORM should.
 *
 * Reported rather than repaired: the atlas's job is to say what the vendor published, and a silently
 * corrected path would hide a real defect in a source this repository does not control.
 *
 * @param path the path exactly as the source wrote it
 * @param form which kind of address this is, because a query string is a defect in only one of them
 * @returns what is wrong with it, or `null` when nothing is
 */
export function brazePathDefect({ path, form }: { path: string; form: BrazeAddressForm }): string | null {
  if (form === "declaration" && path.includes("?")) {
    return "carries a query string in the block that is supposed to declare the endpoint address alone";
  }
  if (/\S\s+\S/.test(path.replace(/\{\{[^}]*\}\}/g, ""))) {
    return "carries whitespace inside the address, so the URL as published does not resolve";
  }
  return null;
}
