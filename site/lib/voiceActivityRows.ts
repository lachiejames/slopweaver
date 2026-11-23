/**
 * What the orb and the activity panel draw from the voice activity fold — its phases, its status shape, and every turn
 * and tool in flight as a row — split out of `./voiceActivity.ts`.
 */

import { stepWords, type WorkStep } from "./responsesStep";
import { COMPACTION_STALL_MS, STALL_MS, type VoiceActivity } from "./voiceActivityState";
import { codexTurnRunning, planEntries } from "./voicePlanWork";
import type { TalkingPhase } from "./voiceTalking";

/** The states the orb draws. `reconnecting` is a live call that dropped, drawn apart from a fresh `connecting`. */
export type VoicePhase =
  "off" | "connecting" | "reconnecting" | "listening" | TalkingPhase | "working" | "stalled" | "error";

/** What the orb shows: one phase, a short headline, and the detail a glance or a click reads. */
export interface VoiceStatus {
  readonly phase: VoicePhase;
  /** One or two words, always. */
  readonly headline: string;
  /** The turn in flight or the reason for the state, carried even while the voice talks over the work. */
  readonly detail: string | undefined;
  /**
   * The session's error exactly as it arrived, present only while `detail` is that error said plainly
   * (`plainReasonOf`), so a page can fold it beneath the plain line rather than lead with it.
   */
  readonly why?: string;
  /** Whole seconds the shown state has held, when its age is the point. */
  readonly seconds: number | undefined;
  /**
   * The one nudge on offer ({@link nudgeOfferOf}): beside "still waiting" or "no update", or beside "listening" when
   * the voice spoke last and asked the owner nothing ({@link voiceOwesTurn}).
   */
  readonly nudge: NudgeOffer | undefined;
}

/**
 * The nudge the owner may press: `ask` has the voice answer the owner's last words; `interrupt` also stops the Codex
 * turn that went quiet, which `PlanCall.nudge` does after the voice has been asked to answer.
 */
export type NudgeOffer = "ask" | "interrupt";

/** What a hand-off no Codex turn has picked up yet is called on the orb. */
const HANDOFF_WORDS = "handing to Codex";

/** One thing in flight, as the activity panel lists it. */
export interface ActivityRow {
  readonly key: string;
  /** The step it names, which the orb's face reads; none for a hand-off nothing picked up or a continue. */
  readonly step: WorkStep | undefined;
  readonly words: string;
  readonly seconds: number;
  readonly stale: boolean;
}

/**
 * Every turn and tool in flight, newest progress first, as the activity panel lists them.
 *
 * @param activity the fold
 * @param nowMs the same clock the fold was stamped on
 * @returns one row per open delegation and pending tool, plus the continuation the page asked for
 */
export function activityRows({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }): readonly ActivityRow[] {
  const rows: { row: ActivityRow; at: number }[] = [];
  for (const delegation of activity.delegations.values()) {
    rows.push({
      at: delegation.lastProgressMs,
      row: {
        key: `d:${delegation.id}`,
        seconds: secondsBetween({ from: delegation.sinceMs, to: nowMs }),
        stale: nowMs - delegation.lastProgressMs >= STALL_MS,
        step: delegation.step,
        words: stepWords({ step: delegation.step }),
      },
    });
  }
  for (const [callId, tool] of activity.tools) {
    const step: WorkStep = { kind: "tool", name: tool.name };
    rows.push({
      at: tool.sinceMs,
      row: {
        key: `t:${callId}`,
        seconds: secondsBetween({ from: tool.sinceMs, to: nowMs }),
        stale: nowMs - tool.sinceMs >= STALL_MS,
        step,
        words: stepWords({ step }),
      },
    });
  }
  const { stray } = activity;
  if (stray !== undefined) {
    rows.push({
      at: stray.lastMs,
      row: {
        key: "stray",
        seconds: secondsBetween({ from: stray.sinceMs, to: nowMs }),
        stale: nowMs - stray.lastMs >= STALL_MS,
        step: stray.step,
        words: stepWords({ step: stray.step }),
      },
    });
  }
  for (const entry of planEntries({ plan: activity.plan, toolsPending: activity.tools.size > 0 })) {
    const words = entry.step === undefined ? HANDOFF_WORDS : stepWords({ step: entry.step });
    rows.push({
      at: entry.lastMs,
      row: {
        key: entry.key,
        seconds: secondsBetween({ from: entry.sinceMs, to: nowMs }),
        stale: entry.canStall && nowMs - entry.lastMs >= stallMsForStep({ step: entry.step }),
        step: entry.step,
        words,
      },
    });
  }
  const continued = activity.continuations.at(0);
  if (continued !== undefined) {
    rows.push({
      at: continued,
      row: {
        key: "continued",
        seconds: secondsBetween({ from: continued, to: nowMs }),
        stale: nowMs - continued >= STALL_MS,
        step: undefined,
        words: "waiting for the backend to continue",
      },
    });
  }
  rows.sort((a, b) => b.at - a.at);
  return rows.map(({ row }) => row);
}

/**
 * How much work in flight still progresses: every row not stalled, except that a Codex turn is judged on its OWN last
 * progress. A turn waiting on a page tool never shows stalled (`planEntries` leaves its quiet to the tool), and no row
 * says which turn a tool belongs to, so a stalled tool and the turn blocked on it read as live work;
 * judged on its own progress, the blocked turn has gone quiet, an unrelated turn still moving has not, and a
 * live tool counts in its own right.
 *
 * @param activity the fold, whose running Codex turns carry their own last progress
 * @param nowMs the same clock the fold was stamped on
 * @returns how many rows and turns could still finish
 */
export function progressingWork({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }): number {
  const others = activityRows({ activity, nowMs }).filter((row) => !row.stale && !codexTurnRunning({ rows: [row] }));
  const turns = [...activity.plan.turns.values()].filter(
    (turn) => nowMs - turn.lastProgressMs < stallMsForStep({ step: turn.step }),
  );
  return others.length + turns.length;
}

/**
 * How long a Codex turn's quiet runs before it is stalled: {@link COMPACTION_STALL_MS} while it compacts its thread's
 * context, which sends nothing until it ends, else {@link STALL_MS}. One horizon for the row and {@link progressingWork},
 * so the two judge a turn's quiet by the same length. They still part while a page tool is pending, by design: the
 * row leaves that quiet to the tool, and {@link progressingWork} judges the turn on its own progress.
 */
function stallMsForStep({ step }: { step: WorkStep | undefined }): number {
  if (step?.kind === "compacting") {
    return COMPACTION_STALL_MS;
  }
  return STALL_MS;
}

/**
 * Where a call's connection is. `reconnecting` is a live call whose link was lost — held for its heal window
 * (`./callLink.ts`), or dropped while the console re-opens it on its own (`./callReconnect.ts`) — and the call still
 * counts as active, so the owner's end button stays.
 */
export type VoiceLink = "off" | "connecting" | "reconnecting" | "live" | "failed";

/**
 * Whole seconds from one instant to another, never negative.
 *
 * @returns the whole seconds between the two instants
 */
export function secondsBetween({ from, to }: { from: number; to: number }): number {
  return Math.max(0, Math.floor((to - from) / 1000));
}
