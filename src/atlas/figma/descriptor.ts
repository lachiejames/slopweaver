/**
 * What the Figma atlas declares about itself — the row a catalogue shows, and the honest answer to "how
 * much of this platform have you actually looked at".
 *
 * ## It holds EVERYTHING REACHABLE, and right now it reaches the surface map alone
 *
 * `docs/atlas-intent/06-holdings.md`'s test comes out the opposite way here from Slack's and Notion's: nothing in
 * this installation holds a Figma file, component, style, variable or published library, so if this atlas
 * does not, nothing does. `kinds.ts` therefore declares sixteen entity kinds beside the two surface-map
 * ones.
 *
 * Every one of those sixteen is currently EMPTY, and the reason is a credential rather than Figma:
 * MEASURED, the secrets store under `$SLOPWEAVER_HOME` carries no `figma-token` and no Figma
 * value is set in the environment. That is deliberately a claim about what this INSTALLATION has been
 * given, and nothing more — this atlas has not established what the owner's own Figma account can see, and
 * saying it had would be the kind of confident lie the whole design exists to prevent. `visibilityScope`
 * says exactly that, and each entity kind carries a `not-configured` cell naming the token as the unblock,
 * because a kind that is empty for want of a token and a kind that is empty because the organisation holds
 * nothing are the same file with opposite meanings.
 *
 * ## Both surfaces are FILLED as surface maps, which is not the same as being filled as entity sources
 *
 * This is the distinction the status flag exists for, and getting it wrong in either direction would
 * misreport the atlas:
 *
 * - `spec-declared` is `filled` and complete. It is generated from Figma's own OpenAPI document, published
 *   as `@figma/rest-api-spec` and pinned by two digests, and it needs no credential — 54 operations, every
 *   parameter, every scope, every accepted credential form, every disposition.
 * - `browser-routes` is `filled` too, and that is a real claim rather than a courtesy: 41 routes are
 *   declared, 23 have their EXISTENCE confirmed by an unauthenticated probe against a 404 control, and two
 *   more were established NOT to exist (`browserPages.ts`). What it is filled WITH is route existence,
 *   which is the floor `docs/atlas-intent/06-holdings.md` sets — "we should at least know all the pages that exist."
 * - `rest-entities` is `declared-unfilled`, and `unfilledBecause` names the token.
 * - `browser-walk` is `declared-unfilled`, and it is the surface that would hold the screenshots, the team
 *   and organisation settings, the memberships and the installed plugins.
 *
 * ## The API surface has a NAMED shortfall, and here it reaches the ROOT of the platform
 *
 * On most platforms the browser half catches a settings page the API forgot. On Figma it catches something
 * more basic: **no operation returns the set of teams or organisations a credential can see.** The whole
 * `Users` tag is `GET /v1/me`, which describes the caller and lists nothing, so every team-scoped operation
 * in the document — components, component sets, styles, folders, the deprecated projects — needs a
 * `team_id` that only a browser URL supplies. Neither is there any operation for a membership, a role, an
 * organisation setting, an installed plugin or a widget, and the document names three OAuth endpoints it
 * declares no path for.
 *
 * That is `docs/atlas-intent/02-both-surfaces.md`'s "things via the browser you can't get by API" arriving as a measured
 * fact about this platform rather than as a principle, and it is why `browser-walk` is declared rather than
 * dropped for want of a credential: on Figma the browser is not a corroborating second look, it is the only
 * channel that can reach the root.
 */
import { type AtlasDescriptor, compiledSurfaceMapSurfaces } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { FIGMA_ATLAS_KINDS } from "./kinds.js";
import { FIGMA_ATLAS_PLATFORM } from "./model.js";

/** Figma's atlas, as it declares itself. */
export const FIGMA_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "the organisation activity log, the plan's developer log, the daily AI-credit feed, a webhook's own" +
        " delivery history and the three dated library-analytics ACTION feeds, as rows. All seven are" +
        " time-series observations Figma emits — unbounded, growing with the clock, identified by an instant" +
        " rather than by a name somebody chose — so they are shape-indexed rather than stored: enumerated," +
        " their shape recorded, and never a row per event. The three USAGE siblings one path segment away" +
        " take no date, return a finite current listing and ARE entities, which is the voluminous criterion" +
        " cutting through a family rather than along it",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "the activity log, developer log, AI-credit feed, webhook delivery history and the three dated library-analytics ACTION feeds are all identified by an instant and grow with the clock",
        wouldBeMeasuredBy: "`GET /v1/activity_logs` paged over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "every write. All 11 mutating operations are inventoried with their reason and have no callable request" +
        " variant at all — unreachable rather than merely unused. This atlas only ever reads",
      ground: "never-acted",
    },
    {
      because:
        "a rendered image or an embed fragment. `getImages` returns S3 URLs Figma expires after 30 days and" +
        " `getOEmbed` returns an `<iframe>` for a link the caller already holds; both are artifacts to look" +
        " at rather than facts to store, and the nodes behind them are already reachable through" +
        " `getFileNodes`",
      ground: "payload-not-map",
    },
    {
      because:
        "the payments surface, which answers whether one named person bought one named Community resource and" +
        " requires a plugin payment token or an id no operation anywhere enumerates. Inventoried so a reader" +
        " learns it exists and why this atlas cannot walk it",
      ground: "not-fetched",
      wouldBeClosedBy:
        "a payment token or an enumerable id for the payments surface, which no operation anywhere currently returns",
    },
    {
      because:
        "a screenshot of any page whose content is the organisation's own design work. A file's canvas, a" +
        " board and a prototype are entities this atlas intends to hold; photographing them as well would be" +
        " holding the same thing twice, and the owner's ruling names settings and admin pages as what a walk" +
        " photographs",
      ground: "never-acted",
    },
    {
      because:
        "the value of a webhook's `passcode`, the one field on Figma's whole response surface that carries" +
        " credential material. Named by KIND in `sensitiveFields.ts` rather than by bare name, because on" +
        " this platform a `key` is the public, stable identifier of a component, style, variable or file —" +
        " 45 of the 46 credential-shaped property names in the document are one of those",
      ground: "secret-material",
    },
  ],
  kinds: [...FIGMA_ATLAS_KINDS],
  platform: FIGMA_ATLAS_PLATFORM,
  question:
    "what can be reached in Figma — every REST operation with its parameters, scopes, paging shape, accepted" +
    " credential forms and what this atlas does with it, every browser route that exists (and the two that" +
    " do not), and, once this installation holds a token, every file, component, style, variable, library," +
    " comment, webhook and dev resource the platform holds, because nothing else in this installation holds" +
    " any of them",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas figma sync",
  surfaces: [
    ...compiledSurfaceMapSurfaces(),
    {
      denominator: {
        because:
          "Figma publishes no catalogue of its `rest-entities` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "rest-entities",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation holds no Figma credential — MEASURED: no `figma-token` in the secrets" +
        " store under $SLOPWEAVER_HOME and no Figma value in the environment. A personal access token" +
        " created at www.figma.com/settings and stored with `slopweaver secrets set figma-token` fills" +
        " this. Note the token TYPE matters as much as its scopes here: a personal access token and a plan" +
        " access token are both `X-Figma-Token` headers reaching different operation sets, and 44 of the 54" +
        " operations accept the plan form",
    },
    {
      denominator: {
        because:
          "Figma publishes no catalogue of its `browser-walk` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "browser-walk",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no walk has run. Every gated route in the inventory would need a signed-in session, and this is" +
        " the surface that would hold the team and organisation settings, the memberships and roles, the" +
        " installed plugins and widgets, the enabled libraries and the trash — none of which any REST" +
        " operation returns. It is also the only channel that can produce a `team_id`, without which most" +
        " of the REST surface cannot be called at all",
    },
  ],
  visibilityScope:
    "the API channel sees exactly what its token's TYPE and scopes allow, which is a property of the token" +
    " and carries no human's role; the browser channel sees exactly what the signed-in person's own Figma" +
    " role opens. Neither implies the other. TODAY the API channel is empty for one reason that is about" +
    " this installation rather than about Figma or about the owner's account: no Figma credential has been" +
    " given to it. So 'complete' currently means complete for a surface map compiled from public artifacts," +
    " and for nothing else",
};
