/**
 * The Aether portal's navigation surface, and the rules a walk of it must obey.
 *
 * ## This denominator is DECLARED, not fetched, and that is the honest weakness
 *
 * Aether publishes no sitemap this atlas could measure itself against, so the list below is this
 * repository's own — and a crawler cannot prove its own completeness, so "we walked everything we declared"
 * is a claim about the declaration. Every route carries {@link AetherPortalRoute.verified}, `true` on the
 * three below because a recon session measured that it reached each one authenticated in the owner's own
 * Chrome; a walk records what each declared route actually did, so a route that stops rendering becomes
 * evidence this file is wrong rather than a silent miss.
 *
 * ## Both human PAGES and the JSON API, and why both
 *
 * The three human pages (`/home`, `/risk-inbox`, `/attack-surface`) are walked for their proof screenshots
 * and the route census. The findings themselves are fetched from the portal's own JSON API, because the
 * human Risk Inbox pages eight findings at a time while the API takes a `limit`, so a single
 * `GET /api/findings?tab=<state>&limit=…` reads a whole lifecycle tab in one response (measured);
 * `reduction.ts` carries the response shapes.
 *
 * ## No declared route may DO anything, and none names the workspace's own ids
 *
 * The transport navigates and observes; it performs no click and no form submission, so a route is
 * admissible here only if visiting it is a READ — a `GET` that changes nothing. The portal's write controls
 * — a finding's state menu, an attack-surface asset's confirm/ignore/monitor buttons, the signout link —
 * are deliberately absent, and every findings query is a read.
 *
 * And every path below is portal-generic. The organisation's workspace's own project and asset UUIDs are STATE,
 * not tooling, so they are never written here: the `/api/findings/stats` response carries
 * the project uuid and name at run time, so a per-project route hardcoding `/project/<uuid>` is neither
 * necessary nor allowed.
 *
 * ## The Risk Report is deliberately NOT here
 *
 * `/risk-inbox/report` renders 'Preparing report for printing…' and never settles under an automated client
 * (its body is behind an @media print stylesheet), and can trip a print dialog that wedges the relay.
 * Walking it would capture a spinner and risk the whole session, so it is excluded by name — `descriptor.ts`
 * records it as a `not-fetched` exclusion instead.
 */

/** The portal origin every route hangs off, and the walk's one lease origin. */
export const AETHER_PORTAL_ORIGIN = "https://app.tryaether.ai";

/** One declared portal page: where it is, what it belongs to, and whether a real walk has confirmed it. */
export interface AetherPortalRoute {
  /** The path relative to the portal origin, always leading with `/`. */
  readonly href: string;
  /** Which part of the portal this belongs to, as a coverage reason groups it. */
  readonly section: string;
  /** Whether a real session on this installation has landed on it authenticated. See this file's header. */
  readonly verified: boolean;
  /** Why this page is worth walking, in the words a reader chasing the data would use. */
  readonly why: string;
}

/**
 * Every portal page this atlas declares, in the order a walk visits them.
 *
 * `/home` first so the workspace, its projects and their targets are captured before the findings that
 * reference them; `/risk-inbox` for the findings themselves; `/attack-surface` last, for the host/IP census
 * whose COUNT is recorded on the workspace while its rows are the declared voluminous exclusion.
 */
export const AETHER_PORTAL_ROUTES: readonly AetherPortalRoute[] = [
  {
    href: "/home",
    section: "overview",
    verified: true,
    why: "the workspace dashboard — walked for its proof screenshot and the project/open-findings overview a reader recognises",
  },
  {
    href: "/risk-inbox",
    section: "findings",
    verified: true,
    why: "the Risk Inbox as a human sees it — walked for its proof screenshot; the findings themselves are read from the API below rather than from this eight-at-a-time page",
  },
  {
    href: "/attack-surface",
    section: "attack-surface",
    verified: true,
    why: "the discovered attack surface — walked for its proof screenshot; its host/IP rows are the declared voluminous exclusion, not a stored kind",
  },
  {
    href: "/api/findings/stats",
    section: "findings-api",
    verified: true,
    why: "the portal's own tallies — total, per-severity and per-status counts, and the `sources` array that is one row per project; the `project` kind comes from here",
  },
  {
    href: "/api/findings?tab=open&page=1&limit=100",
    section: "findings-api",
    verified: true,
    why: "every OPEN finding in one response, so the atlas holds all of them rather than the eight the human page shows",
  },
  {
    href: "/api/findings?tab=closed&page=1&limit=100",
    section: "findings-api",
    verified: true,
    why: "every CLOSED finding — the engagement's resolved history, read under its own tab so each row's state is known",
  },
  {
    href: "/api/findings?tab=ignored&page=1&limit=100",
    section: "findings-api",
    verified: true,
    why: "every IGNORED finding — accepted-risk and false-positive rows, read under its own tab",
  },
];
