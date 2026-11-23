/*
 * The fake call an owed-start test drives (`./talkPlanOwedTurn.test.ts`, `./talkPlanOwedTurnWalk.test.ts`): a clock
 * whose time moves only when the test says, and plain injected functions for the session, the child and the waiters.
 * Nothing is mocked.
 */
import { OwedTurnStarts } from "../../lib/talkPlanOwedTurn";
import type { RpcOutcome } from "../../lib/talkPlanProtocol";
import type { CallClock } from "../../lib/talkPlanStart";
import type { TurnWaiter } from "../../lib/talkPlanTurns";

/** A fake clock: {@link CallClock} with `advance`, which moves time and runs every timer due. */
export type FakeClock = CallClock & { advance: (input: { ms: number }) => void };

/** The fake call {@link harness} builds, and what it saw. */
export interface OwedTurnHarness {
  readonly clock: FakeClock;
  readonly log: string[];
  readonly requests: { method: string; params: unknown; timeoutMs: number }[];
  readonly starts: OwedTurnStarts;
  readonly state: { ended: string | undefined; running: number; turnsEnded: number };
  readonly waiters: Set<TurnWaiter>;
  readonly whys: string[];
}

/**
 * A clock whose time moves only when the test says.
 *
 * @returns the clock, at zero
 */
export function fakeClock(): FakeClock {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  return {
    advance: ({ ms }) => {
      now += ms;
      for (const timer of timers.filter((t) => t.live && t.at <= now)) {
        timer.live = false;
        timer.run();
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

/** Tell every waiter a turn started, as `PlanCall.codexTurn` does, clearing them after. */
export function turnStarts({ waiters, turnId }: { waiters: Set<TurnWaiter>; turnId: string | undefined }): void {
  for (const waiter of Array.from(waiters)) {
    waiter(turnId);
  }
  waiters.clear();
}

/**
 * Owed starts over a fake call whose `turn/start` answers `answer`.
 *
 * @param answer what the child answers the start with
 * @param hand how the session answers a developer message, taking it unless a test says
 * @returns the starts, what was written and said, the waiters, the clock and the ended switch
 */
export function harness({
  answer,
  hand = () => Promise.resolve({ kind: "result", result: {} }),
}: {
  answer: () => Promise<RpcOutcome>;
  hand?: () => Promise<RpcOutcome>;
}): OwedTurnHarness {
  const clock = fakeClock();
  const waiters = new Set<TurnWaiter>();
  const log: string[] = [];
  const whys: string[] = [];
  const requests: { method: string; params: unknown; timeoutMs: number }[] = [];
  const state: { ended: string | undefined; running: number; turnsEnded: number } = {
    ended: undefined,
    running: 0,
    turnsEnded: 0,
  };
  const starts = new OwedTurnStarts({
    call: {
      clock,
      emit: ({ event, telemetry }) => {
        if (event.kind === "owed-start") {
          log.push(`started ${event.why}, telemetry ${String(telemetry)}`);
          return;
        }
        log.push(`failed: ${event.message}`);
      },
      hand: ({ text, why }) => {
        log.push(`handed ${text}`);
        whys.push(why);
        return hand();
      },
      request: (input) => {
        requests.push(input);
        log.push(`wrote ${input.method}`);
        return answer();
      },
      state: () => ({
        endedReason: state.ended,
        running: state.running,
        threadId: "thread-1",
        turnsEnded: state.turnsEnded,
      }),
      waiters,
    },
  });
  return { clock, log, requests, starts, state, waiters, whys };
}

/** A `turn/start` the child answered by naming the turn it started. */
export const TURN_STARTED: RpcOutcome = { kind: "result", result: { turn: { id: "t-9" } } };
/**
 * A child that answers every request with one outcome.
 *
 * @returns the answer function
 */
export const answers =
  (outcome: RpcOutcome): (() => Promise<RpcOutcome>) =>
  () =>
    Promise.resolve(outcome);
