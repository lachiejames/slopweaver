/**
 * What the Knock atlas declares about itself — the row a catalogue shows, and the honest answer to "how
 * much of this platform have you actually looked at".
 *
 * ## It holds EVERYTHING REACHABLE, and right now it reaches the map but none of the territory
 *
 * `docs/atlas-intent/06-holdings.md`'s test comes out the opposite way here from Slack's and Notion's: nothing in
 * this installation holds a Knock workflow, guide, broadcast, channel, environment, commit, branch or
 * recipient, so if this atlas does not, nothing does. `kinds.ts` therefore declares thirty entity kinds
 * beside the two surface-map ones.
 *
 * Every one of those thirty is currently EMPTY, and the reason is a credential rather than Knock: this
 * installation holds neither a data-API key nor a Management API service token. `visibilityScope` says
 * this, and each entity kind carries a `not-configured` cell naming the exact remedy, because a kind that
 * is empty for want of a token and a kind that is empty because the account holds nothing are the same file
 * with opposite meanings.
 *
 * There is a sharper twist here than on most platforms, and it is the reason the browser half is not
 * optional: **the only surface that reads a Knock credential is the browser.** No operation on either API
 * lists an account's API keys or service tokens (`kinds.ts`), so the thing that would fill the API channel
 * can be obtained through the dashboard and nowhere else.
 *
 * ## Both surface maps are FILLED, which is not the same as being filled as entity sources
 *
 * This is the distinction the status flag exists for, and getting it wrong in either direction would
 * misreport the atlas:
 *
 * - `spec-declared` is `filled` and complete. It is compiled from BOTH of Knock's published OpenAPI
 *   documents, each pinned by digest, and needs no credential — 216 operations, their parameters, their
 *   paging shape, their environment scoping and their disposition.
 * - `unauthenticated-probe` is `filled`, and it is the strongest claim this atlas makes: all 86 declared
 *   GETs were confirmed to exist against the live services, with six controls answering 404 (`apiProbe.ts`).
 * - `browser-routes` is `filled`, and it is a stronger artifact than the route PROBE other atlases use: the
 *   dashboard publishes its own complete route table in `_buildManifest.js`, unauthenticated. 154 routes,
 *   including ones a given account's plan would never render.
 * - `dashboard-walk` is the driven-browser surface, filled by `slopweaver atlas knock walk` against the
 *   owner's own Chrome. It is what holds the screenshots and the first-party calls the client makes.
 * - `api-entities` is `declared-unfilled`. `unfilledBecause` names the credential.
 *
 * ## The API surface has a NAMED shortfall, and it is why the browser half is mandatory
 *
 * MEASURED:**19 of the 57 dashboard pages a walk visits display something no declared operation
 * reads.** That is `docs/atlas-intent/02-both-surfaces.md`'s "things via the browser you can't get by API" arriving as a
 * third of this platform's product surfaces rather than as a principle — and the four sharpest are the
 * Agents workspace (the first item in the product's own navigation, absent from both documents entirely),
 * the audit log, the API keys page and the service tokens page.
 *
 * The larger figure a reader may see elsewhere is 55 of 154, which counts every sign-in page, OAuth
 * callback and error route as well. Those have no API behind them necessarily, so the 19 is the one to
 * quote and the one the gap list carries.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { KNOCK_ATLAS_KINDS } from "./kinds.js";
import { KNOCK_ATLAS_PLATFORM } from "./model.js";

/** Knock's atlas, as it declares itself. */
export const KNOCK_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every notification DELIVERY, and the events, activities, delivery logs and workflow recipient runs" +
        " beside it, as rows. All of them are time-series observations Knock emits — unbounded, growing with" +
        " the clock, identified by an instant rather than by a name somebody chose — so they are" +
        " shape-indexed rather than stored: enumerated, their shape recorded, and never a row per message." +
        " The MESSAGE TYPES those deliveries are rendered from are configuration somebody authored and ARE" +
        " entities, one noun away, which is the voluminous criterion cutting through a family rather than" +
        " along it",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "a delivery, an event, an activity, a delivery-log line and a workflow recipient run are each emitted when a notification happens rather than authored by anybody",
        wouldBeMeasuredBy: "`GET /v1/messages` paged over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "every write. All 130 mutating operations across both APIs are inventoried with their path, parameters" +
        " and tag, and none is ever sent. Knock upserts by `PUT`, so this is a larger share of the surface" +
        " than a `PATCH`-shaped API would give — and it includes `PUT /v1/broadcasts/{key}/send` and" +
        " `POST /v1/workflows/{key}/trigger`, which would deliver real notifications to real people",
      ground: "never-acted",
    },
    {
      because:
        "a screenshot of any page whose content is the organisation's own recipients or message history. A walk" +
        " photographs settings and admin pages, and never pilots a browser to photograph every message ever" +
        " sent. `browserPages.ts`" +
        " is the declared set and it is the settings, admin and section-index pages only",
      ground: "never-acted",
    },
    {
      because:
        "the VALUE of anything a dashboard page's own client received. The browser channel stores the wire" +
        " path a call went to and the response's field NAMES, never a field's contents — a signed-in Knock" +
        " dashboard can see every end user of the products it notifies, their email addresses and their" +
        " phone numbers. `browserReduction.ts` is that redaction, committed so a reviewer can read it rather" +
        " than trust it",
      ground: "names-not-values",
    },
    {
      because:
        "Knock's own marketing site at `knock.app` and its documentation at `docs.knock.app`. The two OpenAPI" +
        " documents are fetched FROM Knock's API hosts rather than from its docs site, and the reference" +
        " pages are recorded as deep links rather than crawled",
      ground: "out-of-platform",
    },
  ],
  kinds: [...KNOCK_ATLAS_KINDS],
  platform: KNOCK_ATLAS_PLATFORM,
  question:
    "what can be reached in Knock — every operation both published APIs declare with its parameters, paging" +
    " shape, environment scoping and whether its identifiers are producible at all, every dashboard route" +
    " that exists and which of them no API backs, and (once this installation holds a credential) every" +
    " workflow, guide, broadcast, channel, environment, commit, branch and recipient the account holds," +
    " because nothing else in this installation holds any of them",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas knock sync",
  surfaces: [
    {
      denominator: {
        because:
          "Knock publishes no catalogue of its `spec-declared` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "spec-declared",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Knock publishes no catalogue of its `unauthenticated-probe` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: false,
      name: "unauthenticated-probe",
      role: "corroborating",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Knock publishes no catalogue of its `browser-routes` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: false,
      name: "browser-routes",
      role: "discovery",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Knock publishes no catalogue of its `dashboard-walk` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "dashboard-walk",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Knock publishes no catalogue of its `api-entities` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "api-entities",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation holds neither a Knock data-API key nor a Management API service token, and" +
        " neither published document declares an operation that reads either — the dashboard's own" +
        " `/settings/api-keys` and `/settings/service-tokens` pages are the ONLY surface that can produce" +
        " one, which is `docs/atlas-intent/02-both-surfaces.md` arriving as a fact about this atlas's own bootstrap." +
        " Run `slopweaver secrets set knock-service-token` once one exists",
    },
  ],
  visibilityScope:
    "the API channel sees exactly what its credential allows, and the two credentials are not comparable: a" +
    " data-API key is scoped to ONE environment and carries no member's role, while a Management API" +
    " service token is scoped to the whole account and can read every environment. The browser channel sees" +
    " exactly what the signed-in member's own Knock role opens. Neither implies the other. TODAY the API" +
    " channel holds no credential at all, so 'complete' currently means complete for a surface map compiled" +
    " from public artifacts and corroborated by an unauthenticated probe, and for nothing else",
};
