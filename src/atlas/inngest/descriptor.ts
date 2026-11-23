/**
 * What this atlas declares about itself, including the two things it cannot yet do.
 *
 * ## Four surfaces, and the browser one carries the ingest duty
 *
 * A descriptor's `status` is static, which is the trap `jumpcloud/descriptor.ts` names: a surface declared
 * `filled` in source is filled on every install, including one where the acquisition has never run. So every
 * flip a run can earn is derived from the manifest in `surfaceFill.ts`, and what is written here is only the
 * reason each starts unfilled.
 *
 * - `published-catalogue` is filled by `atlas inngest sync`, which needs no credential and reaches no
 *   account: it compiles the REST catalogue Inngest's own API reference serves every reader, and the route
 *   table the dashboard ships to a signed-out visitor, then corroborates both by unauthenticated probe.
 * - `rest-api` is `declared-unfilled`: no Inngest signing key is configured here, so nothing has ever asked
 *   this account for an app, a function or an event key through `api.inngest.com`.
 * - `graphql` is `declared-unfilled` until a walk runs, and it is the surface no published source could ever
 *   fill: `api.inngest.com/gql` answers `introspection disabled`, so the only census of it is what the
 *   dashboard's own client is seen to send.
 * - `dashboard` is filled by `atlas inngest walk`, which drives the owner's own Chrome. It is the INGEST
 *   fallback for this platform rather than a corroboration afterthought (`docs/atlas-intent/07-browser-fallback.md`): with no
 *   signing key, the browser is the only channel that can see this account at all.
 *
 * ## Why this atlas holds entities
 *
 * `docs/atlas-intent/06-holdings.md` is a test, not a preference: does something better suited already hold this
 * platform's entities? For Slack the corpus does, so its atlas maps the interface alone. Here nothing does —
 * no app, function, environment, event key, signing key, event type, webhook or integration of this account
 * exists in any other store in this installation — so the answer is everything reachable, entities included,
 * minus the highly voluminous.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { INNGEST_ATLAS_PLATFORM, INNGEST_KINDS, INNGEST_VISIBILITY_SCOPE } from "./model.js";

/** The surface name the compiled channel's coverage is reported under. */
export const INNGEST_CATALOGUE_SURFACE = "published-catalogue";

/** The surface name the live REST channel's coverage is reported under, filled or not. */
export const INNGEST_REST_SURFACE = "rest-api";

/** The surface name the dashboard's own GraphQL endpoint is reported under. */
export const INNGEST_GRAPHQL_SURFACE = "graphql";

/** The surface name the browser walk's coverage is reported under. */
export const INNGEST_DASHBOARD_SURFACE = "dashboard";

/** This atlas, as it declares itself. */
export const INNGEST_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every function RUN and every EVENT row. Both are time-series observations in exactly the sense " +
        "`docs/atlas-intent/06-holdings.md` names — emitted by the platform rather than created by a person, identified " +
        "by an instant, growing with the clock — so the operations that list them are held and classed " +
        "`voluminous` with the rule that decided it, and their rows are never stored whole. A DISPOSITION " +
        "rather than an exclusion: the family has been looked at and deliberately not kept, which an excluded " +
        "family cannot say about itself",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "a function run and an event row are both emitted by the platform as work happens, identified by an instant and growing with the clock",
        wouldBeMeasuredBy: "the runs listing for one environment over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "every mutation. The published catalogue declares operations that create environments and webhooks, " +
        "cancel and rerun function runs, invoke functions, sync apps, send events and execute commands inside " +
        "a sandbox, and this atlas will call none of them. Each is still a row, because an atlas that omitted " +
        "them would answer `Inngest offers no way to do that`, which is false",
      ground: "never-acted",
    },
    {
      because:
        "the VALUE of any event key, signing key or API key, on any surface, and the PICTURE of the three pages " +
        "that render one. `browserPages.ts` refuses to photograph them by name and reason, and the refusal is " +
        "checked before the bytes exist rather than after — clearing a reference is not withholding a file. " +
        "Inngest also masks every credential in its own dashboard behind a reveal control the walk never " +
        "clicks, so a picture of either page would have shown `signkey-prod-XXXX…` or " +
        "`sk-inn-api••••<last four>` anyway. That is the PLATFORM's property and can change without warning, " +
        "which is why it is not the only thing standing between this atlas and a stored secret. Each page is " +
        "still walked, and its existence, title, calls and GraphQL operations are all held",
      ground: "secret-material",
    },
    {
      because:
        "any event payload or step output, on any surface. Every field the compiled channel holds is a NAME, " +
        "because that channel presented no credential and was refused before it reached data; the walk stores " +
        "where a page settled, its title and its own call shapes, never the content a page rendered",
      ground: "names-not-values",
    },
    {
      because:
        "the Inngest dev server on `localhost:8288`. It is a different system with its own surface, reachable " +
        "only on a machine that happens to be running one, so an atlas row for it would be true on one laptop " +
        "and a confident lie everywhere else",
      ground: "out-of-platform",
    },
  ],
  kinds: [...INNGEST_KINDS],
  platform: INNGEST_ATLAS_PLATFORM,
  question:
    "what does this Inngest account hold and what can be asked of it — every published REST operation with " +
    "what an unauthenticated request established about its address, every route the dashboard's own table " +
    "declares and the exact URL that proves it, the GraphQL operations its client sends to an endpoint whose " +
    "introspection is disabled, and which apps, functions, environments and event keys this account actually " +
    "has",
  // `sync` and not a `refresh` this atlas never shipped: a scheduled row running the descriptor's word exits 2
  // on every pass ("slopweaver atlas inngest has no verb \"refresh\""). `walk` is
  // not here because it needs a signed-in Chrome, which an unattended resync does not have.
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas inngest sync",
  surfaces: [
    {
      denominator: {
        because:
          "Inngest publishes no catalogue of its `INNGEST_CATALOGUE_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: INNGEST_CATALOGUE_SURFACE,
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause: "no generation has been published yet. Run: slopweaver atlas inngest sync",
    },
    {
      denominator: {
        because:
          "Inngest publishes no catalogue of its `INNGEST_REST_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: INNGEST_REST_SURFACE,
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no Inngest signing key is configured on this installation, so nothing has ever called " +
        "`api.inngest.com` under a credential and no app, function, environment or event key of this " +
        "account has been read through it. Minting one is a widening of credential access rather than a " +
        "piece of work — it is the owner's to grant, and is recorded as the `api-credential-absent` gap. " +
        "This flips to filled in the commit that lands a client and proves it against the account, never " +
        "before it",
    },
    {
      denominator: {
        because:
          "Inngest publishes no catalogue of its `INNGEST_GRAPHQL_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: INNGEST_GRAPHQL_SURFACE,
      role: "discovery",
      status: "declared-unfilled",
      unfilledBecause:
        "`api.inngest.com/gql` answers `introspection disabled`, so no published source declares this " +
        "surface at all and nothing can be compiled from it. It is filled only by watching what the " +
        "dashboard's own client sends: run `slopweaver atlas inngest walk`. Its census is a FLOOR rather " +
        "than a denominator, and the `graphql-introspection-disabled` gap says so permanently",
    },
    {
      denominator: {
        because:
          "Inngest publishes no catalogue of its `INNGEST_DASHBOARD_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: INNGEST_DASHBOARD_SURFACE,
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no page has been walked. `atlas inngest walk` drives the owner's own Chrome through the routes the " +
        "application's own table declares; a surface is filled by pages actually reached, never by a " +
        "transport that could reach them",
    },
  ],
  visibilityScope: INNGEST_VISIBILITY_SCOPE,
};
