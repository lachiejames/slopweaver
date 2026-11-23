/**
 * The `handover` noun's board reads — `list`, the whole board, `row`, one row of it without the rest,
 * `steers`, the board's call-anchored rows joined to main, and `alignment-board`, every row's placement fields
 * for the console's Alignment count.
 *
 * Its own module for the reason `./handoverRulings.ts` is: `./handover.ts` sits at the file-size ratchet's
 * cap, and these verbs share a seam a reader would draw anyway — each reads the board and writes nothing.
 * `row` exists for a caller that cannot wait the whole board's seconds.
 *
 * It is NOT a second declaration: each entry is declared here and nowhere else, and `./handover.ts` spreads
 * this object into the one `handoverManifest` the barrel folds. Every `usage` is a LITERAL, kept honest by
 * the help-truth ratchet.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `handover list`, `handover row`, `handover steers` and `handover alignment-board`, the board's reads. */
export const handoverBoardReadManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "alignment-board": lazy({
    load: () => import("../commands/handover/alignmentBoardRun.js").then((m) => m.handoverAlignmentBoardCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      // Reads the projection; rewrites it from the board when it is missing or will not read.
      effect: "local-state",
      example: "slopweaver handover alignment-board --json",
      parseRejectIsIoFree: true,
      summary:
        "Every board row's placement fields from the Alignment projection, rebuilt from the board when it will not read",
      usage: "usage: slopweaver handover alignment-board [--home <dir>] [--json]",
    },
  }),
  list: lazy({
    load: () => import("../commands/handover/run.js").then((m) => m.handoverListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover list",
      parseRejectIsIoFree: true,
      summary: "List the orchestration docs — what is runnable, what looks shipped, what is in flight, and why",
      usage:
        "usage: slopweaver handover list [--all] [--probe] [--base <branch>] [--deadline <seconds>] " +
        "[--dir <path>] [--home <dir>] [--json] [--tag <key=value|key|!key>[,...]]...",
    },
  }),
  row: lazy({
    load: () => import("../commands/handover/rowRun.js").then((m) => m.handoverRowCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover row --slug my-doc --json",
      parseRejectIsIoFree: true,
      summary: "One board row, composed as `list` composes it, from that doc and its dependencies alone",
      usage:
        "usage: slopweaver handover row --slug <slug> [--base <branch>] [--dir <path>] [--home <dir>] [--full] [--json]",
    },
  }),
  steers: lazy({
    load: () => import("../commands/handover/steersRun.js").then((m) => m.handoverSteersCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      // The board, the run journals, `git rev-parse` and `git log` of each named repository's main, and the PR
      // ledger. No probe, no fetch, no network.
      effect: "none",
      example: "slopweaver handover steers --json",
      parseRejectIsIoFree: true,
      summary:
        "Every steer the owner gave on a call, newest first, and whether it has been applied — its pull request landed on main",
      usage: "usage: slopweaver handover steers [--home <value>] [--json]",
    },
  }),
};
