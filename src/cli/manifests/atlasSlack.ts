/**
 * The three Slack rows of the `atlas` noun, and the metadata they carry.
 *
 * ## Why these three left `atlas.ts`
 *
 * `src/cli/manifests/atlas.ts` crossed the 600-code-line cap, which the `file-size-ratchet` gate exists to
 * notice: that file grows by one row per atlas with no ceiling, and every atlas landing in the same wave
 * edits it, so it is both the largest and the most contended file in the noun. These three are the natural
 * cut rather than an arbitrary one. Every other row is `platformMeta`-shaped — the same generic pair of
 * verbs, differing only in platform name — while Slack's three predate that pair, spell their own metadata
 * out, and are the only rows keyed on something other than a platform name.
 *
 * `kit/contract.ts` makes ONE PLATFORM per atlas a type, and that is not weakened here: `slack`,
 * `slack-api` and `slack-drive` are three VERB rows over the one Slack atlas, which is why they were always
 * the exception this file now holds.
 */
import { ATLAS_SLACK_API_USAGE, ATLAS_SLACK_DRIVE_USAGE, ATLAS_SLACK_USAGE } from "../commands/atlas/slackUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const slackMeta = {
  createsWorkItem: false,
  diagnostic: true,
  // The map is a pure READ of two files this program already wrote, but the same row dispatches the kit's
  // `reset` and `restore`, which move generation directories under $SLOPWEAVER_HOME — so local-state, as
  // every other platform row is. No network call on any path, so no door.
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver atlas slack --never-read",
  parseRejectIsIoFree: true,
  summary:
    "The Slack map: every conversation known, which ones this account can actually read, and which have " +
    "never been looked at — read from local state, no network call",
  usage: ATLAS_SLACK_USAGE,
} as const;

const slackApiMeta = {
  createsWorkItem: false,
  diagnostic: true,
  // Reads the installed SDK's own .d.ts files and two committed tables. No network call, so no door.
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver atlas slack-api --field reply_count",
  parseRejectIsIoFree: true,
  summary:
    "The Slack API map: every Web API method the installed SDK declares, its arguments and response " +
    "fields, the tier and scopes for the pages that were read, and the undocumented surface the " +
    "first-party web client calls — read locally, no network call",
  usage: ATLAS_SLACK_API_USAGE,
} as const;

const slackDriveMeta = {
  createsWorkItem: false,
  diagnostic: true,
  // Reads a walk document and writes only the local atlas under $SLOPWEAVER_HOME — no Slack/GitHub/Linear
  // write, so this is local-state rather than external-write, exactly like `vanta sync`. It opens no
  // browser at all (docs/browser-route.md).
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver atlas slack-drive report",
  parseRejectIsIoFree: true,
  summary:
    "The Slack atlas's SURFACE MAP and its driven-browser surface: brief a walk of every page the map " +
    "declares in your own Chrome, publish those pages with the proof screenshots the owner asked for and " +
    "what the first-party web client called on each, report where it disagrees with the installed " +
    "SDK's declared API surface, and `refresh` the API half unattended — the scheduled resync's step",
  usage: ATLAS_SLACK_DRIVE_USAGE,
} as const;

/**
 * Every row the Slack atlas contributes to the `atlas` noun.
 *
 * Spread into `atlasManifest` rather than merged by hand, so adding or removing one is a change in this
 * file alone.
 */
export const atlasSlackManifest: Readonly<Record<string, VerbManifestEntry>> = {
  // The registry row for `slack` carries `atlasSlackCommand` as its FALLBACK, so this loader is the same
  // generic dispatcher every platform row uses: a kit verb goes to the kit, anything else is the map.
  slack: lazy({
    load: () => import("../commands/atlas/platformRun.js").then((m) => m.atlasPlatformCommand({ platform: "slack" })),
    meta: slackMeta,
  }),
  "slack-api": lazy({
    load: () => import("../commands/atlas/slackApiRun.js").then((m) => m.atlasSlackApiCommand),
    meta: slackApiMeta,
  }),
  "slack-drive": lazy({
    load: () => import("../commands/atlas/slackDriveRun.js").then((m) => m.atlasSlackDriveCommand),
    meta: slackDriveMeta,
  }),
};
