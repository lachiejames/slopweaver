/**
 * One batch of call lines on its way to `talk transcript`'s append (`./callStore.ts`): read from a file a hand run
 * names, or parsed from the text the console piped on stdin, so its unmasked lines are never staged on disk. Either
 * way every line must be a call line, no write id may repeat, and a batch past `CALL_BATCH_MAX` is refused whole.
 */
import { readJsonlLines } from "../corpus/corpusStore.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { CALL_BATCH_MAX, type CallEntry, callEntryOf } from "./callRecord.js";
import { REPEATED_WRITE_ID, repeatsWriteId } from "./callWriteIds.js";
import { type TalkError, TalkErrors } from "./errors.js";

/**
 * Read a batch of call lines from a JSONL file — every line must parse, or none is appended.
 *
 * @param path the batch file a hand run names
 * @returns the entries, or why the batch is refused
 */
export function readCallBatch({ path }: { path: string }): Result<readonly CallEntry[], TalkError> {
  const entries: CallEntry[] = [];
  const bad: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        collectBatchLine({ bad, entries, index, line });
      },
      path,
    });
  } catch (cause) {
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
  return batchVerdict({ bad, entries, path });
}

/**
 * Parse a batch of call lines already read whole — the console's batch, piped on stdin so its unmasked lines are
 * never staged on disk. Every line must parse, or none is appended.
 *
 * @param text the batch, one JSON object per line
 * @param source what the batch is called in a refusal (`stdin`)
 * @returns the entries, or why the batch is refused
 */
export function parseCallBatch({
  text,
  source,
}: {
  text: string;
  source: string;
}): Result<readonly CallEntry[], TalkError> {
  const entries: CallEntry[] = [];
  const bad: number[] = [];
  text.split("\n").forEach((line, index) => {
    collectBatchLine({ bad, entries, index, line });
  });
  return batchVerdict({ bad, entries, path: source });
}

/**
 * Take one line of a batch: a blank one is skipped, a call line kept, anything else counted by its line number.
 *
 * @param index the line's zero-based position
 * @param entries the call lines so far, added to
 * @param bad the 1-based numbers of the lines that are not call lines, added to
 */
function collectBatchLine({
  line,
  index,
  entries,
  bad,
}: {
  line: string;
  index: number;
  entries: CallEntry[];
  bad: number[];
}): void {
  if (line.trim() === "") {
    return;
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "call transcript line", text: line });
  } catch {
    bad.push(index + 1);
    return;
  }
  const entry = callEntryOf({ value });
  if (entry === undefined) {
    bad.push(index + 1);
    return;
  }
  entries.push(entry);
}

/**
 * The whole batch judged once every line is taken: no line that is not a call line, no write id twice, no more than
 * one batch may carry.
 *
 * @param entries the call lines
 * @param bad the 1-based numbers of the lines that are not call lines
 * @param path what the batch is called in a refusal
 * @returns the entries, or why the batch is refused
 */
function batchVerdict({
  entries,
  bad,
  path,
}: {
  entries: readonly CallEntry[];
  bad: readonly number[];
  path: string;
}): Result<readonly CallEntry[], TalkError> {
  if (bad.length > 0) {
    return err(
      TalkErrors.callEntriesInvalid({ path, why: `line(s) ${bad.slice(0, 5).join(", ")} are not call lines` }),
    );
  }
  if (repeatsWriteId({ entries })) {
    return err(TalkErrors.callEntriesInvalid({ path, why: REPEATED_WRITE_ID }));
  }
  if (entries.length > CALL_BATCH_MAX) {
    return err(
      TalkErrors.callEntriesInvalid({
        path,
        why: `${String(entries.length)} lines is more than the ${String(CALL_BATCH_MAX)} one batch may carry`,
      }),
    );
  }
  return ok(entries);
}
