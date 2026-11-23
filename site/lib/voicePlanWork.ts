/**
 * A plan call's delegated work, as the orb's activity fold carries it: the hand-offs the realtime v3 voice makes to
 * Codex, and the Codex turns they become. Pure, and its own module so `voiceActivity.ts` stays under the line cap.
 *
 * Why a hand-off is not an answer: a plan hand-off (`delegation.created`, target `client`) folded as an ANSWER opened
 * no row and stamped the voice as having acted, and the Codex turn it became was never forwarded to the page at all.
 * The pill then read "listening" for the last two minutes of one call while the voice was stuck and the nudge button
 * never appeared. So a Codex turn that
 * never came back, and the owner's words after it, read exactly like a quiet room.
 *
 * Measured on a live v3 session (the session scratchpad's `probe-speech.mts`): one spoken ask produced THREE
 * `delegation.created` as the owner's transcript grew, all merged into ONE Codex turn — `turn/started` 0.1s after the
 * first. So a hand-off while a turn runs is that turn's, and it is NOT progress: the owner keeps talking and the voice
 * keeps handing their growing words over, which would keep a wedged turn looking busy. Only Codex's own notices — the
 * turn starting, an item inside it, its token usage — are progress.
 */
import type { PlanHeldAnswerEvent, PlanTurnEvent } from "./planCallContract";
import type { CodexStep } from "./talkPlanProtocolItems";

/** One Codex turn the delegated thread is running. */
export interface CodexTurn {
  readonly id: string;
  readonly sinceMs: number;
  /** The last notice of THIS turn's own work — never a hand-off, never a transcript. */
  readonly lastProgressMs: number;
  readonly step: CodexStep;
}

/**
 * A hand-off no Codex turn has picked up yet. It ages from the FIRST one: the voice re-handing the owner's growing words over
 * is not Codex doing anything.
 */
export interface PendingHandoff {
  readonly sinceMs: number;
  /** When the voice spoke after it, so the owner's next words mean the conversation moved on without it. */
  readonly spokeMs: number | undefined;
}

/** Everything the fold carries about a plan call's delegated work. */
export interface PlanWork {
  readonly turns: ReadonlyMap<string, CodexTurn>;
  /** Every turn this call has seen end, so a late notice of one reopens nothing. Uncapped: `closed` resets it. */
  readonly endedTurns: readonly string[];
  readonly handoff: PendingHandoff | undefined;
  /** When a turn last ended, however it ended. */
  readonly lastEndedMs: number | undefined;
  /** When a turn last COMPLETED: its answer is the voice's to speak. An interrupted turn owes nothing. */
  readonly lastCompletedMs: number | undefined;
  /**
   * When the server's last held-answer event said a completed message is still owed the voice or being handed to it,
   * `undefined` when it said none is. A time, not a flag, so a lost `pending:false` cannot hold a rollover forever.
   */
  readonly answerPendingMs: number | undefined;
  /** When a hand-over to the voice last ended, landed or failed, which it may not be saying aloud yet. */
  readonly lastAnswerHandedMs: number | undefined;
}

/** No delegated work: a call's start, and what `closed` resets to. */
export const NO_PLAN_WORK: PlanWork = {
  answerPendingMs: undefined,
  endedTurns: [],
  handoff: undefined,
  lastAnswerHandedMs: undefined,
  lastCompletedMs: undefined,
  lastEndedMs: undefined,
  turns: new Map(),
};

/**
 * A hand-off this soon after a turn ended is read as that turn's own late copy — the hand-off arrives on the data
 * channel and the turn's end over the server's stream, so their order at the page is not guaranteed. A judgement:
 * the measured hand-off-to-start gap is 0.1s.
 */
export const HANDOFF_SETTLE_MS = 3_000;

/** What the server streams of its delegated work: a Codex turn moving, and the answer it held off the voice or handed. */
export type PlanWorkEvent = PlanTurnEvent | PlanHeldAnswerEvent;

/** What the plan-work fold reads. */
export type PlanWorkInput =
  { readonly kind: "handoff" } | { readonly kind: "spoke" } | { readonly kind: "heard" } | PlanWorkEvent;

/**
 * Fold one input into the plan call's delegated work.
 *
 * @param plan the work so far
 * @param input what just happened
 * @param nowMs the time it happened, on the activity fold's clock
 * @returns the next work
 */
export function foldPlanWork({
  plan,
  input,
  nowMs,
}: {
  plan: PlanWork;
  input: PlanWorkInput;
  nowMs: number;
}): PlanWork {
  if (input.kind === "handoff") {
    return foldHandoff({ nowMs, plan });
  }
  if (input.kind === "spoke") {
    if (plan.handoff === undefined) {
      return plan;
    }
    return { ...plan, handoff: { ...plan.handoff, spokeMs: nowMs } };
  }
  if (input.kind === "heard") {
    // The voice answered after the hand-off and the owner has answered it: the conversation went on without Codex.
    if (plan.handoff?.spokeMs === undefined) {
      return plan;
    }
    return { ...plan, handoff: undefined };
  }
  if (input.kind === "held-answer") {
    // The server's own count, never rebuilt here: a release overtaken by a newer hold leaves that one owed. A hand-over
    // that ENDED is stamped however it ended: a timed-out write may still have reached the voice, and stamping a blank or refused one only holds a rollover 4s longer.
    let { lastAnswerHandedMs } = plan;
    if (input.phase === "released" || input.phase === "failed") {
      lastAnswerHandedMs = nowMs;
    }
    let answerPendingMs: number | undefined;
    if (input.pending) {
      answerPendingMs = nowMs;
    }
    return { ...plan, answerPendingMs, lastAnswerHandedMs };
  }
  if (plan.endedTurns.includes(input.turnId)) {
    return plan;
  }
  const turns = new Map(plan.turns);
  if (input.phase === "completed") {
    turns.delete(input.turnId);
    let { lastCompletedMs } = plan;
    if (input.status === "completed") {
      lastCompletedMs = nowMs;
    }
    const endedTurns = [...plan.endedTurns, input.turnId];
    return { ...plan, endedTurns, handoff: undefined, lastCompletedMs, lastEndedMs: nowMs, turns };
  }
  let turn: CodexTurn = { id: input.turnId, lastProgressMs: nowMs, sinceMs: nowMs, step: { kind: "working" } };
  const known = plan.turns.get(input.turnId);
  if (known !== undefined) {
    turn = { ...known, lastProgressMs: nowMs };
  }
  if (input.phase === "progress" && input.step !== null) {
    turn = { ...turn, step: input.step };
  }
  turns.set(input.turnId, turn);
  return { ...plan, handoff: undefined, turns };
}

/**
 * A hand-off: one while a turn runs, or just after one ended, is that turn's; one while a hand-off already waits
 * changes nothing; otherwise it waits for its turn.
 */
function foldHandoff({ plan, nowMs }: { plan: PlanWork; nowMs: number }): PlanWork {
  if (plan.turns.size > 0 || plan.handoff !== undefined) {
    return plan;
  }
  if (plan.lastEndedMs !== undefined && nowMs - plan.lastEndedMs < HANDOFF_SETTLE_MS) {
    return plan;
  }
  return { ...plan, handoff: { sinceMs: nowMs, spokeMs: undefined } };
}

/** One piece of delegated work in flight, before the orb words it. */
export interface PlanEntry {
  readonly key: string;
  /** The step a Codex turn names, or `undefined` for a hand-off no turn has picked up. */
  readonly step: CodexStep | undefined;
  readonly sinceMs: number;
  readonly lastMs: number;
  /** Whether its quiet counts toward "no update": a turn waiting on the page's own tool is the tool's to age. */
  readonly canStall: boolean;
}

/** How a running Codex turn's entry key opens, so a reader of the rows can tell one from a hand-off or a tool. */
const CODEX_TURN_KEY = "c:";

/**
 * Whether any Codex turn is still running, read off the rows in flight. A progress cue plays only while one is
 * (`progressCueStillDue`, `./orbCue.ts`), so a cue sent just as the last turn completed is dropped, never played over
 * the answer.
 *
 * @param rows what is in flight, as the activity panel lists it
 * @returns true while at least one row is a running Codex turn's
 */
export function codexTurnRunning({ rows }: { rows: readonly { readonly key: string }[] }): boolean {
  return rows.some((row) => row.key.startsWith(CODEX_TURN_KEY));
}

/**
 * The plan call's work in flight: each running Codex turn, and a hand-off no turn has picked up.
 *
 * @param plan the work
 * @param toolsPending whether a tool call is running on the page, which a Codex turn is then waiting on
 * @returns one entry per running turn, then the hand-off
 */
export function planEntries({ plan, toolsPending }: { plan: PlanWork; toolsPending: boolean }): readonly PlanEntry[] {
  const entries: PlanEntry[] = [];
  for (const turn of plan.turns.values()) {
    entries.push({
      canStall: !toolsPending,
      key: `${CODEX_TURN_KEY}${turn.id}`,
      lastMs: turn.lastProgressMs,
      sinceMs: turn.sinceMs,
      step: turn.step,
    });
  }
  const { handoff } = plan;
  if (handoff !== undefined) {
    entries.push({
      canStall: true,
      key: "handoff",
      lastMs: handoff.sinceMs,
      sinceMs: handoff.sinceMs,
      step: undefined,
    });
  }
  return entries;
}
