/**
 * What BOTH halves of the scheduled sweep need — the foreground walk in `recoverForeground.ts` and the
 * background thread poll in `recoverBackground.ts`.
 *
 * It exists because the two phases read Slack differently but score it identically: the same verdict on a
 * failed read, the same reply-row-to-candidate conversion, the same checkpoint arithmetic after a read.
 * Holding one copy here is the whole point — the watermark pin was a `not_in_channel`
 * classified correctly at the history stage and wrongly at the thread stage, which is exactly the drift two
 * copies produce. Every function here is pure except for taking no I/O at all.
 */
import { latestReplyTs } from "../../corpus/slack/threadCursors.js";
import { isRecord } from "../../lib/parsers.js";
import type { SlackPageError } from "../slack/errors.js";
import { type CandidateSurface, candidateFromMessage, type RecoveryCandidate, type ThreadEvidence } from "./recover.js";
import type { RecoveryThreadCheckpoint } from "./recoverThreads.js";

/**
 * A channel the sweep did NOT read, and why — reported, and never counted against a SCHEDULED sweep's
 * completeness.
 *
 * This is a different thing from a {@link RecoveryCoverageFailure}, and keeping them apart is the whole
 * point. A failure means "this sweep could not see all of a channel it is supposed to see", so the sweep
 * cannot be trusted complete and the watermark must not advance. An exclusion means "this channel is not in
 * scope at all" — the same category as the 461 public channels `actionableChannels` discards before the
 * scan even starts, arrived at one call later because Slack's own `is_member` said otherwise.
 *
 * **What this classifier decides is the READ CONDITION; the CALLER decides what it means for coverage.**
 * The out-of-scope reading above is true of the SCHEDULED sweep, whose channel set is DISCOVERED from the
 * bot's own membership — there, a channel it is not in was never asked for. It is false of the MANUAL pass,
 * where `--channels` is typed by an operator and IS the verb's own WHERE gate: a channel on that list was
 * asked for, so failing to read it makes the pass partial and `listen recover` exits non-zero
 * (`../../cli/commands/listen/manualRecoverReport.ts`). Manual mode has no watermark for that count to pin,
 * which is what made the scheduled reading necessary and makes the manual one safe.
 *
 * Measured consequence of conflating them: `not_in_channel` on ONE public channel made every scheduled
 * sweep `partial` for six days, pinning `completedThroughTs` at `1786931469.454000`. Retrying bought nothing — a bot that is not a member of a channel will
 * be told so identically on every future call until a human invites it — while the cost was total: after an
 * outage, the sweep could not verify that nothing had been missed ANYWHERE, because one permanently
 * unreadable channel outvoted every readable one.
 *
 * The same verdict applies at EVERY stage that reads a channel, not only the history read. An earlier
 * fix reclassified it at the history stage alone; a `not_in_channel` answered to a THREAD read — which is
 * what the background phase gets when it polls a remembered checkpoint in a channel the bot has since been
 * removed from — stayed a failure, and pinned the watermark again for seven hours
 * (`completedThroughTs` at `1787613559.194000`, seven such failures on one channel per sweep). So the
 * classification lives in one place, {@link permanentExclusion}, and every read stage consults it.
 */
export interface RecoveryChannelExclusion {
  readonly channel: string;
  /**
   * Why it was not read. `not-a-member` is the standing membership fact. `gone` is Slack's
   * `channel_not_found`, which means deleted OR simply invisible to this token — do not read it as proof
   * of deletion; `../slack/errors.ts#PageChannelNotFoundError` states both causes.
   */
  readonly reason: "not-a-member" | "gone";
}

/** Why the workspace scan could not be trusted complete — a whole-scan discovery failure, or one channel's. */
export type RecoveryCoverageFailure =
  | { readonly stage: "discovery"; readonly reason: string }
  | { readonly stage: "history"; readonly channel: string; readonly reason: string }
  | { readonly stage: "thread"; readonly channel: string; readonly messageTs: string; readonly reason: string };

/**
 * Every candidate a full or incremental thread read's reply rows produce, in the rows' own order.
 *
 * @param channel the channel these replies belong to
 * @param evidence what the one thread read yielded, carried onto every reply it produced
 * @param replyRows the eligible reply rows
 * @param surface this channel's own surface
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns every candidate the reply rows produce
 */
export function repliesToCandidates({
  channel,
  evidence,
  replyRows,
  surface,
  selfBotId,
}: {
  channel: string;
  evidence: ThreadEvidence;
  replyRows: readonly unknown[];
  surface: CandidateSurface;
  selfBotId: string | undefined;
}): readonly RecoveryCandidate[] {
  const candidates: RecoveryCandidate[] = [];
  for (const message of replyRows) {
    const candidate = candidateFromMessage({ channel, evidence, message, selfBotId, surface });
    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

/** A raw row's own `ts`, or `undefined` when it is not a well-formed record carrying one. */
function tsOf({ message }: { message: unknown }): string | undefined {
  if (!isRecord(message)) {
    return undefined;
  }
  const ts = message["ts"];
  return typeof ts === "string" ? ts : undefined;
}

/**
 * The checkpoint to store after a full or incremental thread read — the newest reply `ts` seen (never older
 * than the cursor already stored), and the instant this thread was actually checked.
 *
 * `currentCursorTs`'s own `"0"` sentinel (a never-checked foreground read, or a background check's `oldest`
 * for a thread whose planner-computed cursor defaulted to it) is normalised to the well-formed Slack
 * timestamp `"0.000000"` before it can ever become a STORED checkpoint value — `RecoverySweepStateV2`'s own
 * schema (`recoverSchedule.ts`) requires every `cursorTs` to match `epochSeconds.micros` exactly, and a bare
 * `"0"` would fail that on the very next read, misreporting a durably-written state as corrupt.
 *
 * @param currentCursorTs the cursor this read started from — `"0"` for a never-checked (foreground) read
 * @param checkedAtIso when this read happened, ISO-8601 — the sweep's own `window.untilIso`
 * @param rows the eligible reply rows this read found (already bounded/de-duplicated by `recoveryReplyRows`)
 * @returns the checkpoint to store
 */
export function checkpointAfterRead({
  currentCursorTs,
  checkedAtIso,
  rows,
}: {
  currentCursorTs: string;
  checkedAtIso: string;
  rows: readonly unknown[];
}): RecoveryThreadCheckpoint {
  const baseline = currentCursorTs === "0" ? "0.000000" : currentCursorTs;
  const tagged: { readonly ts: string }[] = [];
  for (const row of rows) {
    const ts = tsOf({ message: row });
    if (ts !== undefined) {
      tagged.push({ ts });
    }
  }
  const advanced = latestReplyTs({ current: baseline, replies: tagged });
  if (advanced === undefined) {
    return { cursorTs: baseline, lastCheckedAtIso: checkedAtIso };
  }
  return { cursorTs: advanced, lastCheckedAtIso: checkedAtIso };
}

/**
 * The ONE classification of a failed Slack read as permanently out of scope, shared by every read stage of
 * the sweep — the history read, the foreground thread read and the background thread poll alike.
 *
 * Exactly two codes qualify, and both are REPORTED rather than swallowed. `channel_not_found` used to return
 * silently, which meant a channel quietly vanishing from the sweep looked exactly like a channel that had
 * nothing in it — and `not_in_channel` used to be a failure, which is what pinned the watermark for six days
 * at the history stage and then for seven hours at the thread stage. Neither is a fault to retry: a bot that
 * is not a member, or a channel that is gone, answers identically on every future call until a human changes
 * something. A deleted thread is permanent too, but it is a fact about ONE thread in a channel that still
 * reads, so it is {@link goneThread}'s, not this. Everything else — a rate limit, a network fault, a cursor
 * contradiction — stays a genuine coverage failure, because a retry may well read it next time.
 *
 * @param channel the channel id the read was for
 * @param error the typed pagination failure
 * @returns the exclusion, or `undefined` when this failure is not a permanent one
 */
export function permanentExclusion({
  channel,
  error,
}: {
  channel: string;
  error: SlackPageError;
}): RecoveryChannelExclusion | undefined {
  if (error.code === "CHANNEL_NOT_FOUND") {
    return { channel, reason: "gone" };
  }
  if (error.code === "NOT_IN_CHANNEL") {
    return { channel, reason: "not-a-member" };
  }
  return undefined;
}

/** A remembered thread whose root no longer exists — reported, retired from the inventory, never a failure. */
export interface RecoveryGoneThread {
  readonly channel: string;
  readonly threadTs: string;
}

/**
 * The ONE classification of a failed thread read as a thread that is gone for good, shared by the foreground
 * thread read and the background poll alike — see {@link permanentExclusion} for the channel-scoped half.
 *
 * `thread_not_found` on a channel the sweep can otherwise read means the root was deleted: a conversation the
 * token cannot see answers `channel_not_found` instead, and a root deleted AFTER replies arrived is kept by
 * Slack as a tombstone that still reads. So a retry answers identically forever, and scoring it as a coverage
 * failure made every sweep the rotation reached it partial. Measured: two deleted roots in one
 * incident channel, registered as reply-less checkpoints, made 3 of 4 due sweeps partial with nothing
 * recovered (the sweep's `partial` rows in `"$SLOPWEAVER_HOME/ledgers/loop-breakage.jsonl"`).
 *
 * @param channel the channel the thread is in
 * @param threadTs the thread root the read was for
 * @param error the typed pagination failure
 * @returns the gone thread, or `undefined` when this failure is not a deleted root
 */
export function goneThread({
  channel,
  threadTs,
  error,
}: {
  channel: string;
  threadTs: string;
  error: SlackPageError;
}): RecoveryGoneThread | undefined {
  if (error.code === "THREAD_NOT_FOUND") {
    return { channel, threadTs };
  }
  return undefined;
}
