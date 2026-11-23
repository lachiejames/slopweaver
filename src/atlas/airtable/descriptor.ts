/**
 * What the Airtable atlas declares about itself — the row a catalogue shows, and the honest answer to "how
 * much of this platform have you actually looked at".
 *
 * ## It holds EVERYTHING REACHABLE, and with no member account it reaches none of it
 *
 * `docs/atlas-intent/06-holdings.md`'s test comes out the opposite way here from Slack's and Notion's: nothing else
 * in this repository holds an Airtable base, table, field, view or record, so if this atlas does not, nothing
 * does. `kinds.ts` therefore declares its entity kinds beside the two surface-map ones.
 *
 * Every one of those kinds is EMPTY whenever the connected account is not a member of the organisation's
 * Airtable enterprise, and the reason is then access rather than Airtable: for such an account
 * `airtable.com/` resolves to the marketing site in a signed-in browser and `/create/tokens` bounces to
 * `/login`, so there is no session and no token that could be created. `visibilityScope` says this, and
 * each entity kind carries a `not-configured` cell naming the invite as the unblock, because a kind that is
 * empty for want of an invite and a kind that is empty because the organisation holds nothing are the same
 * file with opposite meanings.
 *
 * ## Both surfaces are FILLED as surface maps, which is not the same as being filled as entity sources
 *
 * This is the distinction the status flag exists for, and getting it wrong in either direction would
 * misreport the atlas:
 *
 * - `spec-declared` is `filled` and complete. It is generated from Airtable's own OpenAPI document, pinned
 *   by digest, and it needs no credential — 103 operations, every parameter, every scope, every disposition.
 * - `browser-routes` is `filled` too, and that is a real claim rather than a courtesy: twenty-two routes are
 *   declared and eleven have their EXISTENCE CONFIRMED by an unauthenticated probe with a 404 control
 *   (`browserPages.ts`). What it is filled WITH is route existence, which is the floor
 *   `docs/atlas-intent/06-holdings.md` sets — "we should at least know all the pages that exist."
 * - `browser-walk` is `declared-unfilled`, and it is the surface that would hold the screenshots, the view
 *   configurations, the automations and the admin pages. `unfilledBecause` names the invite.
 *
 * ## The API surface has a NAMED shortfall, and it is the reason the browser half is mandatory
 *
 * Airtable's document declares a `workflow` tag — its own noun for automations — and publishes zero
 * operations under it. There is no REST call that lists a base's automations, reads a trigger, or reports
 * whether one is enabled. Neither is there one that returns a view's filters, sorts or hidden fields, nor an
 * interface's layout. That is `docs/atlas-intent/02-both-surfaces.md`'s "things via the browser you can't get by API"
 * arriving as a measured fact about this platform rather than as a principle, and it is why
 * `browser-walk` stays declared rather than being dropped for want of access.
 */
import { type AtlasDescriptor, compiledSurfaceMapSurfaces } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { AIRTABLE_ATLAS_KINDS } from "./kinds.js";
import { AIRTABLE_ATLAS_PLATFORM } from "./model.js";

/** Airtable's atlas, as it declares itself. */
export const AIRTABLE_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "the enterprise AUDIT-LOG and CHANGE-EVENT streams, and a webhook's payload backlog, as rows. All three" +
        " are time-series observations Airtable emits — unbounded, growing with the clock, identified by an" +
        " instant rather than by a name somebody chose — so they are shape-indexed rather than stored:" +
        " enumerated, their shape recorded, and never a row per event. The EXPORT REQUESTS made against those" +
        " streams are configuration somebody created and ARE entities, one path segment away, which is the" +
        " voluminous criterion cutting through a family rather than along it",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "the audit-log and change-event streams and a webhook's payload backlog are time-series observations Airtable emits, identified by an instant rather than by a name somebody chose",
        wouldBeMeasuredBy:
          "`GET /v0/meta/workspaces/{workspaceId}/auditLogEvents` paged over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "every write. All 71 mutating and side-effecting operations are inventoried with their reason and have" +
        " no callable request variant at all — unreachable rather than merely unused. This atlas only ever" +
        " reads, and `POST …/users/{userId}/logout` is refused as `side-effecting` rather than `mutating`" +
        " because it changes no stored configuration and signs a real person out of their work regardless",
      ground: "never-acted",
    },
    {
      because:
        "a screenshot of any page whose content is the organisation's own data. A base's grid, a table and a" +
        " record are entities this atlas already holds; photographing them as well would be holding the same" +
        " thing twice, and the owner's ruling names settings and admin pages as what a walk photographs",
      ground: "never-acted",
    },
    {
      because:
        "the value of any credential material a response carries — a webhook's `macSecretBase64`, an" +
        " eDiscovery export's signed download URLs, a share's token prefix. Named by KIND in" +
        " `sensitiveFields.ts` rather than by bare name, because `primaryKey` on a HyperDB table and `tokenId`" +
        " on a personal access token are an identifier and a data-table key, not credentials",
      ground: "secret-material",
    },
    {
      because:
        "Airtable's own marketing site at `www.airtable.com`. `/enterprise` is in the page inventory solely so" +
        " a reader learns that path is NOT the admin panel, which is the mistake the two names invite",
      ground: "out-of-platform",
    },
  ],
  kinds: [...AIRTABLE_ATLAS_KINDS],
  platform: AIRTABLE_ATLAS_PLATFORM,
  question:
    "what can be reached in Airtable — every Web API operation with its parameters, scopes, paging shape and" +
    " what this atlas does with it, every browser route that exists, and (once a member account is" +
    " connected) every base, table, field, view, record, webhook, share and person the platform holds," +
    " because nothing else in this installation holds any of them",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas airtable sync",
  surfaces: [
    ...compiledSurfaceMapSurfaces(),
    {
      denominator: {
        because:
          "Airtable publishes no catalogue of its `rest-entities` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "rest-entities",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no Airtable personal access token is configured, and only an account that is a member of the" +
        " organisation's Airtable enterprise can create one — for any other account `/create/tokens`" +
        " redirects to `/login`. An organisation invite is what fills this, followed by" +
        " `slopweaver secrets set airtable-token`",
    },
    {
      denominator: {
        because:
          "Airtable publishes no catalogue of its `browser-walk` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "browser-walk",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "the same missing organisation invite. Every route in the inventory that matters is auth-gated —" +
        " eleven of them CONFIRMED so by an unauthenticated probe — so a walk in a browser with no member" +
        " session would photograph the sign-in page at every declared route. This is the surface that would hold the" +
        " automations, the view configurations, the interface layouts and the enterprise admin pages, none" +
        " of which any REST operation returns",
    },
  ],
  visibilityScope:
    "the API channel sees exactly what its personal access token's scopes and resource grant allow, which is" +
    " a property of the token and carries no human's role; the browser channel sees exactly what the" +
    " signed-in person's own Airtable role opens. Neither implies the other. Both are empty for one reason" +
    " that is not about Airtable at all whenever the connected account is not a member of the organisation's" +
    " enterprise, and 'complete' then means complete for a surface map compiled from public artifacts and" +
    " for nothing else",
};
