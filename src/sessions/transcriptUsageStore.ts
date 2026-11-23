/**
 * Fold a whole session transcript's usage off disk, one line at a time.
 *
 * ## Why this is not `readFileSync`
 *
 * A transcript reaches tens of megabytes — 42 MB was the largest on this machine when `sessions/sessionCost.ts`
 * measured it — and the size comes from the DATA rather than from the code. That is exactly the class
 * `.claude/rules/typescript-patterns.md` bans from passing through one JS string, so the read goes through
 * `readJsonlLines` and hands each complete line to the pure fold in `sessions/sessionCost.ts`. Nothing here ever
 * holds more than one line.
 *
 * ## One report, once, over the whole file
 *
 * A supervisor asks for one report over the whole file, with no cursor kept between calls, so a read-only
 * verb holds no state that could make a gauge unsafe to run.
 *
 * The FOLD is `advanceCursor`'s, and that is the part that matters: it carries the `message.id`
 * deduplication. A second fold that forgot it would read 1.67x high (MEASURED across 822
 * transcripts: 222,295 usage-bearing lines resolve to 133,445 distinct turns).
 */
import { readJsonlLines } from "../corpus/corpusStore.js";
import { type Measured, measured, unmeasurable } from "../measurement/status.js";
import { advanceCursor, type CostCursor, EMPTY_CURSOR } from "./sessionCost.js";

/**
 * Fold one transcript in full.
 *
 * @param path the transcript to read
 * @returns the completed cursor, or why nothing could be folded — never a comforting zero, because a zero
 *   on a spend report reads as "this session was free" rather than "this file could not be opened"
 */
export function readTranscriptUsage({ path }: { path: string }): Measured<CostCursor> {
  let cursor = EMPTY_CURSOR;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        cursor = advanceCursor({ chunk: `${line}\n`, cursor });
      },
      path,
    });
  } catch (error) {
    return unmeasurable({
      why: `transcript could not be read (${error instanceof Error ? error.message : "unknown error"})`,
    });
  }
  return measured({ value: cursor });
}
