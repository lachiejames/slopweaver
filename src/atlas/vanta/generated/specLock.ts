/**
 * The Vanta Manage API's own OpenAPI document, pinned by digest, and every census number a regeneration
 * must reproduce.
 *
 * Hand-written rather than generated: this is the REVIEWED boundary.
 * `tools/generateVantaEndpoints.ts` refuses to rewrite `getEndpoints.ts` when a digest or a count here
 * disagrees with what was served, so a table regenerated from whatever Vanta shipped this morning is a
 * table nobody reviewed.
 *
 * ## Why this file exists at all, and what it replaced
 *
 * Without this lock the atlas has no denominator. `inventory.ts`'s `VANTA_MANAGE_ENDPOINTS` is the list of
 * endpoints the sync CALLS, and a numerator cannot also be its own denominator — an endpoint nobody had
 * thought of was not a gap, it was an absence, and absences do not appear in coverage reports.
 *
 * MEASURED the day this landed, by compiling the document below and diffing it against the paths
 * `inventory.ts` and `census.ts` actually assemble: **107 documented GET operations, of which this atlas
 * called 24.** The eighty-three it had never been to included `GET /knowledge-base/resources`, which serves
 * every one of this organisation's policy documents as a file — the exact information a session had spent
 * the previous evening concluding the Manage API did not hold, off nine guessed 404s. Reproduce the whole
 * comparison with `yarn tsx tools/generateVantaEndpoints.ts --verify`.
 *
 * ## The document is served from the developer site, not from the API host
 *
 * `api.vanta.com` answers 404 at `/v1/openapi.json`, `/openapi.json`, `/v1/openapi`, `/v1/spec`,
 * `/swagger.json` and `/v1/swagger.json` — measured through `atlas/vanta/transport.ts`. What
 * Vanta publishes is the same document its own reference renders, at the address in {@link VANTA_SPEC_PIN},
 * and its `servers` entry is `https://api.vanta.com/v1`, which is why every path below is written WITHOUT
 * the `/v1` prefix the transport adds.
 *
 * ## Reproduce every number here
 *
 * ```bash
 * yarn tsx tools/generateVantaEndpoints.ts --verify   # fetch, check the pin and the census
 * yarn tsx tools/generateVantaEndpoints.ts            # rewrite ./getEndpoints.ts and review the diff
 * ```
 *
 * ## The one re-pin so far, and what it is evidence OF
 *
 * The pin moved once, and the movement was reviewed operation by operation rather than
 * accepted on the strength of the counts. Vanta added exactly one operation — `PATCH /groups/{groupId}`
 * (`UpdateGroup`) — and four component schemas nothing references yet: `ProgramScope`, `BusinessUnit` and a
 * paginated envelope for each. **Every one of the 107 GET operations was byte-identical**, so the
 * denominator this file exists to hold did not move at all; `operations` went 240 → 241 and `getOperations`
 * stayed at 107. Reproduce the comparison by diffing the two documents' `paths[*].get` objects.
 *
 * Two things follow that are worth stating rather than rediscovering. The first is that a re-pin is a
 * REVIEW, not a refresh: the counts agreeing would have been satisfied by a GET being swapped for a GET.
 * The second is that those two unreferenced schemas are a denominator about to GROW — Vanta stages a shape
 * before it publishes the endpoint that returns it — and an earlier ruling already settled that a grown denominator is
 * recorded rather than refused.
 */

/** Where the document is served and the bytes that were reviewed.
 * @internal
 */
export const VANTA_SPEC_PIN = {
  byteLength: 1_057_873,
  /** The OpenAPI version the document declares. */
  openapi: "3.0.0",
  sha256: "4f51bc9619c413b4443f2dbb6923ba4a3305910b326a52aa304f92564f6e62b9",
  /** The one address ever fetched. No caller assembles this. */
  url: "https://developer.vanta.com/reference/manage-vanta.json",
} as const;

/**
 * What the pinned document declares, asserted before a row is written.
 *
 * `getOperations` is the number this whole file exists for: it is the DENOMINATOR every coverage claim
 * about the Manage API channel is divided by.
 */
export const VANTA_SPEC_CENSUS = {
  /** Every GET operation, whatever this atlas does with it. */
  getOperations: 107,
  /** Every operation of every method, so a document that grew elsewhere is still visible. */
  operations: 241,
  /** Every key under `paths`. */
  paths: 171,
} as const;

/**
 * How many rows carry each disposition, so a row changing SIDE fails the generator rather than passing a
 * total that did not move.
 *
 * `notFetched` is deliberately non-zero and is what `atlas-content-coverage` refuses beyond its recorded
 * debt: this atlas has never been to those endpoints, and the honest shape of that is a number that has to
 * come down rather than a silence.
 */
export const VANTA_DISPOSITION_CENSUS = {
  coveredByList: 19,
  entitlementRefused: 3,
  notFetched: 39,
  synced: 46,
} as const;
