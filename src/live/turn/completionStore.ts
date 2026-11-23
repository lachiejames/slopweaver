/**
 * The completion ledger's effectful edge: append one event, read the log back.
 *
 * Owner-only, same treatment as the queue log and for the same reason — a completion carries the ask's
 * identity and provenance, which nothing else may read. `mkdirSync`'s own `mode` option is umask-masked and
 * never tightens an EXISTING directory (measured: a home initialised before this handover keeps whatever
 * mode it already had), so an unconditional `chmodSync` right after is what actually closes that gap — the
 * same fix `judgementProfileStore.ts` already applies to `$home/judgement`.
 */
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "../../lib/appendSeparator.js";
import { stateHomePaths } from "../../stateHome.js";
import { turnCompletionEventLine } from "./completionLog.js";
import type { CompletionSink, TurnCompletionEvent } from "./envelope.js";

/** The completion log's filename under `$SLOPWEAVER_HOME/ledgers`. */
const COMPLETION_LOG_FILE = "turn-completions.jsonl";

/** Owner-only permissions: a completion carries the ask's identity and the model that answered it. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The completion log's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `turn-completions.jsonl`
 */
export function completionLogPath({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).ledgers, COMPLETION_LOG_FILE);
}

/**
 * Append one completion event, creating and tightening the directory if needed.
 *
 * @param event the event to append
 * @param home the state home (defaults to the resolved home)
 */
export function appendTurnCompletionEvent({ event, home }: { event: TurnCompletionEvent; home?: string }): void {
  const dir = stateHomePaths(home === undefined ? {} : { home }).ledgers;
  mkdirSync(dir, { mode: DIR_MODE, recursive: true });
  chmodSync(dir, DIR_MODE);
  const path = join(dir, COMPLETION_LOG_FILE);
  appendLines({ mode: FILE_MODE, path, text: `${turnCompletionEventLine({ event })}\n` });
  chmodSync(path, FILE_MODE);
}

/**
 * Read the completion log's raw text. An absent log — a home with no completed turns yet — is the empty
 * string, not an error.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the log contents, or `""` when there is no log yet
 */
export function readTurnCompletionText({ home }: { home?: string } = {}): string {
  try {
    return readFileSync(completionLogPath(home === undefined ? {} : { home }), "utf8");
  } catch {
    return "";
  }
}

/**
 * The live completion sink: append to the durable ledger.
 *
 * A ledger append failure REJECTS rather than swallowing — the caller (`runTurn`) has already sent the
 * Slack answer by the time this runs, so a caller that retries blindly on this rejection risks a duplicate
 * send. That is a real, accepted limitation (see the handover's own proof boundary): this sink cannot make
 * the append retry-safe, only loud, and the loudness is what stops a naive retry reading as the safe repair.
 *
 * @param home the resolved state home
 * @param nowIso the clock, injected so an event's instant is assertable
 * @returns the sink {@link CompletionSink} a turn appends through
 */
export function liveCompletionSink({
  home,
  nowIso = () => new Date().toISOString(),
}: {
  home: string;
  nowIso?: () => string;
}): CompletionSink {
  return async ({ completion }) => {
    appendTurnCompletionEvent({ event: { completion, kind: "turn-completed", tsIso: nowIso() }, home });
  };
}
