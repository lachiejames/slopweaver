/**
 * What the Clerk atlas declares about itself — the row a catalogue shows, and the honest answer to "how
 * much of this platform have you actually looked at".
 *
 * ## It holds the SURFACE MAP, and that is the §6 test coming out one way rather than an appetite
 *
 * `docs/atlas-intent/06-holdings.md` asks whether something better suited already holds this platform's entities.
 * The entities a Clerk instance holds are the product's own end users, and their record of truth is the
 * application's own database — not this installation, and not this atlas. So the deliverable is the
 * interface: every operation across four published documents, every webhook event, every dashboard page and
 * the exact URL that proves it. Reading that as an entity index is how a fully covered platform looks empty.
 *
 * ## Three surfaces, and only ONE of them needs a credential this installation lacks
 *
 * MEASURED, and stated here rather than apologised for, because it is what the coverage cells
 * say and a reader should meet it in the descriptor first:
 *
 * - `published-api` is FILLED once a sync has run, and needs no credential at all. Clerk publishes its
 *   Backend, Frontend and beta Platform APIs plus a webhook-event catalogue; `specLock.ts` pins the bytes
 *   and the census they must satisfy. This is a complete MAP and says nothing about this account's data.
 * - `dashboard` is FILLED once a walk has run, in the owner's own Chrome. It is the surface that answers
 *   the half of `docs/atlas-intent/02-both-surfaces.md` that every design pass drops — and on this platform it earns its
 *   cost immediately, because the dashboard calls `dapi.clerk.com`, which no published document declares.
 * - `instance-api` is DECLARED-UNFILLED. No `clerk-*` entry exists under `$SLOPWEAVER_HOME/secrets`, so
 *   this installation holds no Clerk secret key, publishable key or platform token, and every Backend API
 *   operation declares `bearerAuth`.
 *
 * ## The descriptor's `status` is static, so nothing here may claim `filled` before it is
 *
 * A surface declared `filled` in source is filled on every install, including one where the sync and the
 * walk have never run. Both of the fillable surfaces above are therefore DERIVED from the manifest by
 * `surfaceFill.ts` — see that module for the two sibling atlases where the static form was simply false
 * about what a run had reached.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { CLERK_ATLAS_KINDS, CLERK_ATLAS_PLATFORM, CLERK_VISIBILITY_SCOPE } from "./model.js";

/** Clerk's atlas, as it declares itself. */
export const CLERK_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every mutation on every surface. This atlas only ever reads: no user is created or deleted, no instance setting is changed, no key is rotated, no session is revoked and no invitation is sent. The 331 write operations are INVENTORIED with their disposition reason on each row rather than omitted, so the atlas can answer what this platform can be made to do without ever doing it",
      ground: "never-acted",
    },
    {
      because:
        "a row per end user, email address, phone number, sign-up, waitlist entry or organisation membership. Those rows are the product's own end users, whose record of truth is the application's own database — the `docs/atlas-intent/06-holdings.md` test coming out `the surface map` for this platform. The operations that return them are mapped in full, including their response field names, and are never called",
      ground: "held-elsewhere",
      holder: "the application's own database, which is the record of truth for its end users",
    },
    {
      because:
        "the three reads whose 200 body IS a credential — a machine's secret key, an API key's secret, and one end user's third-party OAuth access token. They are `excluded` rows naming exactly what comes back, so this atlas can say the operation exists without ever being a place secrets accumulate",
      ground: "secret-material",
    },
    {
      because:
        "a row per session, client, machine-to-machine token, billing statement or metered usage sample. Those take the highly-voluminous disposition of `docs/atlas-intent/06-holdings.md` — the family is enumerated and its SHAPE recorded, never a record per observation. A disposition and not an exclusion: `slopweaver atlas clerk read --kind operation --query sessions` still says what a session IS",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "a session, a client, a machine-to-machine token, a billing statement and a metered usage sample are each emitted by the platform against the clock rather than authored by a person",
        wouldBeMeasuredBy:
          "`GET /v1/sessions` and `GET /v1/organizations/{id}/memberships` paged to exhaustion on this instance",
      },
    },
    {
      because:
        "the five older dated versions of the Backend API and the five of the Frontend API that Clerk keeps published alongside the pinned ones. A standing gap (`clerk-api-versions-not-compiled`) rather than a silence, because an installation pinned to an older version reads a surface this atlas does not map",
      ground: "not-fetched",
      wouldBeClosedBy:
        "compiling the five older dated Backend and Frontend API versions, closing `clerk-api-versions-not-compiled`",
    },
    {
      because:
        "every dashboard page of every OTHER application and instance. The dashboard renders one at a time and the walk drives whichever the owner's browser was left on, which is a permanent, never-closing gap (`browser-single-instance-only`) rather than a completeness claim",
      ground: "not-fetched",
      wouldBeClosedBy:
        "a walk that switches application and instance rather than taking whichever the browser was left on",
    },
    {
      because:
        "response VALUES from the dashboard walk. What a walk stores is the page, where it settled, what it photographed, and the method and wire-path SHAPE of the traffic it saw — never a rendered end user. `browserReduction.ts` is that redaction, committed so a reviewer reads it rather than trusts it",
      ground: "names-not-values",
    },
  ],
  kinds: [...CLERK_ATLAS_KINDS],
  platform: CLERK_ATLAS_PLATFORM,
  question:
    "what can be asked of this organisation's identity platform and where — every endpoint, method, parameter, response field and security scheme across Clerk's Backend, Frontend and beta Platform APIs, every webhook event it will send unasked, and every dashboard page a human can be sent to with the exact URL that proves it, including the undocumented dashboard API that no published document declares",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas clerk sync && slopweaver atlas clerk walk",
  surfaces: [
    {
      denominator: {
        because:
          "Clerk publishes no catalogue of its `published-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "published-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no generation has been published yet. Run: slopweaver atlas clerk sync — it compiles the four pinned Clerk documents and needs no credential",
    },
    {
      denominator: {
        because:
          "Clerk publishes no catalogue of its `dashboard` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "dashboard",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no walk has run. Run: slopweaver atlas clerk walk — it drives the owner's own Chrome through the declared dashboard pages, photographs each and records what the client called",
    },
    {
      denominator: {
        because:
          "Clerk publishes no catalogue of its `instance-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "instance-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation holds no Clerk credential — no `clerk-*` entry exists under `$SLOPWEAVER_HOME/secrets`, and every Backend API operation declares `bearerAuth`. A read-only secret key minted in the dashboard, stored as `clerk-secret-key`, fills it. That is a widening of access and the owner's to grant",
    },
  ],
  visibilityScope: CLERK_VISIBILITY_SCOPE,
};
