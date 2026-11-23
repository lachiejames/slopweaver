/**
 * What `PlanCall` does with its thread's Codex turns: counts one that starts and tells its waiters, waits for the running
 * turn a look's frame goes into, and sends the owner's nudge's interrupts to the turns running at their press. Split from `./talkPlanCall.ts`, to keep it under
 * its 300-line cap; the class passes in the state these read, so nothing here holds any.
 */
import { PLAN_CALL_LIMITS, type PlanTurnEvent } from "./planCallContract";
import type { PlanCodexNoticeEvent, PlanModelWaitEvent } from "./talkPlanCodexEvents";
import { type CallTurnItems, itemMoveOf } from "./talkPlanModelWait";
import type { RpcOutcome } from "./talkPlanProtocol";
import { codexNoticeOf } from "./talkPlanProtocolTurns";
import type { CallClock } from "./talkPlanStart";

/** One waiter on the next Codex turn's start, told its id — or `undefined` when the call ends. */
export type TurnWaiter = (turnId: string | undefined) => void;

/**
 * What one item notification inside a running Codex turn of the call's own thread is forwarded as
 * (`itemMoveOf`, `./talkPlanModelWait.ts`): first the `model-wait` line a long wait it closed is owed, then the turn's
 * progress — always when it names a step (an item starting, or one completing, which leaves the turn on its newest
 * item still in flight or awaiting the model, so a finished tool or compaction is never still named), and otherwise
 * at most once per {@link PLAN_CALL_LIMITS.progressEveryMs}, the instant recorded in `sentMs` when it is.
 *
 * @param method the notification's method
 * @param params the notification's params
 * @param threadId the call's own thread, whose notifications alone count
 * @param running the call's Codex turns running now, outside which an item is no progress
 * @param turns every running turn's items in flight and open wait, updated here
 * @param sentMs when each turn's progress was last forwarded, updated here
 * @param nowMs the call's time now
 * @returns the events to forward, none for another thread's item, a turn not running, or progress not yet due
 */
export function itemEventsOf({
  method,
  params,
  threadId,
  running,
  turns,
  sentMs,
  nowMs,
}: {
  method: string;
  params: unknown;
  threadId: string | undefined;
  running: ReadonlySet<string>;
  turns: CallTurnItems;
  sentMs: Map<string, number>;
  nowMs: number;
}): readonly (PlanTurnEvent | PlanModelWaitEvent)[] {
  const move = itemMoveOf({ method, nowMs, params, running, threadId, turns });
  if (move === undefined) {
    return [];
  }
  const { step, turnId, wait } = move;
  const events: (PlanTurnEvent | PlanModelWaitEvent)[] = wait === undefined ? [] : [wait];
  const sent = sentMs.get(turnId);
  if (step === null && sent !== undefined && nowMs - sent < PLAN_CALL_LIMITS.progressEveryMs) {
    return events;
  }
  sentMs.set(turnId, nowMs);
  return [...events, { kind: "codex-turn", phase: "progress", step, turnId }];
}

/**
 * What one app-server `error` or `warning` notification of the call's own thread is forwarded as
 * (`codexNoticeOf`, `./talkPlanProtocolTurns.ts`): a `codex-notice` for the call file, and, for a re-send inside a
 * turn still running, that turn's step put to awaiting the re-send, so the orb says the reply dropped rather than
 * counting on as if nothing had happened. Never the call's `error`, which would draw the orb's error face over a
 * turn Codex is still working: a failure that ends the turn arrives on `turn/completed`, which is what reads it.
 *
 * @param method the notification's method
 * @param params the notification's params
 * @param threadId the call's own thread, whose notices alone count
 * @param running the call's Codex turns running now, outside which a re-send moves no step
 * @returns the events to forward, none for another thread's notice or one the console cannot read
 */
export function codexNoticeEventsOf({
  method,
  params,
  threadId,
  running,
}: {
  method: string;
  params: unknown;
  threadId: string | undefined;
  running: ReadonlySet<string>;
}): readonly (PlanTurnEvent | PlanCodexNoticeEvent)[] {
  const notice = codexNoticeOf({ method, params });
  if (notice === undefined || notice.threadId !== threadId) {
    return [];
  }
  const { message } = notice;
  if (notice.kind === "warning") {
    return [{ kind: "codex-notice", level: "warning", message, turnId: null }];
  }
  const { turnId } = notice;
  const recorded: PlanCodexNoticeEvent = { kind: "codex-notice", level: notice.kind, message, turnId };
  if (notice.kind === "failure" || !running.has(turnId)) {
    return [recorded];
  }
  return [recorded, { kind: "codex-turn", phase: "progress", step: { kind: "awaiting", reason: "retry" }, turnId }];
}

/**
 * A Codex turn started: count it running and, when it was not already, tell every waiter on the next turn. A replayed
 * start of a turn already running is no new turn, so no waiter takes it (else the turn running at
 * a nudge's press would settle the turn that nudge was owed, `./talkPlanOwedTurn.ts`).
 *
 * @param running the call's Codex turns running now, which gains this one
 * @param waiters the call's waiters on the next turn's start, told and cleared on a new one
 * @param turnId the turn that started
 */
export function turnStarted({
  running,
  waiters,
  turnId,
}: {
  running: Set<string>;
  waiters: Set<TurnWaiter>;
  turnId: string;
}): void {
  if (running.has(turnId)) {
    return;
  }
  running.add(turnId);
  for (const waiter of waiters) {
    waiter(turnId);
  }
  waiters.clear();
}

/**
 * The turn a look's frame goes into without a start of its own: the newest running one, else the next to start within
 * {@link PLAN_CALL_LIMITS.lookStartMs}, or `undefined` when none does or the call ends first — when the console starts
 * one itself (`./talkPlanSteer.ts`'s `attachLookFrame`).
 *
 * @param running the call's Codex turns running now, oldest first
 * @param clock time
 * @param waiters the call's waiters, which a turn's start and the call's end each resolve
 * @returns the turn's id
 */
export async function lookTurnOf({
  running,
  clock,
  waiters,
}: {
  running: ReadonlySet<string>;
  clock: CallClock;
  waiters: Set<TurnWaiter>;
}): Promise<string | undefined> {
  const newest = Array.from(running).at(-1);
  if (newest !== undefined) {
    return newest;
  }
  return new Promise((resolve) => {
    const waiter: TurnWaiter = (turnId) => {
      cancel();
      waiters.delete(waiter);
      resolve(turnId);
    };
    const cancel = clock.after({
      ms: PLAN_CALL_LIMITS.lookStartMs,
      run: () => {
        waiter(undefined);
      },
    });
    waiters.add(waiter);
  });
}

/**
 * Stop each of the turns, one `turn/interrupt` at a time.
 *
 * @param turnIds the turns running at the owner's press
 * @param threadId the call's thread
 * @param request sends one request and waits for its fate
 * @returns which turns stopped, and which did not answer that they had
 */
export async function interruptTurns({
  turnIds,
  threadId,
  request,
}: {
  turnIds: readonly string[];
  threadId: string;
  request: (input: { method: string; params: unknown; timeoutMs: number }) => Promise<RpcOutcome>;
}): Promise<{ interrupted: string[]; notInterrupted: string[] }> {
  const interrupted: string[] = [];
  const notInterrupted: string[] = [];
  for (const turnId of turnIds) {
    const params = { threadId, turnId };
    const stopped = await request({ method: "turn/interrupt", params, timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs });
    if (stopped.kind === "result") {
      interrupted.push(turnId);
    } else {
      notInterrupted.push(turnId);
    }
  }
  return { interrupted, notInterrupted };
}
