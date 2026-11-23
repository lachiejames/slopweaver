/**
 * The three `store authored-*` rows and `store slack-asks`: the authored working state read back OUT of the store.
 *
 * Split out of `./store.ts` the way `./atlasEstate.ts` left `./atlas.ts`: that manifest crossed its
 * `file-size-ratchet` cap when these landed. They belong together on a property the other `store` rows do not
 * share — all four read only what `store import-fleet --only authored` wrote, and never the disk copy.
 */
import {
  AUTHORED_LIST_USAGE,
  AUTHORED_RESTORE_USAGE,
  AUTHORED_SHOW_USAGE,
  SLACK_ASKS_USAGE,
} from "../commands/store/authoredUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `store authored-list` — the authored working state the store holds, one line per path. */
const authoredListMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver store authored-list --directory briefs",
  parseRejectIsIoFree: true,
  summary:
    "List every authored working-state file the store holds at its newest version, with how many versions it keeps — reads the store only",
  usage: AUTHORED_LIST_USAGE,
} as const;

/** `store authored-show` — one authored file's newest stored bytes, from the store and never from disk. */
const authoredShowMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver store authored-show --ref ~/.slopweaver/briefs/<slug>.md",
  parseRejectIsIoFree: true,
  summary:
    "Print one authored file's newest bytes from the store — never from disk, so a file the home lost still reads; a binary body needs --out",
  usage: AUTHORED_SHOW_USAGE,
} as const;

/** `store authored-restore` — every stored authored file the home is missing, written back. */
const authoredRestoreMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store authored-restore --dry-run",
  parseRejectIsIoFree: true,
  summary:
    "Write back every authored working-state file the home is missing from the store, hash-checked, never overwriting a present file",
  usage: AUTHORED_RESTORE_USAGE,
} as const;

/** `store slack-asks` — the ask ledger's stored bytes, folded: which asks were answered and which stranded. */
const slackAsksMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver store slack-asks --stranded",
  parseRejectIsIoFree: true,
  summary:
    "Which Slack asks the bot answered and which it stranded, folded from the stored ask ledger — reads the store only",
  usage: SLACK_ASKS_USAGE,
} as const;

export const storeAuthoredManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "authored-list": lazy({
    load: () => import("../commands/store/authoredRun.js").then((m) => m.storeAuthoredListCommand),
    meta: authoredListMeta,
  }),
  "authored-restore": lazy({
    load: () => import("../commands/store/authoredRun.js").then((m) => m.storeAuthoredRestoreCommand),
    meta: authoredRestoreMeta,
  }),
  "authored-show": lazy({
    load: () => import("../commands/store/authoredRun.js").then((m) => m.storeAuthoredShowCommand),
    meta: authoredShowMeta,
  }),
  "slack-asks": lazy({
    load: () => import("../commands/store/slackAsksRun.js").then((m) => m.storeSlackAsksCommand),
    meta: slackAsksMeta,
  }),
};
