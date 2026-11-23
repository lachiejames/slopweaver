/**
 * What this atlas's operation registry is generated from, pinned by extraction path, digest and census.
 *
 * ## The authority is Airtable's OWN OpenAPI document, and it is not published as a file
 *
 * Airtable ships no downloadable specification, no versioned SDK covering its whole Web API, and no
 * `openapi.json` at any address — MEASURED: `airtable.com/developers/web/api/openapi.json`,
 * `…/spec.json` and `airtable.com/developers/sitemap.xml` all answer 404 with the marketing shell, and the
 * public sitemap lists exactly two Web API pages (`authentication`, `scopes`) because the reference itself
 * is client-rendered. The official `airtable` npm package covers the records API alone and would have
 * produced a registry missing every meta, enterprise, SCIM, webhook and share operation.
 *
 * What Airtable DOES publish is the complete document, server-rendered into every page of its own reference
 * at `window.initData.openApi`. That is the artifact this registry is generated from, and it is the same
 * bytes the reference itself renders — an undocumented delivery route for a documented thing, which
 * `kit/contract.ts` says an atlas must use rather than refuse.
 *
 * ## `info.version` is `"0"`, so the DIGEST is the pin
 *
 * Airtable does not version this document. {@link AIRTABLE_SPEC_PIN.sha256} is the SHA-256 of its canonical
 * JSON — keys sorted, no whitespace — so it identifies the document exactly while surviving the key
 * ordering of whatever serialiser produced it. The bundle it arrives in is keyed by a rotating build sha,
 * which is why the pin is on the SPEC and not on the bundle: a re-run that finds a different digest has
 * found a real change to Airtable's API surface, and that is a diff to review rather than an error.
 *
 * ## What a digest match does and does not prove
 *
 * It proves the document is byte-for-byte the one that was reviewed. It does NOT prove Airtable's Web API
 * is exactly these 103 operations — the browser surface exists precisely because a first-party client
 * reaches things a published surface does not declare, and on this platform the interface, automation and
 * view-configuration surfaces are known to be among them. So the registry has a NAMED shortfall rather than
 * a silent one, and `descriptor.ts` states it.
 *
 * ## Reproduce every number here
 *
 * ```bash
 * yarn tsx tools/generateAirtableSurfaces.ts --verify   # fetch, extract, and check the pin and census
 * yarn tsx tools/generateAirtableSurfaces.ts            # rewrite ./surfaces.ts and review the diff
 * ```
 */

/** Where the document is fetched from and how it is found inside the page. */
export const AIRTABLE_SPEC_PIN = {
  /** The JSON island the document sits in, as a dotted path from `window`. */
  islandPath: "initData.openApi",
  /** The OpenAPI version the document declares. */
  openapi: "3.1.0",
  /** SHA-256 of the document under `src/lib/stableStringify.ts` — recursively key-sorted, no whitespace. */
  sha256: "19249ce19bc9a3bdde599f36a48f519746fdc4451c49d424332daa3850547724",
  /** Any page of the reference renders the whole document; this is the one the generator asks for. */
  sourceUrl: "https://airtable.com/developers/web/api/introduction",
  /** The single API host every operation is relative to, from the document's own `servers`. */
  server: "https://api.airtable.com",
  /** What the document calls itself. Airtable ships `"0"` here, which is why the digest is the pin. */
  version: "0",
} as const;

/**
 * The census the generator asserts before it writes a single row.
 *
 * It is not decoration. The Datadog registry's own census caught a lookahead in an extraction regex that
 * silently lost one operation out of 1,735, and an extraction that quietly returns 102 of 103 is
 * indistinguishable from an API that shrank.
 */
export const AIRTABLE_SPEC_CENSUS = {
  /** How many operations declare a `deprecated` flag. Airtable marks none, which is itself worth pinning. */
  deprecatedOperations: 0,
  /** Operations by HTTP method, which is what makes the 71 refusals arithmetic rather than a claim. */
  methodCounts: { DELETE: 19, GET: 31, PATCH: 15, POST: 33, PUT: 5 },
  /** Distinct `operationId`s. Equal to `operations`, which is what makes the id usable as a surface name. */
  operationIds: 103,
  operations: 103,
  paths: 75,
  /** Named schemas under `components/schemas`. */
  schemas: 41,
  /** Distinct OAuth scopes named across every operation's `security`. */
  scopes: 23,
  /** Tags the document DECLARES. One of them carries no operation — see {@link AIRTABLE_UNSERVED_TAGS}. */
  tags: 23,
  /** Tags at least one operation carries, so this is how many kinds the API surface can actually feed. */
  tagsWithOperations: 22,
} as const;

/**
 * The product surfaces Airtable's own document NAMES and publishes no operation for.
 *
 * This is a finding rather than bookkeeping, and it is the API half of the reason this atlas's browser
 * surface is mandatory. `workflow` is Airtable's noun for automations. The document declares the tag, so
 * Airtable considers automations part of this API's subject matter, and then ships zero operations under
 * it: there is no REST call that lists a base's automations, reads a trigger, or says whether one is
 * enabled. The handover for this atlas predicted exactly that — _"the browser half is where the views and
 * automations hide"_ — and the specification confirms it from the other side without a single request being
 * made.
 *
 * Every name here becomes an open gap on the `method` kind at sync time, so the atlas SAYS the surface
 * exists and that its own API channel cannot reach it, rather than being silently empty about it.
 */
export const AIRTABLE_UNSERVED_TAGS: readonly string[] = ["workflow"];

/**
 * How many operations accept each credential form, from the document's own `x-airtable-auth-methods`.
 *
 * Pinned separately from the census because it is the number a reader is most likely to act on: 64 of the
 * 103 operations still accept the DEPRECATED user API key, so a legacy integration holding one can reach
 * roughly two thirds of this surface. That is a security fact the atlas can state for free, and a drop in
 * this number is Airtable retiring the key on a family — a change worth seeing in a diff.
 */
export const AIRTABLE_AUTH_METHOD_CENSUS = {
  oauthAccessToken: 99,
  personalAccessToken: 103,
  userApiKey: 64,
} as const;
