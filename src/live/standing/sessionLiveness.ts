/**
 * Whether each of the two standing sessions that run without a supervisor is ALIVE right now — the Slack loop,
 * read off the listener's own arm record and heartbeat, and the credential keep-alive, read off the record it
 * stamps about itself. Liveness only: which commit each one runs is `./inspect.ts`'s measurement, joined by the
 * verbs that report both (`cli/commands/session/standingFreshness.ts`).
 *
 * ## The loop is anchored on the LISTENER's pid, not on the session ledger
 *
 * Measured: the ledger recorded two `spawned` rows for one loop slug and a single `closed` row
 * carrying no workspace, so the fold collapsed the pair and `session standing` read the loop as NOT live
 * while `listen status` read it healthy, its arm beating. A gauge
 * whose one job is to say the bot is dark cannot have a false negative that big, so liveness comes from the
 * arm record and the heartbeat (which the listener itself writes, and which cannot be wrong about a process
 * that is not running), and the ledger supplies ATTRIBUTION only — which slug, which workspace, which
 * worktree a human should look in.
 */
import { readFileSync } from "node:fs";

import { claudeErrorLines } from "../../claude/claudeErrors.js";
import {
  type ClaudeWatchLiveness,
  isWatchLive,
  parseWatchSession,
  WATCH_SESSION_FILE,
  watchSessionLiveness,
} from "../../claude/watchSession.js";
import { parseJson } from "../../lib/jsonParse.js";
import { isRecord } from "../../lib/parsers.js";
import { currentLiveness } from "../listen/supervise/currentLiveness.js";
import { type ListenerGrade, listenerGrade } from "../listen/supervise/report.js";
import { type ProcessSnapshot, sameCheckoutOnDisk } from "./inspect.js";

/**
 * What the listener's own records say about the loop right now.
 *
 * @internal
 */
export interface LoopLiveness {
  readonly grade: ListenerGrade;
  /** True for `healthy` and `degraded` — a reconnecting listener is listening, and is not the bot being dark. */
  readonly live: boolean;
  /** The armed listener's pid, the anchor every tree measurement hangs off. */
  readonly pid: number | undefined;
  readonly armId: string | undefined;
  readonly problems: readonly string[];
}

/**
 * Read the loop's liveness from the arm record and the heartbeat — never from the session ledger.
 *
 * @param home the resolved state home
 * @param nowMs the current instant, epoch milliseconds
 * @returns the grade, whether it counts as live, and the pid to anchor a tree measurement on
 */
export function loopLiveness({ home, nowMs }: { readonly home: string; readonly nowMs: number }): LoopLiveness {
  const { liveness, problems } = currentLiveness({ home, nowMs });
  const grade = listenerGrade({ liveness });
  return {
    armId: "armId" in liveness ? liveness.armId : undefined,
    grade,
    live: grade === "healthy" || grade === "degraded",
    pid: "pid" in liveness ? liveness.pid : undefined,
    problems,
  };
}

/**
 * What the keep-alive loop's own record says about it right now, reconciled against the process table.
 *
 * @internal
 */
export interface KeepAliveLiveness {
  readonly liveness: ClaudeWatchLiveness;
  readonly live: boolean;
  /** The run the record names, for attribution — never the anchor of a measurement. */
  readonly watchId: string | undefined;
  /** The checkout the record names. Attribution only: freshness measures the RUNNING watches' checkouts. */
  readonly cwd: string | undefined;
}

/**
 * Read the record file, separating "not there" from "there and unreadable".
 *
 * @param path the record's path
 * @returns the file's text when it is there, `text: undefined` when it is genuinely absent, or the reason
 *   it could not be read at all
 */
function readRecordText({ path }: { readonly path: string }): {
  readonly text: string | undefined;
  readonly unreadable: string | undefined;
} {
  try {
    return { text: readFileSync(path, "utf8"), unreadable: undefined };
  } catch (cause: unknown) {
    const code = isRecord(cause) ? cause["code"] : undefined;
    if (code === "ENOENT") {
      return { text: undefined, unreadable: undefined };
    }
    return { text: undefined, unreadable: `the keep-alive record at ${path} could not be read (${String(code)})` };
  }
}

/**
 * Decode the record's text, treating unparseable content as a value the parser will refuse.
 *
 * `null` is deliberately what an undecodable body becomes rather than `undefined`: `undefined` means
 * absence to {@link parseWatchSession}, and a file full of noise is present.
 *
 * @param text the file's contents, or undefined when there was no file
 * @returns the decoded value, `undefined` for a genuinely absent file, or `null` for undecodable content
 */
function decodeRecord({ text }: { readonly text: string | undefined }): unknown {
  if (text === undefined) {
    return undefined;
  }
  const decoded = parseJson({ text });
  return decoded.isOk() ? decoded.value : null;
}

/**
 * Read the keep-alive loop's liveness from the record it writes about ITSELF.
 *
 * `claude watch` has no listener, no socket and no cmux registration; the only artifact that can say it
 * is running is the one it stamps at the start of each tick. `claude/watchSession.ts` carries why that
 * record had to be invented and why every verdict it produces is reachable with the loop dead.
 *
 * The record is reconciled against ONE process-table snapshot the caller already took, the same one the
 * freshness measurement reads — `claude/watchSession.ts` carries why the record alone is not an answer, and
 * why two reads of the table would let the verdict and the measurement describe different instants.
 *
 * @param home the resolved state home
 * @param nowMs the current instant, epoch milliseconds
 * @param snapshot the one process-table reading this report takes for the keep-alive
 * @returns the verdict and whether it counts as live
 */
export function keepAliveLiveness({
  home,
  nowMs,
  snapshot,
}: {
  readonly home: string;
  readonly nowMs: number;
  readonly snapshot: ProcessSnapshot;
}): KeepAliveLiveness {
  // The record is read HERE rather than through `readJsonFile`, and that is the whole point. That helper
  // is the TOLERANT read: it collapses a missing file, an unparseable one and an unreadable one into one
  // `undefined` (`lib/jsonFile.ts`), which would make the `invalid` verdict unreachable through the only
  // path that runs in production — a truncated record would read as "no loop has ever run here" and send
  // an operator to start a loop instead of to the file. A check that cannot fire is worse than no check.
  //
  // Pairing `readJsonFile` with `existsSync` was tried and is not enough either: a parent directory the
  // operator cannot traverse fails BOTH closed, so the file exists and both halves say it does not. Only
  // the read's own error code separates "there is nothing here" from "there is something here I cannot
  // read", so that is what is asked.
  const path = `${home}/${WATCH_SESSION_FILE}`;
  const read = readRecordText({ path });
  const parsed = parseWatchSession({ value: decodeRecord({ text: read.text }) });
  const session = read.unreadable === undefined && parsed.isOk() ? parsed.value : undefined;
  let problems: readonly string[] = [];
  if (read.unreadable !== undefined) {
    problems = [read.unreadable];
  } else if (parsed.isErr()) {
    problems = claudeErrorLines({ error: parsed.error });
  }
  const liveness = watchSessionLiveness({ nowMs, problems, sameCheckout: sameCheckoutOnDisk, session, snapshot });
  return { cwd: session?.cwd, live: isWatchLive({ liveness }), liveness, watchId: session?.watchId };
}
