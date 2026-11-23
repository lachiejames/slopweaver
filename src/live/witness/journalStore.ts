/**
 * The witness journal's effectful edge: append one event, read every event back.
 *
 * `$SLOPWEAVER_HOME/live/slack/witness-outcomes.jsonl`, declared in `../../stateHome.ts`. Appended through the
 * listener queue's fsynced `appendQueueLine`, read through the streamed `readJsonlLines` (the log is
 * append-only with no ceiling, so it is never read as one string).
 *
 * **The read refuses the WHOLE journal on one malformed line**, where `../turn/supersession/store.ts`'s audit
 * read tolerates one. The difference is what the rows are for: every reader of this journal is about to
 * decide whether to boot a worker or write a terminal, and the row it skipped may be the live dispatch or
 * the terminal that makes that act a duplicate. An absent file is a fresh install and reads as empty; every
 * other open failure is a refusal.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { readJsonlLines } from "../../corpus/corpusStore.js";
import { stateHomePaths } from "../../stateHome.js";
import { appendQueueLine } from "../listen/queueFile.js";
import { type WitnessJournalError, WitnessJournalErrors } from "./errors.js";
import { parseWitnessJournalLine } from "./journal.js";
import type { WitnessJournalEvent } from "./types.js";

/**
 * The witness journal's absolute path.
 *
 * @param home the state home; the resolved home when absent
 * @returns the path to `live/slack/witness-outcomes.jsonl`
 */
export function witnessJournalPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).live.slack.witnessOutcomesJsonl;
}

/** Whether a line is empty by JSON's own definition of whitespace — never `String.prototype.trim`'s wider one. */
function isBlankLine({ line }: { line: string }): boolean {
  for (const character of line) {
    if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") {
      return false;
    }
  }
  return true;
}

/**
 * Read every journal event, in file order, refusing the whole journal on the first malformed line.
 *
 * @param home the state home; the resolved home when absent
 * @returns every event, an empty list when the journal does not exist yet, or why it could not be trusted
 */
export function readWitnessJournal({ home }: { home?: string } = {}): Result<
  readonly WitnessJournalEvent[],
  WitnessJournalError
> {
  const path = witnessJournalPath(home === undefined ? {} : { home });
  const events: WitnessJournalEvent[] = [];
  let malformed: WitnessJournalError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (malformed !== undefined || isBlankLine({ line })) {
          return;
        }
        const parsed = parseWitnessJournalLine({ line, lineNumber: index + 1, path });
        if (parsed.isErr()) {
          malformed = parsed.error;
          return;
        }
        events.push(parsed.value);
      },
      path,
    });
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return ok([]);
    }
    return err(WitnessJournalErrors.unreadable({ cause, path }));
  }
  if (malformed !== undefined) {
    return err(malformed);
  }
  return ok(events);
}

/**
 * Append one event as one fsynced line.
 *
 * @param event the event to append
 * @param home the state home; the resolved home when absent
 * @returns ok once the line is durable, or why the append threw
 */
export function appendWitnessEvent({
  event,
  home,
}: {
  event: WitnessJournalEvent;
  home?: string;
}): Result<void, WitnessJournalError> {
  const path = witnessJournalPath(home === undefined ? {} : { home });
  try {
    appendQueueLine({ line: JSON.stringify(event), path });
  } catch (cause) {
    return err(WitnessJournalErrors.writeFailed({ cause, path }));
  }
  return ok(undefined);
}
