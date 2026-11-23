/**
 * The Aether atlas's own vocabulary: what it holds, and the one surface it holds it from.
 *
 * ## This platform holds EVERYTHING REACHABLE, and the criterion is why
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? The answer here is NO. Nothing in this installation holds what a
 * third-party pentest of the organisation's in-scope targets found — which findings are open, at what severity, and
 * under which project. So this atlas holds those entities as well as the surface map, the same case Vanta,
 * JumpCloud, 1Password and CrowdStrike are in.
 *
 * ## What the CONFIRMED portal API carries, and what it does not
 *
 * MEASURED by walking the portal's own JSON API in the owner's session: `/api/findings` returns
 * the findings (paged, so the walk asks for a full page per tab), and `/api/findings/stats` returns the
 * severity/status tallies and the `sources` array — one row per project, carrying its uuid and name. Those
 * two endpoints are what this atlas reduces. The portal's in-scope TARGET list and the WORKSPACE name render
 * server-side with no JSON endpoint this walk located, so a finding links to a PROJECT, not a target, and
 * the workspace is named in `descriptor.ts`'s prose rather than stored as an entity. That boundary is a
 * `not-fetched` note on the descriptor, not a silent omission.
 *
 * Aether (app.tryaether.ai, the dvuln portal) has ONE surface this installation can reach: the owner's own
 * signed-in work Chrome. There is no API token here and no published API this atlas has wired in, so the
 * whole atlas is `driven-browser`, and it says so.
 *
 * ## One family is VOLUMINOUS, and that is a disposition rather than a store
 *
 * The Attack Surface (the discovered hosts and IP addresses) is a machine-emitted
 * inventory that grows with every scan, identified by an address rather than by a name somebody chose —
 * `docs/atlas-intent/06-holdings.md`'s voluminous criterion. It is DECLARED in `descriptor.ts`'s `excludes` so this
 * atlas can say it was looked at and deliberately not stored whole, rather than never looked at. What IS
 * stored is the pentest's own authored output — the findings and the targets they were found on.
 *
 * ## Nothing here is measured until a walk runs, and it says so
 *
 * The kinds and the surface below are the atlas's declaration. Whether this account can reach any of them is
 * a question only a walk answers, because it depends on the owner's Chrome holding a live session for
 * `app.tryaether.ai` — reproduce with `slopweaver browser cookies --origin https://app.tryaether.ai`, which
 * prints cookie names only and launches nothing. The atlas reports that as coverage rather than confidence:
 * see `descriptor.ts`.
 */
import { KIT_GAP_CONDITIONS } from "../kit/gaps.js";

/** Schema version of every Aether kind file and manifest. Bump forces an archive-and-resync. */
export const AETHER_SCHEMA_VERSION = 1;

/** The platform name, used by the registry, the store paths and every coverage cell. */
export const AETHER_PLATFORM = "aether";

/**
 * Every kind this atlas stores. Closed, and the same tuple the descriptor, the store spec and the read
 * adapter must all agree on — nothing in the kit checks that alignment, so a test does.
 *
 * `project` is an edge rather than a field on `finding` even though a finding names its project, because the
 * project carries the engagement's own facts — its uuid, and the severity/status tallies `/api/findings/stats`
 * returns — that no single finding record holds.
 *
 * `page` is the browser walk's own kind — one row per declared route the walk rendered, carrying its proof
 * screenshot and how many first-party responses it saw. The domain kinds (`project`, `finding`) are reduced
 * from the captured API response bodies; the walk never writes them without a body to reduce, and `page`
 * never carries a domain entity.
 */
export const AETHER_KINDS = ["project", "finding", "page"] as const;

export type AetherKind = (typeof AETHER_KINDS)[number];

/**
 * The one surface, named as the descriptor names it.
 *
 * `aether-portal` is the dvuln portal in the owner's own signed-in Chrome. There is no second surface: this
 * installation holds no Aether API token and Aether publishes no API this atlas has wired in, so a walk is
 * the only way the atlas is filled or stays current.
 */
export const AETHER_SURFACES = ["aether-portal"] as const;

export type AetherSurface = (typeof AETHER_SURFACES)[number];

/**
 * The severity tiers Aether's Risk Inbox uses, lowest-cardinality first.
 *
 * Aether's own words, kept verbatim so a coverage reason or a reader's filter matches the portal: the Risk
 * Inbox severity filter offers exactly Critical, High, Medium, Low and Info.
 */
export const AETHER_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

/**
 * The lifecycle states a finding moves through, as the Risk Inbox tabs name them.
 *
 * `draft`/`open`/`closed`/`ignored` are the four tabs; `retesting` is the fifth state the state filter
 * offers. Kept as the atlas's own closed list so a reduction that meets an unknown state fails loudly rather
 * than storing a word no reader can filter on.
 */
export const AETHER_FINDING_STATES = ["draft", "open", "retesting", "closed", "ignored"] as const;

export type AetherFindingState = (typeof AETHER_FINDING_STATES)[number];

/**
 * Every condition an Aether gap can carry. Closed, so a recheck can match a stored gap exactly.
 *
 * Four members are this platform's own rather than a rename of a sibling's: `session-absent` records the
 * owner's work Chrome holding no live session for the portal, which is the state a walk on a signed-out
 * browser is in and the only thing that stops a read here; `login-wall` records a walk that reached the
 * portal but landed on its sign-in form, which is `session-absent` observed from the far side; `report-print-only`
 * records that the portal's Risk Report is a print-to-PDF of `/risk-inbox/report` with no download endpoint
 * this atlas found, so the report body is not reduced; and `no-shot-adapter` records that `browser shot`
 * carries no adapter for this host, so a framed proof capture of a portal page is unavailable and the walk's
 * own raw screenshot is the only picture.
 */
export const AETHER_GAP_CONDITIONS = [
  "session-absent",
  "login-wall",
  "route-absent",
  "incomplete-read",
  "auth-failed",
  "transport-exhausted",
  "schema-drift",
  "deep-link-unverified",
  "page-unreachable",
  "page-unphotographed",
  "response-body-lost",
  "report-print-only",
  "no-shot-adapter",
  // Kit-owned: corroboration and the standing shapes every atlas raises in the same words.
  ...KIT_GAP_CONDITIONS,
] as const;

export type AetherGapCondition = (typeof AETHER_GAP_CONDITIONS)[number];

/**
 * Whether a kind is currently expected to be reachable with the access this installation holds.
 *
 * Not a coverage state — coverage is measured per run from what the walk actually rendered. This is the
 * atlas's PRIOR, used to tell "no walk has run" from "a walk ran and this route was empty".
 *
 * Every kind is expected, because the recon that seeded this atlas confirmed the owner's Chrome reaches the
 * portal authenticated and every declared route renders. A walk that finds a route empty or the session
 * gone writes coverage naming why, which is how this prior is corrected by evidence rather than by editing
 * this function.
 *
 * @param kind the kind to judge
 * @returns whether a successful walk is expected to produce entities for it
 *
 * @internal
 */
export function isExpectedReachable({ kind }: { kind: AetherKind }): boolean {
  return (AETHER_KINDS as readonly string[]).includes(kind);
}
