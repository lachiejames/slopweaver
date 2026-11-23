/**
 * `runListenLoop` racing a `--deadline-ms` clock: the clock wins an idle or stalled wait, an admitted address
 * wins the clock, and no exit or rejection of the work arm is masked, left unhandled, or left hanging.
 */
import { describe, expect, it } from "vitest";

import {
  type ListenDeps,
  type ListenLoopResult,
  runListenLoop,
  WORK_ARM_GRACE_MS,
} from "../../../../../../cli/commands/listen/loop.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { SocketTicketErrors } from "../../../../../../live/listen/errors.js";
import { UNSCOPED } from "../../../../../../live/listen/scope.js";
import type { SocketConnection } from "../../../../../../live/listen/socket.js";
import type { ResponderWhitelist } from "../../../../../../live/listen/whitelist.js";
import {
  ADMITS_U0HUMAN,
  EIGHT_FAILURES,
  HELLO_TWO,
  harness,
  mentionFrame,
  noRefusal,
  STOP_FRAME,
  type Step,
} from "./harness.js";
import { controllableWait, flushMicrotasks, idleConnection } from "./seams.js";

describe("runListenLoop — deadline mode", () => {
  it("a past deadline wins the clock immediately, without ever opening a ticket", async () => {
    let ticketOpened = false;
    const deps: ListenDeps = {
      ...harness({ script: [] }).deps,
      nowMs: () => 10_000,
      openTicket: async () => {
        ticketOpened = true;
        return ok("wss://fake");
      },
    };

    const result = await runListenLoop({ appToken: "xapp-app", deadlineMs: 9_000, deps, once: true });

    expect(result).toEqual({ deadlineMs: 9_000, kind: "clock-wake" });
    expect(ticketOpened).toBe(false);
  });

  it("a current (equal) deadline also wins the clock immediately", async () => {
    const deps: ListenDeps = { ...harness({ script: [] }).deps, nowMs: () => 5_000 };

    const result = await runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });

    expect(result).toEqual({ deadlineMs: 5_000, kind: "clock-wake" });
  });

  it("the clock cancels an idle, already-open connection instead of hanging forever", async () => {
    const idle = idleConnection();
    const control = controllableWait();
    const deps: ListenDeps = {
      allowMultipleConnections: false,
      handler: async () => undefined,
      log: () => undefined,
      nowMs: () => 0,
      openConnection: async () => idle.connection,
      openTicket: async () => ok("wss://fake"),
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      scope: UNSCOPED,
      threadReplyChannels: [],
      responderWhitelist: () => ADMITS_U0HUMAN,
      wait: control.wait,
    };

    const resultPromise = runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });
    await flushMicrotasks();

    expect(control.calls.length).toBe(1);
    control.resolve({ index: 0, outcome: "elapsed" });
    const result = await resultPromise;

    expect(result).toEqual({ deadlineMs: 5_000, kind: "clock-wake" });
    expect(idle.cancelled).toEqual(["the deadline expired"]);
    expect(idle.closed).toEqual([]);
  });

  it("an admitted Slack address cancels the clock wait, and Slack's own exit wins", async () => {
    const control = controllableWait();
    const fixture = harness({ script: [[mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });
    const deps: ListenDeps = { ...fixture.deps, nowMs: () => 0, wait: control.wait };

    const result = await runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });

    expect(result).toEqual({ code: EXIT_OK, kind: "exit" });
    expect(fixture.handled).toEqual(["1785114398.557099"]);
    // The clock's own wait was armed, then cancelled when Slack won — never left pending, never fired.
    expect(control.calls.length).toBe(1);
    expect(control.calls[0]!.signal.aborted).toBe(true);
  });

  it("the clock winning during reconnect backoff stops the loop rather than reconnecting", async () => {
    const control = controllableWait();
    // A ticket failure puts the work loop into a reconnect-backoff wait, which shares the SAME `wait` seam —
    // the clock and the backoff are told apart by which `ms` each call recorded.
    const fixture = harness({ script: ["no-ticket"] });
    const deps: ListenDeps = { ...fixture.deps, nowMs: () => 0, wait: control.wait };

    const resultPromise = runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });
    await flushMicrotasks();

    // Two waits in flight: the backoff (a real delay) and the clock (5_000ms, from nowMs 0).
    expect(control.calls.length).toBe(2);
    const clockCallIndex = control.calls.findIndex((call) => call.ms === 5_000);
    control.resolve({ index: clockCallIndex, outcome: "elapsed" });
    const result = await resultPromise;

    expect(result).toEqual({ deadlineMs: 5_000, kind: "clock-wake" });
  });

  it("the clock still wins while a refused hello is waiting out its grace backoff", async () => {
    const control = controllableWait();
    const fixture = harness({ script: [[HELLO_TWO]] });
    const deps: ListenDeps = { ...fixture.deps, nowMs: () => 0, wait: control.wait };

    const resultPromise = runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });
    // The refused hello's cancel and drain take more turns than one flush before the backoff wait is armed.
    for (let flush = 0; flush < 4; flush += 1) {
      await flushMicrotasks();
    }

    expect(control.calls.map((call) => call.ms).toSorted((a, b) => a - b)).toEqual([1_000, 5_000]);
    control.resolve({ index: control.calls.findIndex((call) => call.ms === 5_000), outcome: "elapsed" });
    const result = await resultPromise;

    expect(result).toEqual({ deadlineMs: 5_000, kind: "clock-wake" });
    expect(fixture.lines.filter((line) => line.startsWith("stopping:"))).toEqual([]);
  });

  /**
   * The fix for the gap R1/R3 both found: `openTicket` now receives the work arm's own `AbortSignal`, so a
   * ticket-open that is merely slow or stalled settles on abort instead of outliving the clock. Before the
   * fix, `openTicket` was never given a signal at all — this fake, which resolves ONLY when its signal
   * fires, would have left `resultPromise` permanently pending and this test would time out.
   */
  it("threads the deadline's own signal into openTicket, so a stalled ticket-open aborts instead of outliving the clock", async () => {
    const control = controllableWait();
    let receivedSignal: AbortSignal | undefined;
    const deps: ListenDeps = {
      allowMultipleConnections: false,
      handler: async () => undefined,
      log: () => undefined,
      nowMs: () => 0,
      openConnection: async () => idleConnection().connection,
      openTicket: ({ signal }) =>
        new Promise((resolve) => {
          receivedSignal = signal;
          signal?.addEventListener("abort", () => {
            resolve(err(SocketTicketErrors.unreachable({ message: "ticket-open aborted" })));
          });
        }),
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      scope: UNSCOPED,
      threadReplyChannels: [],
      responderWhitelist: () => ADMITS_U0HUMAN,
      wait: control.wait,
    };

    const resultPromise = runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });
    await flushMicrotasks();

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);
    expect(control.calls.length).toBe(1);
    control.resolve({ index: 0, outcome: "elapsed" });
    const result = await resultPromise;

    expect(result).toEqual({ deadlineMs: 5_000, kind: "clock-wake" });
    expect(receivedSignal?.aborted).toBe(true);
  });

  /**
   * The fix for the R1/R3 finding that survived the ticket-open and socket-teardown fixes: a REFUSAL never
   * touches `addressStart`/the arbiter by design (see `socket.ts`), so `refuseResponder` hanging forever —
   * no abort seam of its own — blocks `consumeMentions`'s sequential frame loop from ever returning, which
   * blocks the work arm, which blocked the whole race before this fix. `WORK_ARM_GRACE_MS` bounds it now:
   * once the clock wins, the work arm gets that long to unwind before this proceeds without it.
   */
  it("does not hang forever when the clock wins while a per-frame side effect (refuseResponder) never settles on its own", async () => {
    const control = controllableWait();
    const fixture = harness({ script: [[mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });
    const closedWhitelist: ResponderWhitelist = { identities: [], kind: "list" };
    const deps: ListenDeps = {
      ...fixture.deps,
      nowMs: () => 0,
      refuseResponder: () => new Promise<void>(() => undefined),
      responderWhitelist: () => closedWhitelist,
      wait: control.wait,
    };

    const resultPromise = runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });
    await flushMicrotasks();

    // The refusal never resolves, so the work arm is stuck inside it — only the clock's own wait exists.
    expect(control.calls.length).toBe(1);
    control.resolve({ index: 0, outcome: "elapsed" });
    await flushMicrotasks();

    // The clock has won and told the work arm to abort, but the stuck refusal cannot notice: the grace
    // period is now armed as a second, independent wait.
    expect(control.calls.length).toBe(2);
    const graceCallIndex = control.calls.findIndex((call) => call.ms === WORK_ARM_GRACE_MS);
    expect(graceCallIndex).toBeGreaterThan(-1);
    control.resolve({ index: graceCallIndex, outcome: "elapsed" });
    const result = await resultPromise;

    expect(result).toEqual({ deadlineMs: 5_000, kind: "clock-wake" });
  });

  /**
   * The fix for the R1 finding on the fix above: `settleWorkArmAfterClockWins`'s own `workPromise.then()`
   * had no rejection handler, so a rejecting work arm (its `cancel()` throwing, here) left an unhandled
   * rejection that Node's default policy can terminate the process over — trading a hung race for a
   * crashed one. Both handlers now abort the grace wait; the failure is narrated, not left to propagate.
   */
  it("still reaches clock-wake, narrated rather than crashing, when cancel() itself rejects", async () => {
    const control = controllableWait();
    const fixture = harness({ script: [] });
    let cancelled = false;
    const endings: string[] = [];
    let wake: (() => void) | undefined;
    const rejectingConnection: SocketConnection = {
      acknowledge: () => undefined,
      cancel: async ({ why }) => {
        cancelled = true;
        endings.push(why);
        wake?.();
        throw new Error("teardown failed");
      },
      close: async () => undefined,
      discarded: () => 0,
      endedBecause: () => endings[0],
      // The same shape `idleConnection` uses: never yields a frame, only ever settling `done: true` once
      // `cancel` has run — a rejecting `cancel` must still end the frame source, exactly like a resolving
      // one, or nothing here would ever notice the abort at all.
      frames: (): AsyncIterable<string> => ({
        [Symbol.asyncIterator]: () => ({
          next: async (): Promise<IteratorResult<string>> => {
            for (;;) {
              if (endings.length > 0) {
                return { done: true, value: undefined };
              }
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          },
        }),
      }),
    };
    const deps: ListenDeps = {
      ...fixture.deps,
      nowMs: () => 0,
      openConnection: async () => rejectingConnection,
      wait: control.wait,
    };

    const resultPromise = runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });
    await flushMicrotasks();

    expect(control.calls.length).toBe(1);
    control.resolve({ index: 0, outcome: "elapsed" });
    const result = await resultPromise;

    expect(result).toEqual({ deadlineMs: 5_000, kind: "clock-wake" });
    expect(cancelled).toBe(true);
    expect(fixture.lines.some((line) => line.includes("cancel failed while the deadline was winning"))).toBe(true);
  });

  /**
   * The fix for a THIRD unhandled-rejection window a review pass found: `workPromise` had no handler at
   * all until whichever branch of `raceAgainstDeadline` reached it — a rejection landing while the clock's
   * own wait is STILL PENDING (a genuinely future deadline, not yet elapsed) had nothing attached, which is
   * exactly the window Node's default unhandled-rejection policy can terminate a process over. The clock's
   * own wait is deliberately left unresolved here — this settles on its own, without ever needing it.
   */
  it("does not produce an unhandled rejection when the work arm rejects while the clock's own wait is still pending", async () => {
    const control = controllableWait();
    const fixture = harness({ script: [] });
    const deps: ListenDeps = {
      ...fixture.deps,
      nowMs: () => 0,
      openConnection: async () => {
        throw new Error("socket construction failed");
      },
      wait: control.wait,
    };

    const result = await runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });

    // The work arm rejected on its own, independent of the arbiter — reported immediately as a fatal exit
    // rather than masked behind the clock's still-pending wait. See the next test for that exact fix.
    expect(result).toEqual({ code: EXIT_ERROR, kind: "exit" });
    expect(control.calls.length).toBe(1);
  });

  /**
   * The fix for the MOST serious finding two review passes converged on: a fatal or graceful reconnect-loop
   * exit that never touches the arbiter (never an admitted Slack address, never the clock winning) used to
   * be silently masked until the deadline elapsed, then REPLACED by a `clock-wake` outcome — reporting
   * success over an already-dead listener. `link_disabled` is exactly this: a permanent disconnect reason
   * the reconnect loop stops on entirely independently of anything racing against it.
   */
  it("reports an independent fatal reconnect-loop exit immediately, never masked behind the still-pending clock", async () => {
    const control = controllableWait();
    const fixture = harness({ script: EIGHT_FAILURES });
    const deps: ListenDeps = { ...fixture.deps, nowMs: () => 0, wait: control.wait };

    const resultPromise = runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });
    await flushMicrotasks();

    // Every backoff wait the reconnect budget takes resolves "elapsed" immediately — none of them is the
    // clock's own 5_000ms wait, which stays deliberately unresolved throughout. `calls` never shrinks, so a
    // resolved index is tracked explicitly rather than re-found by `findIndex` — and the loop is bounded
    // rather than trusted to terminate on its own.
    const resolved = new Set<number>();
    for (let iteration = 0; iteration < EIGHT_FAILURES.length + 2; iteration += 1) {
      const pendingBackoff = control.calls.findIndex((call, index) => call.ms !== 5_000 && !resolved.has(index));
      if (pendingBackoff === -1) {
        break;
      }
      resolved.add(pendingBackoff);
      control.resolve({ index: pendingBackoff, outcome: "elapsed" });
      await flushMicrotasks();
    }
    const result = await resultPromise;

    expect(result).toEqual({ code: EXIT_ERROR, kind: "exit" });
    expect(control.calls.some((call) => call.ms === 5_000)).toBe(true);
  });

  /**
   * The fix for a THIRD finding two review passes converged on: `stepAfterDrain`'s pre-existing "a refusal
   * satisfies --once too" rule (needed so the ordinary path doesn't hang after replying to a refused tag)
   * was ALSO firing in deadline mode, where a refusal followed by the connection ending naturally reached
   * the same independent-exit path the previous fix built — reporting a bare `{kind:"exit"}` with no
   * discriminated JSON at all. That is a refusal ending a `--deadline-ms` wait, contradicting the arbiter's
   * own documented contract. Deadline mode now reconnects and keeps waiting instead.
   */
  it("reconnects rather than exiting when a refusal is followed by the connection ending naturally, in deadline mode", async () => {
    const control = controllableWait();
    // A `warning` disconnect is Slack's own ROUTINE-rotation reason (see reconnect.ts's EXPECTED_ROTATIONS)
    // — reconnected immediately, no failure budget spent — unlike the fixture's own fatal `link_disabled`
    // stop-frame, which fires once the script runs dry and would end this test's loop for the wrong reason.
    const WARNING_FRAME = JSON.stringify({ reason: "warning", type: "disconnect" });
    const script: readonly Step[] = [
      [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }), WARNING_FRAME],
      ...Array(50).fill([WARNING_FRAME]),
    ];
    const fixture = harness({ script });
    const closedWhitelist: ResponderWhitelist = { identities: [], kind: "list" };
    const deps: ListenDeps = {
      ...fixture.deps,
      nowMs: () => 0,
      responderWhitelist: () => closedWhitelist,
      wait: control.wait,
    };

    const resultPromise = runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });
    let settled: ListenLoopResult | undefined;
    void resultPromise.then((result): void => {
      settled = result;
      return;
    });

    // The refused mention's connection then ends naturally (the script runs dry). Any reconnect backoff
    // this takes resolves immediately; the clock's own 5_000ms wait, deliberately, never does on its own —
    // interleaved with checking settlement on EVERY tick, rather than assuming a fixed number of ticks is
    // enough: a broken build settles `workPromise` independently well within this budget, which is exactly
    // what this test exists to catch. `settled` is mutated by the sibling `.then()` above, invisible to a
    // static loop-condition check, so the loop is a bounded `for (;;)` with an explicit break instead.
    const resolved = new Set<number>();
    for (let tick = 0; tick < 200; tick += 1) {
      if (settled !== undefined) {
        break;
      }
      const pendingBackoff = control.calls.findIndex((call, index) => call.ms !== 5_000 && !resolved.has(index));
      if (pendingBackoff !== -1) {
        resolved.add(pendingBackoff);
        control.resolve({ index: pendingBackoff, outcome: "elapsed" });
      }
      await Promise.resolve();
    }

    expect(settled).toBeUndefined();
    expect(control.calls.some((call) => call.ms === 5_000)).toBe(true);
    const clockCallIndex = control.calls.findIndex((call) => call.ms === 5_000);
    control.resolve({ index: clockCallIndex, outcome: "elapsed" });
    const result = await resultPromise;

    expect(result).toEqual({ deadlineMs: 5_000, kind: "clock-wake" });
  });

  /**
   * The fix for the MOST serious finding two review passes converged on: `AddressStart` permanently
   * disables the clock the instant it admits ANY address, so if that address's handler then throws (a
   * `--queue` file write failing, say), there is no clock left to end the wait and no reason to expect a
   * second address will ever arrive. An earlier version left the connection open hoping for exactly that,
   * which meant this scenario hung forever. It must exit immediately instead, reporting EXIT_ERROR — the
   * one outcome that could have satisfied deadline mode's `--once` genuinely failed.
   */
  it("reports EXIT_ERROR immediately when the winning admitted handler throws — no clock left to save it", async () => {
    const control = controllableWait();
    const fixture = harness({ script: [[mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });
    const deps: ListenDeps = {
      ...fixture.deps,
      handler: async () => {
        throw new Error("appendQueueLine threw");
      },
      nowMs: () => 0,
      wait: control.wait,
    };

    const result = await runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });

    expect(result).toEqual({ code: EXIT_ERROR, kind: "exit" });
    expect(control.calls.length).toBe(1);
  });

  /**
   * Two review passes converged on this: a fatal `link_disabled` disconnect arriving mid-connection, then
   * an already-buffered admitted address that goes on to SUCCEED before the socket actually closes, let
   * `wonAddressConcluded` report a plain `EXIT_OK` and permanently mask the fatal condition — worse than
   * the disclosed clock-vs-fatal tight window, which only delays escalation by one loop iteration. The
   * admitted address's own emission still happens; the fatal exit code is a signal ADDED on top of it, not
   * a retraction.
   */
  it("reports the observed fatal link_disabled exit even when a buffered admitted address succeeds afterward", async () => {
    const control = controllableWait();
    const fixture = harness({ script: [[STOP_FRAME, mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });
    const deps: ListenDeps = { ...fixture.deps, nowMs: () => 0, wait: control.wait };

    const result = await runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });

    expect(result).toEqual({ code: EXIT_ERROR, kind: "exit" });
    expect(fixture.handled).toEqual(["1785114398.557099"]);
  });

  /**
   * The fix for the gate pass that found the fix above was not itself sticky: a SECOND disconnect frame (any
   * other reason) arriving on the same connection after the fatal `link_disabled` one would silently
   * overwrite `disconnectReason`, letting a subsequently-successful admission mask the fatal condition all
   * over again — this time via a different route into the same outcome. The fatal reason, once observed,
   * survives a later, non-fatal disconnect on the same connection.
   */
  it("keeps the fatal link_disabled reason even after a later, non-fatal disconnect on the same connection", async () => {
    const control = controllableWait();
    const warningFrame = JSON.stringify({ reason: "warning", type: "disconnect" });
    const fixture = harness({
      script: [[STOP_FRAME, warningFrame, mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]],
    });
    const deps: ListenDeps = { ...fixture.deps, nowMs: () => 0, wait: control.wait };

    const result = await runListenLoop({ appToken: "xapp-app", deadlineMs: 5_000, deps, once: true });

    expect(result).toEqual({ code: EXIT_ERROR, kind: "exit" });
    expect(fixture.handled).toEqual(["1785114398.557099"]);
  });
});
