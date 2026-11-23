/**
 * What the Nx Cloud atlas declares about itself — the row a catalogue shows, and the honest answer to "how
 * much of this platform have you actually looked at".
 *
 * ## It holds EVERYTHING REACHABLE, and `excludes` says where the line is
 *
 * `docs/atlas-intent/06-holdings.md`'s test comes out the other way here from how it came out for Slack and Notion:
 * nothing better suited holds this platform's entities. The world model holds what people SAID about a
 * build, and the repository holds what a build was configured to do; neither holds what CI actually did. So
 * the organisation, the workspace, the reachable route surface and the HTTP surface all live here.
 *
 * ## The voluminous families are DECLARED, which is not the same as excluded
 *
 * Pipeline executions, runs and tasks are time-series observations — emitted by the platform, unbounded,
 * growing with the clock, identified by an instant. §6's one bound says such a family is enumerated and
 * declared rather than stored whole, and its DISPOSITION paragraph says why that is not an exclusion: an
 * atlas that simply omitted them would answer "this platform has no run history", which is false. So each
 * is reached over a bounded window, its shape and its size recorded, and not one of its rows stored. The
 * `family` kind is where that lands, and `excludes` below names the rows rather than the families.
 *
 * ## Three surfaces, two of them filled, and the unfilled one is a credential rather than a design
 *
 * `web-data` and `browser-walk` both present the owner's own signed-in session, which is the only
 * credential this installation holds for Nx Cloud. `public-api` is declared and unfilled because the
 * documented surface wants a personal access token — minted by hand at `/profile/tokens`, which is the owner's
 * action, not this atlas's — or the workspace CI token, which lives in a GitHub Actions secret. Declaring
 * it is the honest move: a reader must be able to learn that a documented API EXISTS and that this install
 * cannot reach it, rather than inferring from silence that there is none.
 *
 * ## One visibility ceiling, unlike the Notion atlas's two
 *
 * Both filled surfaces read as the same person with the same role, so there is one boundary rather than a
 * pair. MEASURED: that role reads the workspace, its runs and its analytics, and answers 403 to
 * the workspace settings page and to the organisation members page. Those pages are declared GAPS rather
 * than silently absent.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { NX_CLOUD_ATLAS_KINDS, NX_CLOUD_ATLAS_PLATFORM } from "./model.js";

/** Nx Cloud's atlas, as it declares itself. */
export const NX_CLOUD_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "the ROWS of every voluminous family — one record per CI pipeline execution, per run, per task and per agent. Each family is still REACHED over a bounded window and its shape, its field names and its size are held as a `family` entity; what is never stored is a row per record. `docs/atlas-intent/06-holdings.md` is the ruling, and the distinction is load-bearing: an excluded surface is one nobody looked at, a voluminous one has been looked at and deliberately not stored whole",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "one record per CI pipeline execution, run, task and agent — emitted by the platform as builds happen and growing with the clock",
        wouldBeMeasuredBy: "the runs listing for one workspace over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "the people on the organisation's membership list. The organisation entity carries how MANY memberships there are; who they are is the world model's, and a member role cannot read the members page anyway — it answers 403, which is recorded as a gap rather than as an absence",
      ground: "held-elsewhere",
      holder: "the world model's people directory; the organisation entity here carries the membership COUNT",
    },
    {
      because:
        "every credential the web client carries in its own payloads — the Rollbar access token, the PostHog key, the Auth0 client id, the signed-in person's avatar URL and email hash. `projection.ts` names every field that is kept, so these are dropped at the boundary, and `sensitivity.ts` refuses a whole generation rather than redacting one that got through",
      ground: "secret-material",
    },
    {
      because:
        "mutations of any kind. This atlas only ever reads: `client.ts` has no method parameter at all, so the platform's own actions — which are POSTs to the same paths — are unreachable by construction rather than by discipline, and the browser walk navigates without ever clicking",
      ground: "never-acted",
    },
    {
      because:
        "the cache artifacts themselves. Nx Cloud stores task outputs and terminal logs; the atlas records that the surface exists and where, and never downloads one",
      ground: "payload-not-map",
    },
  ],
  kinds: [...NX_CLOUD_ATLAS_KINDS],
  platform: NX_CLOUD_ATLAS_PLATFORM,
  question:
    "what does this organisation's Nx Cloud actually contain — which workspaces exist and how they are" +
    " configured, every page and HTTP operation the web client reaches, and which of the voluminous run" +
    " families exist, how big they are and what fields they carry",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas nx-cloud refresh",
  surfaces: [
    {
      denominator: {
        because: "Nx Cloud's data routes are undocumented React Router endpoints, so nothing declares how many exist",
        known: false,
      },
      acquisition: "api",
      documented: false,
      name: "web-data",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because: "the Nx Cloud web app publishes no route manifest",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "browser-walk",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because: "no live call has been made against this account",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "public-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "Nx Cloud's documented API authenticates with a personal access token or the workspace CI token." +
        " This installation holds neither: the CI token is a GitHub Actions secret, and a personal access" +
        " token is minted by hand at cloud.nx.app/profile/tokens, which is the owner's action rather than" +
        " this atlas's. MEASURED — /api/v1/... answers 404 to a session-authenticated read, so" +
        " the session credential does not reach it either",
    },
  ],
  visibilityScope:
    "everything the signed-in session's Nx Cloud role can see, and no more — a workspace MEMBER role" +
    " reads the workspace, its runs and its analytics, and is answered 403 on the workspace settings page" +
    " and the organisation members page, which only an organisation admin opens. 'Complete' here can" +
    " never mean more than that role sees, and both filled surfaces read under exactly this one ceiling",
};
