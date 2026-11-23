/**
 * The scheduled all-visible recovery sweep's pure cadence and window math — no I/O, no Slack client.
 *
 * A sweep either completes (every discovered channel and required thread read in full) or it does not.
 * Only a complete sweep may advance the durable watermark; a partial one must retain the previous cursor
 * and say so, because a silently-advanced watermark after a partial read is exactly how a dropped tag from
 * an unread channel disappears for good. That rule lives with the caller (`recoverSweep.ts`, Checkpoint 3);
 * this module only computes the window a sweep should read and when the next one is due.
 *
 * Slack's own history bounds are exclusive by default, so the watermark is stored as the exact six-decimal
 * `latest` boundary a completed sweep observed, and the next sweep's `oldest` is derived as that value's
 * one-microsecond predecessor — a half-open continuation with neither a gap nor a broad re-scan overlap.
 *
 * ## V1 → V2: an additive, backward-readable schema
 *
 * V2 adds `threadCheckpoints` — recovery's own per-thread inventory (see `recoverThreads.ts`), so an old
 * thread whose root has already left the five-minute history window can still be found again. `V1` stays
 * READABLE forever (a state file written before this feature shipped must not become "corrupt" the moment
 * this code ships), but production only ever WRITES `V2` once a caller has completed the one-time bootstrap
 * — see `../../cli/commands/listen/scheduledRecover.ts`'s own migration comment.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { slackTsFromEpochMs } from "../../lib/slackTs.js";
import {
  type RecoverySweepStateError,
  RecoverySweepStateErrors,
  type RecoveryWindowError,
  RecoveryWindowErrors,
} from "./errors.js";
import { tsToIso } from "./recover.js";
import type { RecoveryThreadCheckpoints } from "./recoverThreads.js";

/** How often a scheduled sweep should run, in milliseconds. */
export const RECOVERY_INTERVAL_MS = 300_000;

/** The scheduled sweep's durable, on-disk cadence state — the ORIGINAL shape, still read forever. */
interface RecoverySweepStateV1 {
  readonly version: 1;
  /** The Slack decimal `ts` of the newest message the last COMPLETE sweep observed. Absent before any. */
  readonly completedThroughTs?: string;
  /** When the next sweep is due, ISO-8601. */
  readonly nextDueAtIso: string;
}

/** The current on-disk shape — V1 plus recovery's own per-thread checkpoint inventory. */
interface RecoverySweepStateV2 {
  readonly version: 2;
  readonly completedThroughTs?: string;
  readonly nextDueAtIso: string;
  /** Recovery's own known-thread inventory — see `recoverThreads.ts`. Never the corpus ingestion cursors. */
  readonly threadCheckpoints: RecoveryThreadCheckpoints;
}

/** Either on-disk shape — a reader accepts both; a writer only ever produces {@link RecoverySweepStateV2}. */
export type RecoverySweepState = RecoverySweepStateV1 | RecoverySweepStateV2;

/** The half-open Slack-history window one sweep should read. */
export interface RecoveryWindow {
  /** The Slack decimal `ts` to page `conversations.history`/`replies` strictly after (exclusive). */
  readonly oldestExclusiveTs: string;
  /** The Slack decimal `ts` this sweep must not read at or past (exclusive) — the moment it started. */
  readonly latestExclusiveTs: string;
  /** `oldestExclusiveTs`, as ISO-8601, for reporting. */
  readonly sinceIso: string;
  /** `latestExclusiveTs`, as ISO-8601, for reporting. */
  readonly untilIso: string;
}

const SLACK_TS_PATTERN = /^\d+\.\d{6}$/;

/**
 * Whether a string is a well-formed Slack decimal timestamp — SIX fraction digits exactly.
 *
 * Deliberately stricter than `../../lib/slackTs.ts`'s own `isSlackTs`, which accepts the bare-seconds and
 * short-fraction forms a human types. {@link predecessorSlackTs} does `bigint` arithmetic over the digits
 * themselves, so a value with a different fraction width would silently shift the window by a factor of ten.
 */
function isSlackTs({ ts }: { ts: string }): boolean {
  return SLACK_TS_PATTERN.test(ts);
}

/**
 * The Slack decimal `ts` one microsecond before the given one — the exact predecessor a half-open
 * continuation window needs, computed with `bigint` so a 16-plus significant-digit value never loses
 * precision the way floating-point subtraction would.
 *
 * @param ts a well-formed Slack decimal timestamp
 * @returns its one-microsecond predecessor, or an error when `ts` is malformed or already at the epoch
 */
function predecessorSlackTs({ ts }: { ts: string }): Result<string, RecoveryWindowError> {
  if (!isSlackTs({ ts })) {
    return err(RecoveryWindowErrors.notSlackTs({ ts }));
  }
  const [secondsPart = "", microsPart = ""] = ts.split(".");
  let seconds = BigInt(secondsPart);
  let micros = BigInt(microsPart);
  if (micros === 0n) {
    if (seconds === 0n) {
      return err(RecoveryWindowErrors.atEpoch({ ts }));
    }
    seconds -= 1n;
    micros = 999_999n;
  } else {
    micros -= 1n;
  }
  return ok(`${seconds.toString()}.${micros.toString().padStart(6, "0")}`);
}

/**
 * The Slack decimal `ts` window one sweep should read: continuing right after the last complete sweep's
 * watermark, or bootstrapping from a caller-supplied `--since` when none exists yet.
 *
 * @param completedThroughTs the last COMPLETE sweep's watermark, or `undefined` before any sweep has completed
 * @param bootstrapSinceIso the `--since` to bootstrap from when there is no watermark yet
 * @param nowMs the current instant, epoch milliseconds — the window's exclusive upper bound
 * @returns the window to read, or an error when a boundary will not parse or the window is empty/inverted
 */
export function recoveryWindow({
  completedThroughTs,
  bootstrapSinceIso,
  nowMs,
}: {
  completedThroughTs: string | undefined;
  bootstrapSinceIso: string;
  nowMs: number;
}): Result<RecoveryWindow, RecoveryWindowError> {
  const latestExclusiveTs = slackTsFromEpochMs({ ms: nowMs });
  const untilIso = new Date(nowMs).toISOString();

  if (completedThroughTs === undefined) {
    const sinceMs = Date.parse(bootstrapSinceIso);
    if (!Number.isFinite(sinceMs)) {
      return err(RecoveryWindowErrors.invalidSince({ since: bootstrapSinceIso }));
    }
    if (sinceMs >= nowMs) {
      return err(RecoveryWindowErrors.sinceNotBeforeNow({ since: bootstrapSinceIso, untilIso }));
    }
    return ok({
      latestExclusiveTs,
      oldestExclusiveTs: slackTsFromEpochMs({ ms: sinceMs }),
      sinceIso: new Date(sinceMs).toISOString(),
      untilIso,
    });
  }

  const oldestExclusiveTs = predecessorSlackTs({ ts: completedThroughTs });
  if (oldestExclusiveTs.isErr()) {
    return err(oldestExclusiveTs.error);
  }
  const sinceIso = tsToIso({ ts: completedThroughTs });
  if (sinceIso === undefined) {
    return err(RecoveryWindowErrors.malformedWatermark({ watermark: completedThroughTs }));
  }
  if (oldestExclusiveTs.value >= latestExclusiveTs) {
    return err(RecoveryWindowErrors.watermarkNotBeforeNow({ untilIso, watermark: completedThroughTs }));
  }
  return ok({ latestExclusiveTs, oldestExclusiveTs: oldestExclusiveTs.value, sinceIso, untilIso });
}

/**
 * When the next sweep is due, epoch milliseconds. Missing state means a sweep has never run, so the answer
 * is "now" — the same "scan immediately" rule the schedule design records for a bootstrap.
 *
 * @param nowMs the current instant, epoch milliseconds
 * @param state the durable cadence state, or `undefined` before any sweep has run
 * @returns the epoch millisecond a sweep is next due; never later than a corrupt `nextDueAtIso` would suggest
 */
export function nextRecoveryDue({ nowMs, state }: { nowMs: number; state: RecoverySweepState | undefined }): number {
  if (state === undefined) {
    return nowMs;
  }
  const dueMs = Date.parse(state.nextDueAtIso);
  return Number.isFinite(dueMs) ? dueMs : nowMs;
}

/** Whether one decoded entry is a well-formed `RecoveryThreadCheckpoint` — `cursorTs` a real Slack ts. */
function isValidThreadCheckpoint({ entry }: { entry: unknown }): boolean {
  if (!isRecord(entry)) {
    return false;
  }
  const cursorTs = entry["cursorTs"];
  if (typeof cursorTs !== "string" || !isSlackTs({ ts: cursorTs })) {
    return false;
  }
  const lastCheckedAtIso = entry["lastCheckedAtIso"];
  return (
    lastCheckedAtIso === undefined ||
    (typeof lastCheckedAtIso === "string" && Number.isFinite(Date.parse(lastCheckedAtIso)))
  );
}

/** Whether a decoded value is a well-formed {@link RecoveryThreadCheckpoints} map — every entry validated. */
function isValidThreadCheckpoints(value: unknown): value is RecoveryThreadCheckpoints {
  return isRecord(value) && Object.values(value).every((entry) => isValidThreadCheckpoint({ entry }));
}

/**
 * Validate an already-JSON-parsed value as {@link RecoverySweepState} — the pure half of reading the
 * on-disk cadence file. `undefined` (no file yet) is valid and means "never swept"; anything else that does
 * not match either the V1 or V2 schema is a refusal, never a silent re-bootstrap, so a corrupted file
 * cannot quietly widen the next scan into a full re-read without anyone noticing.
 *
 * @param raw the parsed JSON value read from disk, or `undefined` when no file exists yet
 * @returns the validated state (or `undefined`), or an error naming exactly what did not match
 */
export function parseRecoverySweepState({
  raw,
}: {
  raw: unknown;
}): Result<RecoverySweepState | undefined, RecoverySweepStateError> {
  if (raw === undefined) {
    return ok(undefined);
  }
  if (!isRecord(raw)) {
    return err(RecoverySweepStateErrors.notAnObject());
  }
  const version = raw["version"];
  if (version !== 1 && version !== 2) {
    return err(RecoverySweepStateErrors.unsupportedVersion({ foundVersion: version }));
  }
  const nextDueAtIso = raw["nextDueAtIso"];
  if (typeof nextDueAtIso !== "string" || !Number.isFinite(Date.parse(nextDueAtIso))) {
    return err(RecoverySweepStateErrors.invalidNextDueAt({ value: raw["nextDueAtIso"] }));
  }
  const completedThroughTs = raw["completedThroughTs"];
  if (
    completedThroughTs !== undefined &&
    (typeof completedThroughTs !== "string" || !isSlackTs({ ts: completedThroughTs }))
  ) {
    return err(RecoverySweepStateErrors.invalidCompletedThrough({ value: completedThroughTs }));
  }
  const base = { nextDueAtIso, ...(typeof completedThroughTs === "string" ? { completedThroughTs } : {}) };
  if (version === 1) {
    return ok({ ...base, version: 1 });
  }
  const threadCheckpoints = raw["threadCheckpoints"];
  if (!isValidThreadCheckpoints(threadCheckpoints)) {
    return err(RecoverySweepStateErrors.invalidThreadCheckpoints({ value: threadCheckpoints }));
  }
  return ok({ ...base, threadCheckpoints, version: 2 });
}
