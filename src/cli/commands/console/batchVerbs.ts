/**
 * The verbs `slopweaver console batch` will run, and nothing else — a LEAF, importing nothing, so the console's own
 * test can pin its reads against it (`site/__tests__/unit/voiceRecordBatch.test.ts`).
 *
 * Why a list rather than every registered read verb: a batch item's output is ITS only while it writes through a
 * door the collector sees (`#lib/outputCollect.js`). A verb that writes descriptor 1 with its own `writeSync`, or
 * spawns a child inheriting it, writes straight onto the batch's stdout, outside every item's line — `dev gate` was
 * the counterexample a review found, a `local-state` verb the effect check alone let through. Each verb below was
 * run in a batch and as its own child and printed the same bytes both ways; a verb joins only on that witness.
 * Reproduce: the `re-run` section of the pull request that added this list.
 */

/** The command words (no flags) each allowed item begins with, the noun already its current name. */
export const CONSOLE_BATCH_VERBS: readonly (readonly string[])[] = [
  ["autonomy", "list"],
  ["github", "reviewer", "list"],
  ["hand", "list"],
  ["profile", "standing"],
  ["queue", "deferred"],
  ["queue", "list"],
  ["reading", "last"],
  ["slack", "draft", "list"],
  ["store", "import-questions"],
  ["talk", "cards"],
  ["talk", "steers"],
  ["workstreams", "list"],
];
