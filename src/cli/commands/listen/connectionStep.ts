/**
 * What one drained connection means for the reconnect loop, and the wait that follows it. Pulled out of
 * `./loop.ts`, which owns opening and draining a connection and racing a deadline; this file owns the
 * decision between connections — exit, reconnect after a backoff, or stop.
 *
 * ## A refused `hello` is retried before it is fatal
 *
 * `num_connections` counts what Slack still HOLDS for the app, so a socket this listener has just lost can
 * keep counting for a while after it is gone, and the reconnect that follows is told `2` by its own ghost.
 * That has killed an arm. So a refusal is retried on the ordinary backoff for
 * {@link MULTIPLE_CONNECTIONS_GRACE_MS}, outside the consecutive-failure budget (which would otherwise end the
 * listener first), and only a refusal past that window exits. Every refused connection is still cancelled at
 * its `hello`, before anything buffered on it is handled — the grace is in the PROCESS, never in the socket.
 */

import {
  MULTIPLE_CONNECTIONS_GRACE_MS,
  type MultipleConnectionsRefusal,
  multipleConnectionsGraceDecision,
} from "../../../live/listen/connections.js";
import type { DedupeState } from "../../../live/listen/dedupe.js";
import { reconnectDelayMs, reconnectPlan, SLACK_LINK_DISABLED } from "../../../live/listen/reconnect.js";
import type { ConnectionOutcome, ConsumeResult, SocketConnection } from "../../../live/listen/socket.js";
import type { ThreadReplyCounts } from "../../../live/listen/threadReply.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { connectionEndedReason } from "./connectionEnd.js";
import type { ListenDeps } from "./loop.js";

/**
 * What one connection attempt did: it ended (and why, and whether its `hello` was permitted or refused), the
 * verb is finished (`--once`), or — deadline mode only — the wait was aborted because the clock already won
 * elsewhere and this attempt gave up early.
 */
export type ConnectionStep =
  | {
      readonly kind: "ended";
      readonly reason: string;
      readonly helloPermitted: boolean;
      readonly connectionRefusal: MultipleConnectionsRefusal | undefined;
      readonly seen: DedupeState;
      readonly threadReplies: ThreadReplyCounts;
    }
  | {
      readonly kind: "exit";
      readonly code: number;
      readonly seen: DedupeState;
      readonly threadReplies: ThreadReplyCounts;
    }
  | { readonly kind: "aborted"; readonly seen: DedupeState; readonly threadReplies: ThreadReplyCounts };

/**
 * Deadline mode's own `--once` exit decision — pulled out of `stepAfterDrain` to keep its complexity down.
 *
 * Checks the fatal `link_disabled` disconnect BEFORE `wonAddressConcluded`, not after: a review pass found
 * that the reason arriving mid-connection, followed (before the socket actually closes) by an
 * already-buffered admitted address that goes on to succeed, let `wonAddressConcluded` report a plain
 * `EXIT_OK` and PERMANENTLY mask the fatal condition — worse than the disclosed clock-vs-fatal tight window,
 * which only delays escalation by one loop iteration. The admitted address's own JSON has already been
 * emitted by its handler regardless of what this returns; reporting the fatal exit code here adds a signal
 * to go check the listener, it does not retract that emission.
 *
 * A refusal must never satisfy this: a review pass found that a refusal followed by the connection ending
 * naturally (no admitted address, no clock win) was reaching this exact decision and reporting a silent
 * `{kind:"exit"}` with no discriminated JSON at all — a refusal ending a `--deadline-ms` wait, which the
 * arbiter's own contract (`AddressStart`'s docstring) and `skills/loop/SKILL.md` both say can never happen.
 *
 * An admitted address's handler FAILING must still satisfy this, unlike ordinary `--once`: `AddressStart`
 * permanently disables the clock the instant it admits ANY address, so if that address's handler then
 * throws, there is no clock left to end the wait and no reason to expect a second address will arrive —
 * reconnecting to wait for one is an unbounded hang two more review passes converged on. `handled` staying 0
 * no longer means "not yet satisfied" here; it means the ONE outcome that could satisfy it failed, which is
 * `EXIT_ERROR`, not the success case's `EXIT_OK`.
 *
 * @param once whether one resolved address is enough to stop
 * @param outcome the drained connection's outcome
 * @returns the exit step, or `undefined` when nothing here decides it
 */
function deadlineModeExit({
  once,
  outcome,
}: {
  once: boolean;
  outcome: ConnectionOutcome;
}): { readonly code: number; readonly kind: "exit" } | undefined {
  if (outcome.disconnectReason === SLACK_LINK_DISABLED) {
    return { code: EXIT_ERROR, kind: "exit" };
  }
  if (once && outcome.wonAddressConcluded) {
    return { code: outcome.handled > 0 ? EXIT_OK : EXIT_ERROR, kind: "exit" };
  }
  return undefined;
}

/**
 * Turn one drained connection into the loop's next step.
 *
 * @param attempt the connection, asked for its own close reason when Slack stated none
 * @param discardBufferedAfterFirst whether this is deadline mode, which decides `--once` differently
 * @param drained what the connection did, and the windows to carry forward
 * @param once whether one resolved address is enough to stop
 * @param signal the loop's abort, which turns an unproductive connection into an `aborted` step
 * @returns exit, aborted, or ended with the reason and how its `hello` went
 */
export function stepAfterDrain({
  attempt,
  discardBufferedAfterFirst,
  drained,
  once,
  signal,
}: {
  attempt: SocketConnection;
  discardBufferedAfterFirst: boolean;
  drained: ConsumeResult;
  once: boolean;
  signal: AbortSignal;
}): ConnectionStep {
  const carried = { seen: drained.seen, threadReplies: drained.threadReplies };
  const { outcome } = drained;
  // A refused `hello` is decided by the reconnect loop's grace window, not here: `handleHello` already
  // cancelled this connection, so nothing it buffered was handled, and no `--once` or deadline outcome can
  // have been reached on it.
  if (outcome.connectionRefusal !== undefined) {
    return {
      ...carried,
      connectionRefusal: outcome.connectionRefusal,
      helloPermitted: false,
      kind: "ended",
      reason: "multiple Socket Mode connections",
    };
  }
  if (signal.aborted && outcome.handled === 0) {
    return { ...carried, kind: "aborted" };
  }
  // A refusal is the addressed message's final deterministic response, exactly like an answered one — so
  // ordinary `--once` is satisfied by either, not just `handled`. Only counting `handled` there would leave
  // `listen --once --emit` hanging after replying to a refused tag, waiting for a second address. Deadline
  // mode uses a DIFFERENT decision entirely — see {@link deadlineModeExit}.
  const deadlineExit = discardBufferedAfterFirst ? deadlineModeExit({ once, outcome }) : undefined;
  if (deadlineExit !== undefined) {
    return { ...deadlineExit, ...carried };
  }
  if (!discardBufferedAfterFirst && once && outcome.handled + outcome.refused > 0) {
    return { ...carried, code: EXIT_OK, kind: "exit" };
  }
  return {
    ...carried,
    connectionRefusal: undefined,
    helloPermitted: outcome.helloPermitted,
    kind: "ended",
    reason: connectionEndedReason({ attempt, outcome }),
  };
}

/** What one ended connection's reconnect decision produced: keep going, or the code to stop with. */
export type ReconnectOutcome = { readonly kind: "stop"; readonly code: number } | { readonly kind: "continue" };

/** The counters the reconnect loop carries from one ended connection into the next. */
export interface ReconnectCounters {
  /** Unexpected endings in a row since the last permitted `hello` — refused `hello`s never count here. */
  readonly failures: number;
  /**
   * When the loop judged the open streak's first refused `hello`, or `undefined` when none is open. Every
   * refusal is timed at that judgement, after its cancelled connection drained, never at the frame itself —
   * so the window can stretch by one cancel's drain, and is still bounded.
   */
  readonly firstRefusalAtMs: number | undefined;
  /**
   * The backoff the open streak has waited out, summed — the window's floor on timers, so a wall clock moved
   * backward mid-streak cannot stretch it.
   */
  readonly refusalBackoffMs: number;
  /** Refused `hello`s in the open streak — the grace retries' own backoff schedule, apart from the budget. */
  readonly refusals: number;
}

/** No failure in a row and no refusal streak open — a fresh loop, and the state after a permitted `hello`. */
export const FRESH_RECONNECT_COUNTERS: ReconnectCounters = Object.freeze({
  failures: 0,
  firstRefusalAtMs: undefined,
  refusalBackoffMs: 0,
  refusals: 0,
});

/**
 * Wait out the backoff before the next attempt, or stop when the operator's signal fires during it.
 *
 * @returns the decision, carrying `counters` forward into the next attempt
 */
async function backOff({
  counters,
  delayMs,
  deps,
  signal,
}: {
  counters: ReconnectCounters;
  delayMs: number;
  deps: Pick<ListenDeps, "wait">;
  signal: AbortSignal;
}): Promise<{ readonly decision: ReconnectOutcome; readonly counters: ReconnectCounters }> {
  const waited = await deps.wait({ ms: delayMs, signal });
  if (waited === "cancelled") {
    return { counters, decision: { code: EXIT_OK, kind: "stop" } };
  }
  return { counters, decision: { kind: "continue" } };
}

/**
 * A refused `hello`: retry it on the ordinary backoff while its streak is inside the grace window, and stop
 * once it is not. See the module doc for why the failure budget does not apply.
 */
async function afterRefusedHello({
  counters,
  deps,
  refusal,
  signal,
}: {
  counters: ReconnectCounters;
  deps: Pick<ListenDeps, "log" | "nowMs" | "wait">;
  refusal: MultipleConnectionsRefusal;
  signal: AbortSignal;
}): Promise<{ readonly decision: ReconnectOutcome; readonly counters: ReconnectCounters }> {
  const grace = multipleConnectionsGraceDecision({
    backedOffMs: counters.refusalBackoffMs,
    firstRefusalAtMs: counters.firstRefusalAtMs,
    nowMs: deps.nowMs(),
    windowMs: MULTIPLE_CONNECTIONS_GRACE_MS,
  });
  if (grace.kind === "refuse") {
    deps.log({
      line:
        `stopping: Slack still reports ${String(refusal.connections)} connections ${String(grace.waitedMs)}ms ` +
        `after the first refused hello, past the ${String(MULTIPLE_CONNECTIONS_GRACE_MS)}ms grace for a socket ` +
        "this listener lost to drain — another listener holds this app. Stop it and retry.",
    });
    return { counters, decision: { code: EXIT_ERROR, kind: "stop" } };
  }
  const delayMs = reconnectDelayMs({ consecutiveFailures: counters.refusals });
  deps.log({
    line:
      `retrying in ${String(delayMs)}ms — Slack may still be counting a socket this listener lost ` +
      `(${String(grace.waitedMs)}ms into a ${String(MULTIPLE_CONNECTIONS_GRACE_MS)}ms grace window)`,
  });
  // `failures` passes through untouched: a ticket or socket that fails mid-streak still gets the whole budget.
  const next = {
    ...counters,
    firstRefusalAtMs: grace.firstRefusalAtMs,
    refusalBackoffMs: counters.refusalBackoffMs + delayMs,
    refusals: counters.refusals + 1,
  };
  return backOff({ counters: next, delayMs, deps, signal });
}

/**
 * Decide, log and wait out one reconnect step after a connection ended.
 *
 * A permitted `hello` on the connection that just ended resets every counter FIRST: the socket was live, so
 * whatever failed before it is no longer consecutive, and no refusal streak is open.
 *
 * @param counters what the loop carried in from the connections before this one
 * @param signal cancels the backoff wait early — the clock winning, or the operator stopping
 * @param step the connection that just ended
 * @returns the decision, and the counters to carry into the next attempt
 */
export async function afterConnectionEnded({
  counters,
  deps,
  signal,
  step,
}: {
  counters: ReconnectCounters;
  deps: Pick<ListenDeps, "log" | "nowMs" | "wait">;
  signal: AbortSignal;
  step: Extract<ConnectionStep, { kind: "ended" }>;
}): Promise<{ readonly decision: ReconnectOutcome; readonly counters: ReconnectCounters }> {
  const current = step.helloPermitted ? FRESH_RECONNECT_COUNTERS : counters;
  if (step.connectionRefusal !== undefined) {
    return afterRefusedHello({ counters: current, deps, refusal: step.connectionRefusal, signal });
  }
  const plan = reconnectPlan({ consecutiveFailures: current.failures, reason: step.reason });
  if (plan.kind === "stop") {
    deps.log({ line: plan.why });
    return { counters: current, decision: { code: EXIT_ERROR, kind: "stop" } };
  }
  if (plan.delayMs > 0) {
    deps.log({ line: `reconnecting in ${String(plan.delayMs)}ms (${step.reason})` });
  }
  const next = { ...current, failures: plan.expected ? 0 : current.failures + 1 };
  return backOff({ counters: next, delayMs: plan.delayMs, deps, signal });
}
