/**
 * What the Notion atlas declares about itself — the row a catalogue shows, and the honest answer to "how
 * much of this platform have you actually looked at".
 *
 * ## It is a SURFACE MAP, and `excludes` is where that is said rather than implied
 *
 * Owner's rule: where something better suited already holds a platform's entities, the atlas
 * holds the surface map. Notion's pages, databases and their content are the world model's, and
 * `src/corpus/notion/reach.ts` enumerates every id the integration can see on every refresh. So this atlas
 * holds no content-page row at all, and says so — a reader must be able to learn that from the descriptor
 * rather than by noticing an absence.
 *
 * A LIST page is still a surface. The member list is one `page` entity with one screenshot; the members on
 * it are not entities here.
 *
 * ## Three surfaces, and the browser is authoritative for one of them
 *
 * The REST API is authoritative for what the API can be asked. The browser walk is authoritative for the
 * navigation surface, because it is the only channel that can see a settings page at all. The operations
 * that walk observes are `discovery` and never more: seeing the first-party client call something
 * establishes that it EXISTS, and nothing about what an ordinary token may ask for.
 *
 * `browser-walk` is filled by the settings TABS. Notion's settings surface has no addressable URL at all —
 * MEASURED, none of the declared routes in `browserPages.ts` reached, each rendering the client's
 * not-found shell or falling through to a document — so it is reached by clicks inside one modal
 * (`browser/notionSettings.ts`), and `settingsWalk.ts` photographs each of the tabs `settingsTabs.ts`
 * declares, graded on whether the client marked it selected. The surface carries two coverage cells, told
 * apart by scope: `declared-settings-tabs`, which is what fills it, and `declared-pages`, the routes, whose
 * open gaps stay as the measured evidence that there is no address to walk. All three surfaces say `filled`
 * because this atlas ships something that fills each; it is the coverage CELL, never this flag, that says
 * HOW MUCH.
 *
 * ## The two ceilings are unrelated, and neither is a role
 *
 * The API channel presents an internal integration's token, whose reach is the set of pages that
 * integration has been SHARED — a per-page grant, nothing to do with any human's role. The browser channel
 * sees what the signed-in person's own workspace role and plan open. The two are granted independently and
 * can differ on any workspace, so one `visibilityScope` for the atlas would be false about one channel whichever value it took;
 * `model.ts`'s `NotionVisibilityScope` is the pair, and a coverage cell carries whichever one produced it.
 */
import { type AtlasDescriptor, WEB_CLIENT_DISCOVERY_SURFACE } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { NOTION_ATLAS_KINDS, NOTION_ATLAS_PLATFORM } from "./model.js";

/** Notion's atlas, as it declares itself. */
export const NOTION_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "read-before-write",
  excludes: [
    {
      because:
        "workspace CONTENT — pages, databases, data-source rows and their bodies. The world model holds them (`src/corpus/notion/`), and its own reach pass enumerates every id the integration can currently see on every refresh, so a second census here would add drift without answering a different question. Notion's own Search endpoint is documented as not guaranteed to return every document, so neither copy could claim completeness anyway",
      ground: "held-elsewhere",
      holder: "`src/corpus/notion`, whose own reach pass enumerates every id the integration can see on every refresh",
    },
    {
      because:
        "the ROWS of a list surface: the member list, the connections list and the teamspace list are each one page entity with one screenshot, and the members, connections and teamspaces on them are not entities here",
      ground: "not-fetched",
      wouldBeClosedBy:
        "holding the member, connection and teamspace rows a list page renders, rather than the page alone",
    },
    {
      because:
        "any settings page reachable only to a role or plan the signed-in account does not hold — the organization console, gated on an organization-level role, is the standing example. Absent because it cannot be seen, which is a different fact from absent because it does not exist, and the browser channel's coverage cell carries which",
      ground: "not-fetched",
      wouldBeClosedBy: "an account holding the role or plan the organization console needs",
    },
    {
      because:
        'mutations of any kind — this ATLAS only ever reads. The page walk navigates and never clicks at all; the settings transport beside it clicks exactly two disclosures (the workspace switcher, then its `Settings` item) and then only a `role="tab"` the settings click itself created, so the modal\'s own destructive controls are not in any set it can select from. `slopweaver notion page` does write to Notion, and deliberately publishes nothing here: a generation records what was observed, never what this machine changed',
      ground: "never-acted",
    },
    {
      because:
        "a screenshot of any content page. The owner's ruling names settings and admin pages; photographing the workspace's own documents would be holding the entities by another route",
      ground: "never-acted",
    },
  ],
  kinds: [...NOTION_ATLAS_KINDS],
  platform: NOTION_ATLAS_PLATFORM,
  question:
    "what surfaces does this Notion workspace expose — every settings and admin page a browser can reach, and every endpoint the installed client declares — and which of them can this account actually see",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas notion refresh",
  surfaces: [
    {
      denominator: {
        because:
          "the official Notion SDK's method surface is compiled into this atlas's own registry, and that registry has not yet been split into methods reached and methods never called",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "sdk-declared",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Notion's web client publishes no route manifest, and its page tree is the workspace's own content rather than a fixed surface",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "browser-walk",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    WEB_CLIENT_DISCOVERY_SURFACE,
  ],
  visibilityScope:
    "the API channel sees exactly what this internal integration has been shared, page by page, and carries no human's role at all; the browser channel sees exactly what the signed-in person's own workspace role and plan open. Neither implies the other, and 'complete' here is always complete for the channel named on the cell",
};
