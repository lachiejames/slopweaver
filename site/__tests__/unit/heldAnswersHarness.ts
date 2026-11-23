/*
 * `HeldAnswers` over a fake call: a clock that moves only when the test says, plain injected functions for the call,
 * and the owner's words as the realtime session would transcribe them. Nothing is mocked. Shared by every test file of
 * the held answers, so each splits by scenario rather than copying the harness.
 */
import type { PlanCallEvent } from "../../lib/planCallContract";
import { HeldAnswers } from "../../lib/talkPlanHeldAnswers";
import type { HeldAnswer } from "../../lib/talkPlanHeldRelease";
import type { RpcOutcome } from "../../lib/talkPlanProtocol";
import type { CallClock } from "../../lib/talkPlanStart";

/**
 * A clock whose time moves only when the test says.
 *
 * @returns the clock, and `advance` to move it, firing each timer at its own instant
 */
export function fakeClock(): CallClock & { advance: (input: { ms: number }) => void } {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  return {
    advance: ({ ms }) => {
      const until = now + ms;
      // One step at a time, so a timer armed by another's run fires at its own instant inside the advance.
      while (now < until) {
        now = Math.min(until, now + 50);
        for (const timer of timers.filter((t) => t.live && t.at <= now)) {
          timer.live = false;
          timer.run();
        }
      }
    },
    after: ({ ms, run }) => {
      const timer = { at: now + ms, live: true, run };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    nowMs: () => now,
  };
}

/** Let every queued answer land. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

/** The first cut-in's words: a transcript that closes mid-clause, before the sentence is finished. */
export const MID_CLAUSE = "Um, I believe that the answer here is probably going to be some";

/**
 * One held message whose text is its item id's.
 *
 * @returns the message, arriving first
 */
export const answer = ({
  itemId,
  turnId,
  commentary,
}: {
  itemId: string;
  turnId: string;
  commentary: boolean;
}): HeldAnswer => ({ commentary, completedSeq: 0, itemId, text: `${itemId} text`, turnId });

/** What {@link harness} hands a test. */
export interface HeldHarness {
  readonly clock: ReturnType<typeof fakeClock>;
  readonly events: PlanCallEvent[];
  readonly handed: { answered: readonly string[]; commented: readonly string[] }[];
  readonly held: HeldAnswers;
  readonly spoken: string[];
  readonly state: {
    heardAt: number | undefined;
    voiceAt: number | undefined;
    blocked: string | undefined;
    running: Set<string>;
  };
  readonly voicedAt: number[];
  /** A delta of the owner's: the utterance opens, and stays open until its done. */
  readonly opens: (input: { words: string }) => void;
  /** The done that closes the owner's utterance. */
  readonly finishes: (input: { words: string }) => void;
  /** A whole utterance of the owner's, its delta and its done at one instant. */
  readonly hears: (input: { words: string }) => void;
  /** New words of the owner's, finished and gone quiet. */
  readonly saysMore: () => void;
}

/**
 * Held answers over a fake call.
 *
 * @param speak how the session answers the release, taking it unless a test says
 * @param onEmit told of each event as it is emitted
 * @returns the answers, the clock, the call's transcript state and every write and event it saw
 */
export function harness({
  speak = () => Promise.resolve({ kind: "result", result: {} }),
  onEmit = () => undefined,
}: { speak?: () => Promise<RpcOutcome>; onEmit?: (event: PlanCallEvent) => void } = {}): HeldHarness {
  const clock = fakeClock();
  const state: HeldHarness["state"] = {
    blocked: undefined,
    heardAt: undefined,
    running: new Set(),
    voiceAt: undefined,
  };
  const spoken: string[] = [];
  const events: PlanCallEvent[] = [];
  const voicedAt: number[] = [];
  const handed: { answered: readonly string[]; commented: readonly string[] }[] = [];
  const held = new HeldAnswers({
    call: {
      blocked: () => state.blocked,
      emit: ({ event }) => {
        events.push(event);
        onEmit(event);
      },
      handed: (turns) => {
        handed.push(turns);
      },
      runningTurns: () => state.running,
      speak: ({ text }) => {
        spoken.push(text);
        return speak();
      },
      transcribed: () => ({ heardAt: state.heardAt, voiceAt: state.voiceAt }),
      voiced: () => {
        voicedAt.push(clock.nowMs());
      },
    },
    clock,
  });
  const opens: HeldHarness["opens"] = ({ words }) => {
    state.heardAt = clock.nowMs();
    held.heard({ atMs: clock.nowMs(), phase: "delta", text: words });
  };
  const finishes: HeldHarness["finishes"] = ({ words }) => {
    state.heardAt = clock.nowMs();
    held.heard({ atMs: clock.nowMs(), phase: "done", text: words });
  };
  const hears: HeldHarness["hears"] = ({ words }) => {
    opens({ words });
    finishes({ words });
  };
  // A turn that already answered may answer again once these finish.
  const saysMore = (): void => {
    hears({ words: "And one more thing." });
    clock.advance({ ms: 5_000 });
  };
  return { clock, events, finishes, handed, held, hears, opens, saysMore, spoken, state, voicedAt };
}
