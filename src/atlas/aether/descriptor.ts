/**
 * What the Aether atlas declares about itself — including the one surface it has, and the session boundary
 * that whole surface stands on.
 *
 * ## What a session cookie BUYS, and what LAPSES — the boundary this atlas exists inside
 *
 * The surface is a signed-in browser session on the portal origin, and what it is made of is read live,
 * never kept here (names only, never values: `slopweaver browser cookies --origin https://app.tryaether.ai`).
 *
 * - **What it buys:** an authenticated read of the ONE org the session is scoped to, for as long as the
 *   browser keeps a short-lived access token fresh. A bot-challenge clearance is what lets a
 *   non-interactive client reach the origin at all.
 * - **What lapses, and fast:** the access token is short-lived and the portal's own client rotates it
 *   from a refresh token in the background. So this atlas is filled by DRIVING the live browser (which does that rotation), never by
 *   snapshotting the jar — a cookie read would carry a token already expiring. When the refresh token
 *   lapses or the session signs out, a walk lands on the sign-in form and reports `LOGIN_WALL` rather than a silent
 *   zero (`errors.ts`).
 * - **What is never stored:** no cookie, no token, no header. The walk carries none (see `excludes`
 *   `secret-material`), so the portal's authenticated surface is recorded as evidence of what Aether HOLDS
 *   and never as something this installation can replay.
 *
 * ## Both flips of the surface status are DERIVED, not declared
 *
 * `status` on the surface below is a static placeholder. {@link aetherDescriptorFor} computes the real one
 * from the manifest, so `atlas aether coverage` on an install that has never walked reports the surface
 * `declared-unfilled` from the ABSENCE of evidence rather than from a literal somebody could edit, and a
 * successful walk flips it without anyone touching this file.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import type { AetherManifest } from "./entities.js";
import { AETHER_KINDS, AETHER_PLATFORM } from "./model.js";

/** What "complete" can ever mean for this access. See this file's header for the whole boundary. */
export const AETHER_VISIBILITY_SCOPE =
  "one organisation's workspace on the Aether (dvuln) portal at app.tryaether.ai, reached only through the owner's own signed-in work Chrome; the atlas holds no credential, so a walk sees exactly what the owner's live session sees and lapses the moment that session does";

/**
 * What would fill the portal surface, in the words a reader needs to act on.
 *
 * Exported because the derived `unfilledBecause` quotes it: an atlas that says a surface is unfilled and
 * cannot say what would fill it has raised an unfalsifiable claim.
 */
export const AETHER_PORTAL_UNFILLED_BECAUSE =
  "no walk has filled the Aether portal surface — confirm the owner's work Chrome holds a live session with `slopweaver browser cookies --origin https://app.tryaether.ai`, then run `slopweaver atlas aether walk`";

/** The Aether pentest portal's atlas, as it declares itself. */
export const AETHER_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every write the portal offers. Aether can change a finding's state (open/closed/ignored), confirm or ignore an attack-surface asset, and start a PAID monitor on one; the walk navigates and observes only — no click, no form submission, no request replay — so nothing here can move a finding, change an asset's status or incur a monitoring charge",
      ground: "never-acted",
    },
    {
      because:
        "a finding's full write-up — its proof-of-concept steps, request/response transcripts and exploit payloads. This is the tester's authored evidence and can carry a live exploit for a staging system that is still up. The atlas holds the finding's identity and triage — code, title, severity, state, target, reported and updated — plus a one-line summary when the body carries one; the step-by-step reproduction is a document, not a map",
      ground: "payload-not-map",
    },
    {
      because:
        "the Attack Surface host and IP inventory — a machine-emitted scan census that grows with every discovery run and is identified by an address rather than by a name somebody authored (docs/atlas-intent/06-holdings.md). The COUNT and its two categories are recorded as an observation on the workspace; the individual rows are not stored whole",
      ground: "shape-index",
      volume: {
        basis: "measured",
        establishedBy:
          "navigate /attack-surface in the portal, which reads 'N assets discovered across 2 categories' with a Domains and an IP Addresses tally",
        magnitude:
          "the portal's own 'N assets discovered' tally and its Domains and IP Addresses category tallies, read on the page at measurement time and never kept here as an installation's figures",
        unboundedBecause:
          "the attack surface is a continuous discovery scan's output, growing per run and keyed by address, not a finite roster a person authored",
      },
    },
    {
      because:
        "the portal's browser session — every cookie and token it is made of. The browser transport carries no cookies, no tokens and no headers, so the portal's authenticated surface is recorded as evidence of what Aether HOLDS and never as something this installation can replay",
      ground: "secret-material",
    },
    {
      because:
        "the portal's Risk Report at /risk-inbox/report. It is a print-to-PDF view that renders 'Preparing report for printing…' and never settles under an automated client (its body is behind an @media print stylesheet), and this atlas found no download endpoint for it; getting the file out needed the owner to press print by hand. So the report is neither walked nor reduced — its findings are reduced from the Risk Inbox instead",
      ground: "not-fetched",
      wouldBeClosedBy:
        "a print-to-PDF capability on the browser door, or an Aether export endpoint if one is found — tracked as a fleet row",
    },
    {
      because:
        "the engagement's in-scope TARGET list and the WORKSPACE name. Both render server-side in the portal with no JSON endpoint this walk located — the finding API links a finding to a PROJECT, not a target — so the workspace is named here in prose and the targets are not stored. A finding still carries its project; what is absent is the per-target breakdown",
      ground: "not-fetched",
      wouldBeClosedBy:
        "locating the portal's project/asset JSON endpoint (the /home and /project pages render it server-side), then adding a `target` kind reduced from it",
    },
  ],
  kinds: [...AETHER_KINDS],
  platform: AETHER_PLATFORM,
  question:
    "which pentest findings on the organisation's in-scope targets are open, at what severity, under which project, and when was each reported and last updated",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas aether walk",
  // Checked daily, walked only on demand. Reproduce the newest provider-side change with
  // `jq -rs '[.[]|select(.code)]|map(.updatedAt)|max' "$SLOPWEAVER_HOME/atlas/aether/findings.jsonl"`.
  resyncDemand: {
    because:
      "a pen-test platform's findings arrive in engagements, so a scheduled walk between engagements reads nothing new and can still stop at the sign-in page and ask for the owner. A sync is only asked for when it is useful — more pen-testing, or someone saying they did something in the app",
    terms: ["aether", "dvuln"],
  },
  surfaces: [
    {
      denominator: {
        known: true,
        // Aether publishes no read catalogue, so the denominator is this atlas's own enumerated route set
        // (`pages.ts`) — 3 human pages and 4 JSON endpoints (the stats endpoint and the open/closed/ignored
        // finding tabs). All 7 are visited every walk, so there is no hidden shortfall; the org's own finding
        // count is checked at runtime against `/api/findings/stats`, not baked in here.
        exists: 7,
        reached: 7,
        source:
          "src/atlas/aether/pages.ts — the atlas's own enumerated portal route set; Aether publishes no read catalogue",
      },
      acquisition: "driven-browser",
      documented: false,
      name: "aether-portal",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause: AETHER_PORTAL_UNFILLED_BECAUSE,
    },
  ],
  visibilityScope: AETHER_VISIBILITY_SCOPE,
};

/**
 * Whether the portal surface is filled: every declared kind carries a recorded success.
 *
 * Existential-per-kind rather than "something walked once" — the exact invariant the sibling atlases'
 * `surfaceFill` modules settled on after three atlases graded a surface filled on an attempt count. A walk
 * that rendered the pages but reduced no findings has not filled the `finding` kind, and this says so.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether every declared kind carries a recorded success, and what is still outstanding
 *
 * @internal
 */
export function aetherPortalFill({ manifest }: { manifest: AetherManifest | null }): {
  readonly filled: boolean;
  readonly succeeded: number;
  readonly applicable: number;
  readonly outstanding: readonly string[];
} {
  const outstanding = AETHER_KINDS.filter((kind) => manifest?.kinds[kind].lastSuccessAt == null);
  return {
    applicable: AETHER_KINDS.length,
    filled: manifest !== null && outstanding.length === 0,
    outstanding: [...outstanding].toSorted(),
    succeeded: AETHER_KINDS.length - outstanding.length,
  };
}

/**
 * The descriptor as this install's own store makes it true.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns the descriptor with the portal surface's status derived rather than declared
 */
export function aetherDescriptorFor({ manifest }: { manifest: AetherManifest | null }): AtlasDescriptor {
  const fill = aetherPortalFill({ manifest });
  const partial =
    fill.succeeded === 0
      ? AETHER_PORTAL_UNFILLED_BECAUSE
      : `${String(fill.succeeded)} of ${String(fill.applicable)} declared kinds carry a recorded success; still outstanding: ${fill.outstanding.join(", ")}. Run: slopweaver atlas aether walk`;
  return {
    ...AETHER_ATLAS_DESCRIPTOR,
    surfaces: AETHER_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
      if (fill.filled) {
        return { ...surface, status: "filled" as const, unfilledBecause: null };
      }
      return { ...surface, status: "declared-unfilled" as const, unfilledBecause: partial };
    }),
  };
}
