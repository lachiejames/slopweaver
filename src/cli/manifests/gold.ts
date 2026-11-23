/**
 * Lazy manifest for the `gold` noun — the GOLD-DEBT LEDGER: every pull request that merged below gold, what
 * gold proof would have been, and how the debt was eventually settled.
 *
 * `effect: "local-state"` for the two writers (`owe`, `settle`) and `"none"` for the reader (`debts`): every
 * write lands in `$SLOPWEAVER_HOME/ledgers/gold-debt.jsonl`, nothing external, no model. A merge at silver or bronze because gold was not feasible at the time
 * leaves gold OWED rather than waived.
 *
 * **Nothing here gates a merge.** The whole point of the ruling is that merging is not delayed; the debt is
 * remembered instead (`../../goldDebt/types.ts`).
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** The `gold` noun's verbs as lazy manifest entries. */
export const goldManifest: Readonly<Record<string, VerbManifestEntry>> = {
  debts: lazy({
    load: () => import("../commands/gold/debts.js").then((m) => m.goldDebtsCommand),
    meta: {
      ...sharedMeta,
      // A bare run reads the open gold debts and prints them, so it acts rather than printing usage.
      dryParseSafe: false,
      // Reads the register and renders it: `readGoldDebtLedger` stats and streams the file and never creates it.
      effect: "none",
      example: "slopweaver gold debts",
      summary:
        "Read the open gold debts, oldest first — what gold proof each one owes and what is blocking it, " +
        "so a reader can judge whether the condition has passed",
      usage: "usage: slopweaver gold debts [--settled | --all] [--repo <owner/name>] [--home <dir>] [--json]",
    },
  }),
  owe: lazy({
    load: () => import("../commands/gold/owe.js").then((m) => m.goldOweCommand),
    meta: {
      ...sharedMeta,
      example:
        "slopweaver gold owe https://github.com/lachiejames/slopweaver/pull/<number> --grade silver " +
        '--merged-iso 2026-09-24T19:50:57Z --by-session "workspace:gold-debt-ledger" ' +
        '--would-be "port 3000 on the main checkout rebuilding itself after a real pull" ' +
        '--blocked-on "the next commit landing on main after this one"',
      summary:
        "Record that ONE merged pull request still owes its gold proof — what gold would be, quoted from " +
        "its own why-not-gold sentence, and the condition that has to pass first",
      usage:
        "usage: slopweaver gold owe <pull-request-url> --grade silver|bronze --merged-iso <iso> " +
        "--would-be <text> --blocked-on <text> --by-session <text> [--pull-request <url>] " +
        "[--title <text>] [--run <slug>] [--recorded-iso <iso>] [--home <dir>] [--json]",
    },
  }),
  settle: lazy({
    load: () => import("../commands/gold/settle.js").then((m) => m.goldSettleCommand),
    meta: {
      ...sharedMeta,
      example:
        'slopweaver gold settle lachiejames/slopweaver#<number> --evidence "<link to the sent message>" ' +
        '--regrade "the description now carries a gold review, graded with `github pr update --edit`" ' +
        '--by-session "workspace:gold-debt-ledger"',
      summary:
        "Close one gold debt — the evidence exists now, or it never can — and say openly what the merged " +
        "pull request was re-graded to. It records; editing the description stays yours",
      usage:
        "usage: slopweaver gold settle <pull-request-url | owner/repo#number> --evidence <text> " +
        "--by-session <text> [--as gathered|moot] [--regrade <text>] [--proof-commit <sha>] " +
        "[--settled-iso <iso>] [--home <dir>] [--json]",
    },
  }),
};
