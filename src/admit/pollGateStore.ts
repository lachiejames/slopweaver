/**
 * The poll gate's memory: when each target was last polled, and its change token then, one file per Claude Code session under
 * `$SLOPWEAVER_HOME/live/poll-gate/`. Each hook invocation is its own process, so nothing survives from one
 * call to the next unless it is written down — the same reason `./browserVerdictJournal.ts` exists.
 *
 * A read that fails returns an EMPTY record, which is the most permissive state this gate has: an unreadable
 * file means the next poll is allowed and recorded, never refused on a guess. A write that fails is
 * swallowed; the gate is a spend guard, and an unwritable home must not wedge a tool call.
 *
 * Not closed: two hook calls of one session racing the read-modify-write. Each rewrites the whole record atomically, so
 * a call that read before another's write drops that entry. The loss only ever ALLOWS — the
 * next poll of the dropped target reads as a first poll — so it costs one re-read the clock rule would have refused. A
 * per-session lock around the read and write would close it, at a lock on every gated call; not bought.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { slopweaverHome } from "../homeDir.js";
import { isRecord } from "../lib/parsers.js";
import { stateHomePaths } from "../stateHome.js";

/** Entries older than this are dropped on write, so a long session's file cannot grow without bound. */
const RETAIN_MS = 10 * 60_000;

/**
 * One target's last allowed poll: when it happened and, for a file target, its change token then
 * (`./pollFingerprint.ts`).
 *
 * @internal
 */
export interface PollObservation {
  /** The epoch-millisecond instant of the poll. */
  readonly atMs: number;
  /** The target's change token at that poll; absent when it had none, or the record predates tokens. */
  readonly fingerprint?: string;
}

/**
 * A session's poll record: target → its last allowed poll.
 *
 * @internal
 */
export type PollRecord = ReadonlyMap<string, PollObservation>;

/**
 * Read one stored entry. A bare number is the shape every record had before change tokens existed, and still reads —
 * as an observation with no token, which keeps the clock rule for that target until it is next recorded.
 *
 * @param value the stored value
 * @returns the observation, or `undefined` when the value is neither shape
 */
function observationIn({ value }: { value: unknown }): PollObservation | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? { atMs: value } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const atMs = value["atMs"];
  if (typeof atMs !== "number" || !Number.isFinite(atMs)) {
    return undefined;
  }
  const fingerprint = value["fingerprint"];
  return typeof fingerprint === "string" ? { atMs, fingerprint } : { atMs };
}

/**
 * The file one session's poll record lives in.
 *
 * @param sessionId Claude Code's own session id, reduced to `[A-Za-z0-9_-]` before it names a file
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute path
 */
export function pollGatePath({ sessionId, home = slopweaverHome() }: { sessionId: string; home?: string }): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  return join(stateHomePaths({ home }).live.pollGateDir, `${safe.length > 0 ? safe : "unknown"}.json`);
}

/**
 * Read one session's poll record.
 *
 * @param path the record file, from {@link pollGatePath}
 * @returns every target and its last poll, or an empty map when absent, unreadable or malformed
 */
export function readPollRecord({ path }: { path: string }): PollRecord {
  const record = new Map<string, PollObservation>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return record;
  }
  if (!isRecord(parsed) || !isRecord(parsed["seen"])) {
    return record;
  }
  for (const [target, value] of Object.entries(parsed["seen"])) {
    const observation = observationIn({ value });
    if (observation !== undefined) {
      record.set(target, observation);
    }
  }
  return record;
}

/**
 * Record that a target was polled now, dropping entries older than ten minutes.
 *
 * @param path the record file, from {@link pollGatePath}
 * @param target what was polled
 * @param nowMs the instant
 * @param fingerprint the target's change token now, or `undefined` when it has none
 * @param writeAtomic the durable-replace seam, so a test can make the rewrite die part-way
 */
export function recordPoll({
  path,
  target,
  nowMs,
  fingerprint,
  writeAtomic = writeFileAtomic,
}: {
  path: string;
  target: string;
  nowMs: number;
  fingerprint: string | undefined;
  writeAtomic?: typeof writeFileAtomic;
}): void {
  const kept = new Map([...readPollRecord({ path })].filter(([, seen]) => nowMs - seen.atMs < RETAIN_MS));
  kept.set(target, fingerprint === undefined ? { atMs: nowMs } : { atMs: nowMs, fingerprint });
  try {
    writeAtomic({ contents: `${JSON.stringify({ seen: Object.fromEntries(kept) }, null, 2)}\n`, path });
  } catch {
    // a record it could not write costs one missed refusal, never a wedged tool call
  }
}
