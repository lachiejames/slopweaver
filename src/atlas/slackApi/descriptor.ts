/**
 * What the Slack atlas declares about itself — the row a catalogue shows, and the first `driven-browser`
 * surface in this repository that is allowed to say `filled`.
 *
 * ## Why `filled` is earned here and was not by the file next door
 *
 * `browser.ts` in this same directory holds browser-observed rows and has since before the kit existed —
 * and it is NOT this surface. It was reduced from a HAR file somebody saved by hand, which is exactly the
 * acquisition the kit refuses to name: "a hand-saved HAR file or an exported archive would make population
 * a manual step the owner performs", and a surface must not claim `filled` "on the strength of a file
 * somebody made once". What fills the surface declared here is `drivenSession.ts` — an agent taking control
 * of a visible browser, walking the workspace's own pages, and recording what the first-party client asked
 * for, through one command that can be run again tomorrow.
 *
 * ## Both surfaces are `authoritative`, for different facts, and neither corroborates the other
 *
 * The tempting shape is `api: authoritative, browser: corroborating`, and it would be wrong. Each surface
 * is the source of record for its own question: the SDK is authoritative on what an ordinary token may
 * send, and only the browser can establish that a method EXISTS and returns a field — a fact the SDK is
 * silent on rather than contradicting. Grading the browser `corroborating` would say its unique findings
 * "may never satisfy an authoritative obligation alone", which is the API-only posture that gave stupid
 * answers about things plainly visible in the browser.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { SLACK_ATLAS_KINDS, SLACK_ATLAS_PLATFORM, SLACK_ATLAS_VISIBILITY_SCOPE } from "./atlasModel.js";

/** Slack's atlas, as it declares itself. */
export const SLACK_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "read-before-write",
  excludes: [
    {
      because:
        "message content in any stored FIELD — every field a record carries is a name, whether a method, a parameter or a response field path",
      ground: "names-not-values",
    },
    {
      because:
        "any promise that a page SCREENSHOT is free of message content: it is a photograph of a real signed-in client, and a view such as the activity inbox renders message previews, member names and channel names inside its own chrome. Measured. The surface map refuses a picture of every message-bearing view by declaration (surfacePages.ts), and no declaration can refuse a rendered preview, so the honest boundary is that artifacts live only under $SLOPWEAVER_HOME beside the Slack corpus that already holds the same messages, and are never committed",
      ground: "claim-not-made",
    },
    {
      because:
        "Slack's ENTITIES — its channels, people, usergroups and messages. Owner ruling (docs/atlas-intent/06-holdings.md): this atlas holds the SURFACE MAP, because the corpus already holds the entities and a second copy is a second thing to keep in sync. That is not an omission and it is not `excluded` either — the `page` kind carries a `held-elsewhere` coverage cell naming the corpus, so a reader who mistakes this atlas for an entity index is corrected by the file rather than by finding it empty",
      ground: "held-elsewhere",
      holder: "the world model's corpus, which holds Slack's channels, people, usergroups and messages",
    },
    {
      because:
        "how far each conversation has been read: that is `slopweaver atlas slack`, a separate pure read that this generation does not yet fold in",
      ground: "held-elsewhere",
      holder: "`slopweaver atlas slack`, a separate pure read this generation does not yet fold in",
    },
    {
      because:
        "anything a different member's session would reach — an admin console's own calls are outside one member's entitlements, which is what visibilityScope means",
      ground: "claim-not-made",
    },
    {
      because:
        "mutations of any kind — both surfaces only ever read, and the driven browser navigates without clicking anything that writes",
      ground: "never-acted",
    },
  ],
  kinds: [...SLACK_ATLAS_KINDS],
  platform: SLACK_ATLAS_PLATFORM,
  question:
    "what pages Slack has for one member and where each one lives, plus what can be asked of its Web API through the published SDK and through the first-party web client, and where the two disagree",
  // `refresh`, not `sync`: a scheduled pass has no walk document to hand `sync --session`, and a row pointed
  // at `sync` failed on every firing (board finding). `refresh` publishes the API half unattended
  // and briefs the walk still owed — the same two-phase shape GraphQL Hive and WorkOS declare.
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas slack-drive refresh",
  surfaces: [
    {
      denominator: {
        because:
          "Slack publishes no catalogue of its `api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "api",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Slack publishes no catalogue of its `browser` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "browser",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
  ],
  visibilityScope: SLACK_ATLAS_VISIBILITY_SCOPE,
};
