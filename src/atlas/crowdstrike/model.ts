/**
 * The CrowdStrike Falcon atlas's own vocabulary: what it holds, and the two surfaces it holds it from.
 *
 * ## Ten kinds, each earning its place by being a thing a question is asked about
 *
 * The count is what the inventory produced, not a target it was steered to. `host-group` is the kind most
 * easily mistaken for a field on `host`, and it is not: a policy attaches to GROUPS, so "which machines
 * does this prevention policy actually cover" is unanswerable without it, and that is the ISO question.
 *
 * `detection` reads the Alerts API: the tenant's Detections scope covers endpoints CrowdStrike has
 * decommissioned, and their live replacement sits behind a separately granted Alerts scope. The API client
 * carries every grantable read scope, so `/alerts/queries/alerts/v2` answers once that Alerts scope is granted.
 *
 * ## Why the browser kinds are two, not one
 *
 * `console-page` is a place a human can be sent — one row per declared console route, carrying the exact
 * URL a screenshot was taken at. `console-request` is what the first-party client ASKED FOR while that page
 * rendered, reduced to method, path shape and response field names. They answer different questions
 * ("where do I look at this" versus "what does the console itself read"), and a browser-observed request is
 * evidence that Falcon HOLDS something, never that this installation may ask for it — see
 * {@link CROWDSTRIKE_CALLABILITY}.
 */
import { KIT_GAP_CONDITIONS } from "../kit/gaps.js";

/** Schema version of every CrowdStrike kind file and manifest. Bump forces an archive-and-resync. */
export const CROWDSTRIKE_SCHEMA_VERSION = 1;

/** The platform name, used by the registry, the store paths and every coverage cell. */
export const CROWDSTRIKE_PLATFORM = "crowdstrike";

/**
 * Every kind this atlas stores. Closed, and the same tuple the descriptor, the store spec and the read
 * adapter must all agree on — nothing in the kit checks that alignment, so a test does.
 */
export const CROWDSTRIKE_KINDS = [
  "host",
  "host-group",
  "prevention-policy",
  "sensor-update-policy",
  "vulnerability",
  "zero-trust-assessment",
  "zero-trust-audit",
  "detection",
  "console-page",
  "console-request",
] as const;

export type CrowdstrikeKind = (typeof CROWDSTRIKE_KINDS)[number];

/**
 * The two surfaces, named as the descriptor names them.
 *
 * `falcon-api` is the scoped OAuth2 client; `falcon-console` is a real browser driven over the owner's own
 * signed-in session. They are surfaces of ONE platform, never two atlases.
 */
export const CROWDSTRIKE_SURFACES = ["falcon-api", "falcon-console"] as const;

export type CrowdstrikeSurface = (typeof CROWDSTRIKE_SURFACES)[number];

/**
 * Whether an observation names something this installation can go and ask for again.
 *
 * The distinction exists because the Falcon console calls endpoints the scoped API client cannot reach —
 * its own host list is `/api2/devices/queries/fga-hosts/v1`, which has no public equivalent and which needs
 * a bearer the page holds in memory. Recording that traffic is useful; implying the bot can invoke it is
 * the "does not yet support reading the policies" failure in a new place. Every stored observation carries
 * one of these, and only `executable` may back a capability the router offers.
 *
 * @internal
 */
export const CROWDSTRIKE_CALLABILITY = ["executable", "browser-observed-only"] as const;

/** @internal */
export type CrowdstrikeCallability = (typeof CROWDSTRIKE_CALLABILITY)[number];

/**
 * The Falcon API scope a call needs, spelled as the console's own picker spells it.
 *
 * These are the STRINGS a coverage reason quotes when a call is refused, so they are the provider's
 * vocabulary rather than ours — a reader who sees `hosts:read` in a refusal can find that row in the
 * console without translating.
 */
const CROWDSTRIKE_SCOPES = [
  "alerts:read",
  "devices:read",
  "host-group:read",
  "prevention-policies:read",
  "sensor-update-policies:read",
  "spotlight-vulnerabilities:read",
  "zero-trust-assessment:read",
] as const;

export type CrowdstrikeScope = (typeof CROWDSTRIKE_SCOPES)[number];

/**
 * Every condition a CrowdStrike gap can carry. Closed, so a recheck can match a stored gap exactly.
 *
 * The vocabulary is this platform's own — the kit deliberately owns only the two conditions that concern
 * the relationship BETWEEN surfaces, because those are part of what an atlas IS. Three members here are
 * worth naming: `scope-refused` records a working credential that may not see something, `route-absent`
 * records a 404 that cannot distinguish a decommissioned endpoint from an unprovisioned product, and
 * `cross-atlas-disagreement` records CrowdStrike and another atlas disagreeing about one machine, which is
 * the reconciliation report's own output rather than a failure of this sync.
 */
export const CROWDSTRIKE_GAP_CONDITIONS = [
  "scope-refused",
  "route-absent",
  "incomplete-read",
  "auth-failed",
  "transport-exhausted",
  "schema-drift",
  "deep-link-unverified",
  "console-page-unreachable",
  "console-page-unphotographed",
  "console-response-body-lost",
  "cross-atlas-disagreement",
  // Kit-owned: corroboration between surfaces is part of what an atlas is, so every atlas raises these in
  // the same words.
  ...KIT_GAP_CONDITIONS,
] as const;

export type CrowdstrikeGapCondition = (typeof CROWDSTRIKE_GAP_CONDITIONS)[number];

/**
 * Whether a kind is currently expected to be reachable with the scopes this installation holds.
 *
 * Not a coverage state — coverage is measured per run from what the provider actually answered. This is the
 * atlas's PRIOR, used to tell "the sync did not run" from "the sync ran and this was refused", and to keep
 * a release probe honest about how many kinds should be synced.
 *
 * Every kind is currently expected. That is a measured claim rather than an optimistic default: every API kind returned HTTP 200 when measured live, and both console kinds are produced by the
 * walk rather than by a scope. Reproduce the API half with `slopweaver crowdstrike sync --dry-run`.
 *
 * @param kind the kind to judge
 * @returns whether a successful sync is expected to produce entities for it
 */
export function isExpectedReachable({ kind }: { kind: CrowdstrikeKind }): boolean {
  return CROWDSTRIKE_KINDS.includes(kind);
}

/**
 * The console origin that pairs with an API host, derived rather than configured.
 *
 * Falcon's two hosts differ by exactly one label — `api.us-2.crowdstrike.com` against
 * `falcon.us-2.crowdstrike.com` — and every alert the Alerts API returned carried a `falcon_host_link` on the
 * second, which is what confirms the derivation rather than a guess. Deriving it means the region is
 * configured ONCE, in the credential, rather than in two places that can disagree.
 *
 * @param apiHost the normalised `https://api.<region>.crowdstrike.com` origin
 * @returns the matching console origin, or `null` when the host is not shaped like a Falcon API host
 */
export function crowdstrikeConsoleOrigin({ apiHost }: { apiHost: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(apiHost);
  } catch {
    return null;
  }
  if (!parsed.hostname.startsWith("api.") && parsed.hostname !== "api.crowdstrike.com") {
    return null;
  }
  return `https://falcon.${parsed.hostname.slice("api.".length)}`;
}
