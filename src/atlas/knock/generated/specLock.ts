/**
 * The three documents the Knock atlas's surface map is compiled from, pinned by digest, and every census
 * number a regeneration must reproduce.
 *
 * Hand-written rather than generated: this is the REVIEWED boundary. `tools/generateKnockSurfaces.ts`
 * refuses to rewrite either registry when a digest or a count here disagrees with what was served, so a
 * table regenerated from whatever Knock shipped this morning is a table nobody reviewed.
 *
 * ## The two API documents are pinned by digest; the dashboard manifest is pinned by OBSERVATION
 *
 * `api.knock.app/v1/openapi` and `control.knock.app/v1/openapi` are stable addresses, so their digests are
 * a real pin: the same URL is fetched every time and a changed digest is drift the generator reports.
 *
 * `_buildManifest.js` is not, and pretending otherwise would be the mistake. Its path carries a Next.js
 * BUILD ID that moves on every deploy, so the generator reads the id out of the landing page and fetches
 * whatever that names. {@link KNOCK_DASHBOARD_MANIFEST_PIN} therefore records the id and digest that were
 * SEEN rather than the ones that must be served — drift is an observation, not a gate, for the reason
 * `atlas/twilio/specFetch.ts` gives: a hard pin here makes the atlas unbuildable the day Knock ships.
 *
 * What stays hard is the ROUTE census. A deploy may move the build id freely; one that changes how many
 * routes the dashboard has, or how many of them no API backs, fails the generator and asks for a human.
 *
 * ## None of the three needs a credential
 *
 * All three are served unauthenticated from Knock's own hosts, take no key, and return nothing about this
 * organisation. So the whole surface map is compilable — and republishable — by an installation holding no
 * Knock account, which is what makes `slopweaver atlas knock sync` an offline verb.
 */
import type { KnockApi } from "../surfaceNaming.js";

/** One pinned document: where it is served, and the bytes that were reviewed. */
export interface KnockSpecPin {
  readonly api: KnockApi;
  readonly byteLength: number;
  readonly sha256: string;
  readonly url: string;
}

/**
 * Knock's two published OpenAPI documents, as served when the lock was cut.
 *
 * Both are named by Knock's own documentation — `/api-reference/overview/openapi` and
 * `/mapi-reference/overview/openapi` — rather than discovered, so this atlas is reading the artifact the
 * vendor points its own integrators at.
 */
export const KNOCK_SPEC_PINS: Readonly<Record<KnockApi, KnockSpecPin>> = {
  data: {
    api: "data",
    byteLength: 308_559,
    sha256: "beb73639c6eb3a785e2074083f539cc444ea1b8b98d395e04126e4ccf09181d2",
    url: "https://api.knock.app/v1/openapi",
  },
  management: {
    api: "management",
    byteLength: 447_022,
    sha256: "9eb860894c798578d4a1af1d89adf42fcd5e7ca95194d709883df3c6fded7c1b",
    url: "https://control.knock.app/v1/openapi",
  },
};

/**
 * The dashboard route table's source, and what was seen at it.
 *
 * `buildId` and `sha256` describe the deploy this atlas last compiled from. They are reported when they
 * move and never enforced — see this file's header.
 */
export const KNOCK_DASHBOARD_MANIFEST_PIN = {
  /** The build id the landing page named when this table was compiled. Moves on every Knock deploy. */
  buildId: "HyftbuwlLzQG_GZ7ebguU",
  byteLength: 21_925,
  /** Where the build id is read from — an unauthenticated page that serves the sign-in client. */
  landingUrl: "https://dashboard.knock.app/",
  sha256: "6043ed6dad136e7bf3abddc66fa76572d333350359b599359e3a58dfaae2c3a1",
} as const;

/**
 * What one pinned OpenAPI document declares, asserted before a row is written.
 * @internal
 */
export interface KnockSpecCensus {
  readonly deprecated: number;
  readonly getOperations: number;
  readonly operations: number;
  readonly paths: number;
  readonly schemas: number;
  /**
   * Operation ids whose uniqueness Knock's own generator manufactured with a trailing ` (2)`. Asserted
   * because it is the evidence for this atlas keying on `<METHOD> <path>` instead — see `surfaceRow.ts`.
   */
  readonly suffixedOperationIds: number;
  /** Distinct values of the FIRST tag on an operation — what a row carries. */
  readonly firstTags: number;
  /** Distinct values across every tag any operation declares, first or not. */
  readonly tags: number;
}

/**
 * What each document declared when the lock was cut.
 *
 * Every number is asserted rather than described. A Knock release that adds, retires or renames anything
 * fails the generator, which is what makes reviewing the diff the act that admits a change.
 * @internal
 */
export const KNOCK_SPEC_CENSUS: Readonly<Record<KnockApi, KnockSpecCensus>> = {
  data: {
    deprecated: 12,
    getOperations: 39,
    operations: 118,
    paths: 93,
    schemas: 146,
    firstTags: 16,
    suffixedOperationIds: 8,
    tags: 20,
  },
  management: {
    deprecated: 0,
    getOperations: 47,
    operations: 98,
    paths: 75,
    schemas: 218,
    firstTags: 25,
    suffixedOperationIds: 0,
    tags: 25,
  },
};

/**
 * What the dashboard's own route table declared, and how much of it no published operation backs.
 *
 * `unbackedRoutes` is arithmetic rather than an assertion: each route is mapped to an atlas kind by
 * `kinds.ts` and the kind is matched against the operation registry. 55 of 154 is what that came to on
 * the lock's cut — but that total counts every sign-in page, OAuth callback and error route, which have no API
 * behind them necessarily and uninterestingly.
 *
 * **The number that means something is `unbackedWalkPages`: 19 of the 57 account- and environment-scoped
 * pages a walk actually visits.** Those are real product surfaces with no API behind them — the Agents
 * workspace, the audit log, the API keys page and the service tokens page among them — and it is the
 * figure `gaps.ts` opens a row for and the one `atlas knock report` leads with.
 * @internal
 */
export const KNOCK_ROUTE_CENSUS = {
  /** Every route whose subject NO callable operation reads, sign-in and callback routes included. */
  unbackedRoutes: 55,
  /** The 57 pages a walk visits, minus the ones an API backs — the figure that means something. */
  unbackedWalkPages: 19,
  /** Account- and environment-scoped routes a walk can address: the walk's own denominator. */
  walkPages: 57,
  /** Routes whose only parameters are the account slug and the environment, so a walk can address them. */
  walkableRoutes: 79,
  /** Every route pattern the manifest declares, `_next` chunks excluded. */
  routes: 154,
  byScope: { account: 36, auth: 12, environment: 94, integration: 8, internal: 4 },
} as const;

/**
 * What this atlas decided to DO with the 216 declared operations, and where each templated read's
 * identifiers come from. Both are asserted, so a Knock release that changes either fails the generator.
 *
 * The two numbers worth reading are on the same line as each other. **37 operations — 9 of them GETs —
 * need an identifier NEITHER document produces**, and eight of those nine are the objects tree: no
 * operation on either API lists an account's object COLLECTIONS, so `/v1/objects/…` is addressable only by
 * a caller who already knows the collection name. **16 more need the OTHER credential**, which is the
 * cross-API dependency `surfaceRow.ts` exists to record — reaching an audience's members or triggering a
 * workflow by key needs a data-API key to call and a Management API service token to learn what to call it
 * with, and no single page of Knock's own documentation says so.
 * @internal
 */
export const KNOCK_SURFACE_CENSUS = {
  dispositions: { entity: 62, excluded: 137, "probe-only": 1, "shape-index": 16 },
  identifiers: { none: 59, "other-api": 16, "same-api": 104, unavailable: 37 },
} as const;
