/**
 * Lazy manifest for the `reading` noun — the READINGS LEDGER: the last document each slow verb printed,
 * who took it and when it was true, so a page shows a reading and says which one instead of taking a
 * 68-second read itself and calling that live.
 *
 * `effect: "local-state"` for `record`, whose write lands under `$SLOPWEAVER_HOME/readings/`; `last` and `list` only
 * read the ledger, so they are `none`. Nothing external, no model.
 * The page reads a readings
 * ledger, not the tick row alone (the board-said-green failure).
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

/** The `reading` noun's verbs as lazy manifest entries. */
export const readingManifest: Readonly<Record<string, VerbManifestEntry>> = {
  last: lazy({
    load: () => import("../commands/reading/last.js").then((m) => m.readingLastCommand),
    meta: {
      ...sharedMeta,
      // `lastReading` only reads the index and one document; `--producer` is required, so a bare run refuses before it.
      effect: "none",
      example: 'slopweaver reading last --producer "github landing" --json',
      summary:
        "The latest reading one producer recorded, with its document — what a console page reads instead " +
        "of running the verb; exits 3 when there is none yet",
      usage: "usage: slopweaver reading last --producer <verb line> [--home <dir>] [--json]",
    },
  }),
  list: lazy({
    load: () => import("../commands/reading/list.js").then((m) => m.readingListCommand),
    meta: {
      ...sharedMeta,
      // Every flag is optional: a bare run calls `readReadingIndex` and lists the ledger. It only reads, so `none`.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver reading list",
      summary: "Every reading the ledger holds, oldest first — when, by whom, which producer, how many bytes",
      usage: "usage: slopweaver reading list [--producer <verb line>] [--home <dir>] [--json]",
    },
  }),
  record: lazy({
    load: () => import("../commands/reading/record.js").then((m) => m.readingRecordCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver reading record --producer "github landing" --from /tmp/landing.json --by tick-12',
      summary:
        "Append ONE verb's printed --json document to the readings ledger, as the bytes it printed, with " +
        "who took the reading and when it was true",
      usage:
        "usage: slopweaver reading record --producer <verb line> --from <file> --by <who> " +
        "[--observed-at <iso>] [--home <dir>] [--json]",
    },
  }),
};
