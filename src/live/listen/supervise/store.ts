/**
 * Durable I/O for listener supervision — the arm record, the heartbeat file, and the append-only arm
 * journal. Every decision this file's callers make is made by a pure function in a sibling module; this one
 * only reads and writes.
 *
 * Three read outcomes for the arm record, not two — missing (nothing armed, a valid state), unreadable (an
 * I/O fault) and malformed (a corrupt file, refused) — the same split `recoverScheduleStore.ts` documents,
 * and for a sharper reason here: a supervisor that reads a corrupt pidfile as "nothing armed" arms a SECOND
 * listener beside a live one, and Slack delivers a tag to exactly one of two Socket Mode connections.
 */
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { slopweaverHome } from "../../../config.js";
import { appendLines } from "../../../lib/appendSeparator.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { stateHomePaths } from "../../../stateHome.js";
import { type ListenerStateError, ListenerStateErrors } from "./errors.js";
import { type ListenerHeartbeat, parseListenerHeartbeat } from "./heartbeat.js";
import { type ListenerArm, parseListenerArm } from "./liveness.js";
import { type ListenerArmEvent, parseListenerArmEvent } from "./rearm.js";
import { parseSocketConnectionObservation, type SocketConnectionObservation } from "./socketBudget.js";

/** Owner-only, matching the rest of `live/` — this names a pid a signal can be sent to. */
const DIR_MODE = 0o700;

/**
 * Where a backgrounded arm's STDERR goes — its narration, and the evidence kept when it dies.
 *
 * A FRESH file per arm, never a shared append target: measured, a re-armed listener appending
 * to its predecessor's log left `tail` showing "connected to Slack over Socket Mode" from a process that no
 * longer existed. Deliberately separate from {@link listenerMentionsPath} — see that function for why the
 * two streams must never be merged.
 *
 * @param home the Slopweaver home
 * @param armId the arm whose log path to resolve
 * @returns the absolute log path
 */
export function listenerLogPath({ home, armId }: { home: string; armId: string }): string {
  return join(stateHomePaths({ home }).live.listener.logsDir, `${armId}.err`);
}

/**
 * Where a backgrounded arm's STDOUT goes — pure JSONL, one admitted mention per line, and nothing else.
 *
 * Kept apart from {@link listenerLogPath} because `skills/loop/SKILL.md` requires it in as many words: *"Never
 * redirect stderr into stdout for this command (no `2>&1`), and never watch anything but stdout."* The loop
 * wakes on a line from this file. Merging narration into it would hand the loop progress text shaped like
 * nothing it can parse, and the durable `--queue` copy is explicitly NOT a second trigger path (AGENTS.md
 * rule 2), so "just watch the queue instead" is not the alternative it looks like.
 *
 * @param home the Slopweaver home
 * @param armId the arm whose mention stream to resolve
 * @returns the absolute path of the arm's JSONL stream
 */
export function listenerMentionsPath({ home, armId }: { home: string; armId: string }): string {
  return join(stateHomePaths({ home }).live.listener.logsDir, `${armId}.jsonl`);
}

/** Read a JSON file into a decoded value, mapping the three outcomes onto this domain's error union. */
function readJsonFile({ path }: { path: string }): Result<unknown | undefined, ListenerStateError> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error["code"] : undefined;
    if (code === "ENOENT") {
      return ok(undefined);
    }
    return err(ListenerStateErrors.unreadable({ cause: error, path }));
  }
  try {
    return ok(JSON.parse(raw));
  } catch {
    return err(ListenerStateErrors.malformedJson({ path }));
  }
}

/** Write a value as pretty JSON, atomically and durably. */
function writeJsonFile({ path, value }: { path: string; value: unknown }): Result<void, ListenerStateError> {
  try {
    writeFileAtomic({ contents: `${JSON.stringify(value, null, 2)}\n`, dirMode: DIR_MODE, path });
  } catch (error: unknown) {
    return err(ListenerStateErrors.writeFailed({ cause: error, path }));
  }
  return ok(undefined);
}

/**
 * Read the current arm record.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the arm (`undefined` when nothing is armed), or the error naming why it could not be trusted
 */
export function readListenerArm({
  home = slopweaverHome(),
}: {
  home?: string;
} = {}): Result<ListenerArm | undefined, ListenerStateError> {
  const path = stateHomePaths({ home }).live.listener.armJson;
  const raw = readJsonFile({ path });
  if (raw.isErr()) {
    return err(raw.error);
  }
  if (raw.value === undefined) {
    return ok(undefined);
  }
  return parseListenerArm({ raw: raw.value });
}

/**
 * Write the current arm record.
 *
 * @param arm the arm to persist
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns ok, or the write failure
 */
export function writeListenerArm({
  arm,
  home = slopweaverHome(),
}: {
  arm: ListenerArm;
  home?: string;
}): Result<void, ListenerStateError> {
  return writeJsonFile({ path: stateHomePaths({ home }).live.listener.armJson, value: arm });
}

/**
 * Remove the arm record — the supervisor is no longer watching anything.
 *
 * A missing file is success, not an error: `disarm` run twice must be idempotent, because the second run is
 * usually a human making sure.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns ok, or the failure that was not a missing file
 */
export function clearListenerArm({
  home = slopweaverHome(),
}: {
  home?: string;
} = {}): Result<void, ListenerStateError> {
  const path = stateHomePaths({ home }).live.listener.armJson;
  try {
    unlinkSync(path);
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error["code"] : undefined;
    if (code !== "ENOENT") {
      return err(ListenerStateErrors.writeFailed({ cause: error, path }));
    }
  }
  return ok(undefined);
}

/**
 * Read the newest heartbeat.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the beat (`undefined` when none has been written), or the error naming why it is untrustworthy
 */
export function readListenerHeartbeat({
  home = slopweaverHome(),
}: {
  home?: string;
} = {}): Result<ListenerHeartbeat | undefined, ListenerStateError> {
  const path = stateHomePaths({ home }).live.listener.heartbeatJson;
  const raw = readJsonFile({ path });
  if (raw.isErr()) {
    return err(raw.error);
  }
  if (raw.value === undefined) {
    return ok(undefined);
  }
  return parseListenerHeartbeat({ raw: raw.value });
}

/**
 * Write a heartbeat, whole-file. Called by the LISTENER itself, on its own interval.
 *
 * @param heartbeat the beat to write
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns ok, or the write failure
 */
export function writeListenerHeartbeat({
  heartbeat,
  home = slopweaverHome(),
}: {
  heartbeat: ListenerHeartbeat;
  home?: string;
}): Result<void, ListenerStateError> {
  return writeJsonFile({ path: stateHomePaths({ home }).live.listener.heartbeatJson, value: heartbeat });
}

/**
 * Read the last Socket Mode connection reading any listener on this home took.
 *
 * Three outcomes like every other read here: missing (nothing has ever connected since this record
 * existed — a valid state, and one `listen arm` narrates out loud), unreadable, or malformed.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the reading (`undefined` when none has been taken), or why it could not be trusted
 */
export function readSocketConnectionObservation({
  home = slopweaverHome(),
}: {
  home?: string;
} = {}): Result<SocketConnectionObservation | undefined, ListenerStateError> {
  const path = stateHomePaths({ home }).live.listener.connectionsJson;
  const raw = readJsonFile({ path });
  if (raw.isErr()) {
    return err(raw.error);
  }
  if (raw.value === undefined) {
    return ok(undefined);
  }
  return parseSocketConnectionObservation({ raw: raw.value });
}

/**
 * Write the reading, whole-file. Called by the LISTENER itself, from the `hello` frame that took it.
 *
 * Last reading wins, deliberately: a journal of readings would grow without bound to answer a question
 * only its newest line can answer at all, since an older count says nothing about now.
 *
 * @param observation the reading to persist
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns ok, or the write failure
 */
export function writeSocketConnectionObservation({
  observation,
  home = slopweaverHome(),
}: {
  observation: SocketConnectionObservation;
  home?: string;
}): Result<void, ListenerStateError> {
  return writeJsonFile({ path: stateHomePaths({ home }).live.listener.connectionsJson, value: observation });
}

/**
 * Append one event to the arm journal, fsync'd — this is the record that outlives the session, so a kill
 * that takes the whole process tree must not take the last line with it.
 *
 * @param event the event to record
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns ok, or the write failure
 */
export function appendListenerArmEvent({
  event,
  home = slopweaverHome(),
}: {
  event: ListenerArmEvent;
  home?: string;
}): Result<void, ListenerStateError> {
  const path = stateHomePaths({ home }).live.listener.armsJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ durable: true, path, text: `${JSON.stringify(event)}\n` });
  } catch (error: unknown) {
    return err(ListenerStateErrors.writeFailed({ cause: error, path }));
  }
  return ok(undefined);
}

/** How much of a dead arm's log is kept as evidence — enough to see a failure, bounded so a journal line stays readable. */
const DEATH_LOG_TAIL_BYTES = 4_000;

/**
 * The tail of one arm's log, for recording alongside its death.
 *
 * Reads the whole file and slices the end rather than seeking: a per-arm log is small (one arm's narration),
 * and a seek-based read that lands mid-UTF-8 would store mojibake as evidence. Returns `undefined` — never
 * an empty string — when there is nothing to read, because "the listener wrote nothing" and "there was no
 * file, because this arm ran in the foreground" are different facts and a caller must be able to say which.
 *
 * @param logPath the dead arm's own log file
 * @returns the last {@link DEATH_LOG_TAIL_BYTES} of it, or `undefined` when it cannot be read or is empty
 */
export function readListenerLogTail({ logPath }: { logPath: string }): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(logPath, "utf8");
  } catch {
    return undefined;
  }
  const tail = raw.length > DEATH_LOG_TAIL_BYTES ? raw.slice(-DEATH_LOG_TAIL_BYTES) : raw;
  return tail.length === 0 ? undefined : tail;
}

/**
 * Read every journalled arm event, dropping any line that will not decode.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns every decodable event in file order, or the error when the file itself could not be read
 */
export function readListenerArmEvents({
  home = slopweaverHome(),
}: {
  home?: string;
} = {}): Result<readonly ListenerArmEvent[], ListenerStateError> {
  const path = stateHomePaths({ home }).live.listener.armsJsonl;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error["code"] : undefined;
    if (code === "ENOENT") {
      return ok([]);
    }
    return err(ListenerStateErrors.unreadable({ cause: error, path }));
  }
  const events: ListenerArmEvent[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const event = parseListenerArmEvent({ line });
    if (event !== undefined) {
      events.push(event);
    }
  }
  return ok(events);
}
