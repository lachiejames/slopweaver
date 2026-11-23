/**
 * Lazy manifest for the `sweep` noun — superseded context is found by the evidence it carries and deleted by
 * default, with one rail: every act is journalled with its witness, so what the sweep took stays findable.
 *
 * `apply` and `board` are `effect: "external-read"`: both read GitHub
 * for each pull request a live ask's question names (the `PR_ENDED` verdict), and every
 * write is local — `board --write` replaces `$SLOPWEAVER_HOME/live/hygiene/sweep-board.jsonl` and the census beside
 * it, `--queue` registers one local board row a day and settles its own earlier ones, `--settle-ended`,
 * `--close-shipped` and `apply` run the register's own `handover close` / `handover settle` and append to
 * `$SLOPWEAVER_HOME/ledgers/sweep.jsonl`. `list` only reads that
 * ledger back and `recheck` only prints a list of the board, so both are `none`. **No model** — AGENTS.md rule 2 is why the automatic half has to be pure code.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  parseRejectIsIoFree: true,
} as const;

/** The `sweep` noun's verbs as lazy manifest entries. */
export const sweepManifest: Readonly<Record<string, VerbManifestEntry>> = {
  apply: lazy({
    load: () => import("../commands/sweep/applyRun.js").then((m) => m.sweepApplyCommand),
    meta: {
      ...sharedMeta,
      dryParseSafe: true,
      effect: "external-read",
      example: 'slopweaver sweep apply some-row-291-4 --session "workspace:151"',
      summary:
        "Perform ONE row's act by running the register's own verb — `handover close`, `handover settle " +
        "--as declined` only with the owner's own --reason and --anchor, or `--as answered` on GitHub's record " +
        "for PR_ENDED — then journal it. Never a batch, and nothing edits a `status:` line",
      usage:
        "usage: slopweaver sweep apply <slug> --session <text> [--why <text>] " +
        '[--reason "<their words>" --anchor "<where they said it>"] [--dir <path>] [--home <dir>] [--now <iso>] [--json]',
    },
  }),
  board: lazy({
    load: () => import("../commands/sweep/boardRun.js").then((m) => m.sweepBoardCommand),
    meta: {
      ...sharedMeta,
      // Every flag is optional: a bare `runSweepBoard` scans the board and prints a verdict report (and `--write` replaces the board file).
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver sweep board --priority p0 --probe",
      summary:
        "Classify every live board row against the evidence it carries — contradicted, shipped, its pull " +
        "requests ended, orphaned, superseded or unwitnessed — and every closed ask whose page never reached the owner's " +
        "Queue, with no model and no tokens; --queue registers one daily card naming each uncarded page and " +
        "retires its own stale ones, --settle-ended settles PR_ENDED asks, --close-shipped closes SHIPPED rows",
      usage:
        "usage: slopweaver sweep board [--verdict <name>] [--priority <p>] [--probe] [--base <branch>] " +
        "[--deadline <seconds>] [--dir <path>] [--home <dir>] [--json] [--write [--queue] [--settle-ended] [--close-shipped]]",
    },
  }),
  list: lazy({
    load: () => import("../commands/sweep/listRun.js").then((m) => m.sweepListCommand),
    meta: {
      ...sharedMeta,
      // Every flag is optional: a bare `runSweepList` reads the sweep ledger back and prints it, and writes nothing.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver sweep list --slug some-row-291-4",
      summary:
        "Read the sweep ledger back — every act performed, the verdict and witness that chose it, and the " +
        "exact register verb line it ran. The RAIL: what the sweep took stays findable",
      usage: "usage: slopweaver sweep list [--slug <slug>] [--home <dir>] [--json]",
    },
  }),
  recheck: lazy({
    load: () => import("../commands/sweep/recheckRun.js").then((m) => m.sweepRecheckCommand),
    meta: {
      ...sharedMeta,
      // Every flag is optional: a bare `runSweepRecheck` reads the board and prints the list, and writes nothing.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver sweep recheck --limit 5",
      summary:
        "List the Queue cards the morning seat reads against later evidence — asks waiting on the owner that " +
        "nobody is on and nobody verified today, by priority then least recently verified. Age is never evidence",
      usage: "usage: slopweaver sweep recheck [--limit <n>] [--dir <path>] [--home <dir>] [--json]",
    },
  }),
};
