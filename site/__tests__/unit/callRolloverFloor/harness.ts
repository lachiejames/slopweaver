/**
 * The recording rollover, the free floor and the fold builders both rollover-floor test files drive the page's floor
 * through: `callRolloverFloor.test.ts` on the predicate, `callRolloverFloorTurns.test.ts` on folded turns and whole
 * calls. Nothing is mocked; the rollover's seams are plain recording fakes.
 */

import { QuietRollover, type RolloverUrgency } from "../../../lib/callRollover";
import { pageRolloverHold, voiceMidAnswerAt } from "../../../lib/callRolloverFloor";
import {
  type ActivityInput,
  activityRows,
  foldActivity,
  NO_ACTIVITY,
  type VoiceActivity,
} from "../../../lib/voiceActivity";
import { progressingWork } from "../../../lib/voiceActivityRows";
import { ownerOpenAtOf } from "../../../lib/voiceOwnerTurns";
import { NO_TURN_TAKING, type Stretch } from "../../../lib/voiceTurnTaking";

/** The reason every ask in these tests carries, which the release line repeats. */
export const REASON = "rolled over in a pause";

/**
 * A half-second stretch of sound ending at `lastMs`.
 *
 * @returns the stretch the turn-taking fold would hold for it
 */
export const stretch = ({ lastMs }: { lastMs: number }): Stretch => ({ lastMs, sinceMs: lastMs - 500 });

/** Every field of `pageRolloverHold` at rest: a calm stage, no remainder, nothing heard, owed or in flight. */
export const FREE = {
  answerHandedAtMs: undefined,
  answerPendingMs: undefined,
  completedAtMs: undefined,
  heardAtMs: undefined,
  inFlight: 0,
  nudgedAtMs: undefined,
  owedFromMs: undefined,
  ownerAwaitingVoiceMs: undefined,
  ownerOpenAtMs: undefined,
  remainingMs: undefined,
  resumedAtMs: undefined,
  progressingInFlight: 0,
  turn: NO_TURN_TAKING,
  unwrittenSinceMs: undefined,
  urgency: "calm",
  voiceMidAnswerMs: undefined,
} as const;

/**
 * A rollover over fakes that record, in order, what it had the page do and what it journalled.
 *
 * @returns the rollover, the lines it recorded, and `clock`, whose `nowMs` is its now
 */
export function recording(): {
  readonly rollover: QuietRollover;
  readonly did: string[];
  readonly clock: { nowMs: number };
} {
  const did: string[] = [];
  const clock = { nowMs: 0 };
  const rollover = new QuietRollover({
    seams: {
      dropped: ({ previousCallId }) => {
        did.push(`dropped ${String(previousCallId)}`);
      },
      journal: ({ detail }) => {
        did.push(`journal: ${detail}`);
      },
      now: () => clock.nowMs,
      open: () => {
        did.push("open");
      },
      release: ({ why }) => {
        did.push(`release: ${why}`);
      },
      silence: () => {
        did.push("silence");
      },
    },
  });
  return { clock, did, rollover };
}

/** What the page did after the ask's own "ask received" line, the swap itself and nothing else. */
export const SWAP = ["silence", `release: ${REASON}`, "open"];

/**
 * Hand `rollover` the server's ask at page instant `atMs`.
 *
 * @param held the recording rollover to ask, whose clock is moved to `atMs` first
 * @param lifetimeRemainingMs the time left the server names, `null` while the cut is far
 * @param contextUrgent whether the server says the thread's context is nearly full, `false` when omitted
 */
export function ask({
  held,
  atMs,
  lifetimeRemainingMs,
  contextUrgent = false,
}: {
  held: ReturnType<typeof recording>;
  atMs: number;
  lifetimeRemainingMs: number | null;
  contextUrgent?: boolean;
}): void {
  held.clock.nowMs = atMs;
  const standing = (): { closing: boolean; current: boolean } => ({ closing: false, current: true });
  held.rollover.asked({ callId: "c-1", contextUrgent, lifetimeRemainingMs, reason: REASON, standing });
}

/**
 * The hold the page reads off a fold, every field wired as `useVoiceActivity` wires it, its rows in flight included.
 *
 * @param stage the held ask's stage and remainder (`QuietRollover.stage`), calm with none named when omitted
 * @param owedFromMs when the voice's final began a turn it owes the owner, which the tests set by hand
 * @param unwrittenSinceMs when the call's words were first seen not on disk (`unwrittenSinceAt`), none when omitted
 * @returns what holds the floor, or `undefined` when it is free
 */
export function holdOf({
  activity,
  nowMs,
  stage = { remainingMs: undefined, urgency: "calm" },
  owedFromMs,
  unwrittenSinceMs,
}: {
  activity: VoiceActivity;
  nowMs: number;
  stage?: { urgency: RolloverUrgency; remainingMs: number | undefined };
  owedFromMs?: number;
  unwrittenSinceMs?: number | undefined;
}): string | undefined {
  const rows = activityRows({ activity, nowMs });
  return pageRolloverHold({
    answerHandedAtMs: activity.plan.lastAnswerHandedMs,
    answerPendingMs: activity.plan.answerPendingMs,
    completedAtMs: activity.plan.lastCompletedMs,
    heardAtMs: activity.lastHeardMs,
    inFlight: rows.length,
    nowMs,
    nudgedAtMs: activity.nudgedAtMs,
    owedFromMs,
    ownerAwaitingVoiceMs: activity.owner.awaiting?.sinceMs,
    ownerOpenAtMs: ownerOpenAtOf({ turns: activity.owner }),
    remainingMs: stage.remainingMs,
    resumedAtMs: activity.resumedAtMs,
    progressingInFlight: progressingWork({ activity, nowMs }),
    turn: activity.turn,
    unwrittenSinceMs,
    urgency: stage.urgency,
    voiceMidAnswerMs: voiceMidAnswerAt({ answerOpen: activity.voiceAnswerOpen, lastSpokeMs: activity.lastSpokeMs }),
  });
}

/**
 * A segment of the owner's spoken turn `id`, as `planEffectHandler` feeds the fold.
 *
 * @param final whether the segment closes the owner's turn
 * @returns the fold input
 */
export function said({ id, final }: { id: string; final: boolean }): ActivityInput {
  return { event: { final, id, kind: "segment" }, kind: "owner" };
}

/** A turn the owner typed in, as `typedInHandler` feeds the fold. */
export const TYPED: ActivityInput = { event: { kind: "typed" }, kind: "owner" };

/**
 * A script of timed inputs folded from nothing.
 *
 * @param script each input with the page instant it is folded at, in fold order
 * @returns the activity the fold holds after the last one
 */
export function folded({ script }: { script: readonly (readonly [number, ActivityInput])[] }): VoiceActivity {
  return script.reduce<VoiceActivity>(
    (held, [atMs, input]) => foldActivity({ activity: held, input, nowMs: atMs }),
    NO_ACTIVITY,
  );
}
