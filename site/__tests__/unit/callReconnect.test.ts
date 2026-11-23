/*
 * A dropped live call reconnects on its own, and keeps trying until it is back; the owner's hang-up, a page leave and a pressed
 * start that failed never do, and after quitting the app it waits for the owner to press start call. Every failed
 * attempt is journalled onto the dropped call: measured, one read "tried to, but it didn't succeed" and nothing on
 * disk said why.
 */
import { describe, expect, it } from "vitest";

import {
  callEndOutcome,
  LINK_LOST_WORDS,
  NETWORK_WAIT_WORDS,
  RECONNECT_DELAYS_MS,
  RECONNECT_SETTLE_MS,
  ReconnectWait,
  reconnectGo,
  reconnectLiveJournal,
  reconnectStep,
  reconnectStepWords,
} from "../../lib/callReconnect";

const LIMIT = "the plan call ended: the console's own 90-minute call limit was reached";
const OFFLINE = "the console server did not answer the mint: TypeError: Failed to fetch";
const DROPPED_CALL = "a0000041-0000-4000-8000-000000000044";
const ATTEMPT_CALL = "a0000076-0000-4000-8000-000000000083";

/** The step written onto the dropped call as an attempt is scheduled. */
const scheduled = ({ attempt, delayMs }: { attempt: number; delayMs: number }) =>
  ({ attempt, delayMs, kind: "scheduled" }) as const;

describe("reconnectStep", () => {
  it("waits the declared delays in order, then the last one for every attempt after, never giving up", () => {
    const steps = [0, 1, 2, 3, 4, 5, 6, 40].map((failed) => reconnectStep({ failed }));
    expect(steps).toEqual([
      { attempt: 1, delayMs: 0 },
      { attempt: 2, delayMs: 2_000 },
      { attempt: 3, delayMs: 5_000 },
      { attempt: 4, delayMs: 15_000 },
      { attempt: 5, delayMs: 30_000 },
      { attempt: 6, delayMs: 30_000 },
      { attempt: 7, delayMs: 30_000 },
      { attempt: 41, delayMs: 30_000 },
    ]);
    expect(RECONNECT_DELAYS_MS.at(-1)).toBe(30_000);
  });
});

describe("reconnectGo", () => {
  it("makes a due attempt online, and parks it for the network offline", () => {
    expect([reconnectGo({ online: true }), reconnectGo({ online: false })]).toEqual(["attempt", "await-network"]);
  });
});

describe("callEndOutcome", () => {
  it("re-opens a live call that dropped at once, the first attempt, journalling it scheduled onto that call", () => {
    expect(callEndOutcome({ callId: DROPPED_CALL, chain: undefined, dropped: true, nowMs: 1_000, why: LIMIT })).toEqual(
      {
        attempt: 1,
        chain: { droppedCallId: DROPPED_CALL, failed: 0, liveAtMs: undefined },
        delayMs: 0,
        journal: { callId: DROPPED_CALL, events: [scheduled({ attempt: 1, delayMs: 0 })] },
        kind: "retry",
      },
    );
  });

  it("ends the owner's hang-up and a page leave for good, even mid-reconnect, journalling nothing", () => {
    const waiting = { droppedCallId: DROPPED_CALL, failed: 2, liveAtMs: undefined };
    const fresh = callEndOutcome({ callId: DROPPED_CALL, chain: undefined, dropped: false, nowMs: 0, why: undefined });
    const midway = callEndOutcome({ callId: ATTEMPT_CALL, chain: waiting, dropped: false, nowMs: 0, why: undefined });
    expect(fresh).toEqual({ journal: undefined, kind: "stop", why: undefined });
    expect(midway).toEqual({ journal: undefined, kind: "stop", why: undefined });
  });

  it("ends a pressed start that never went live with its own reason, journalling nothing", () => {
    const why = "the microphone was not available: denied";
    expect(callEndOutcome({ callId: undefined, chain: undefined, dropped: false, nowMs: 0, why })).toEqual({
      journal: undefined,
      kind: "stop",
      why,
    });
  });

  it("counts an attempt that never went live as one more failure, journals why onto the dropped call, and waits longer", () => {
    const waiting = { droppedCallId: DROPPED_CALL, failed: 0, liveAtMs: undefined };
    expect(callEndOutcome({ callId: ATTEMPT_CALL, chain: waiting, dropped: false, nowMs: 0, why: OFFLINE })).toEqual({
      attempt: 2,
      chain: { droppedCallId: DROPPED_CALL, failed: 1, liveAtMs: undefined },
      delayMs: 2_000,
      journal: {
        callId: DROPPED_CALL,
        events: [{ attempt: 1, kind: "failed", why: OFFLINE }, scheduled({ attempt: 2, delayMs: 2_000 })],
      },
      kind: "retry",
    });
  });

  it("tries again after the fifth attempt fails — where it used to give up — at the last wait", () => {
    const fifth = { droppedCallId: DROPPED_CALL, failed: 4, liveAtMs: undefined };
    expect(callEndOutcome({ callId: ATTEMPT_CALL, chain: fifth, dropped: false, nowMs: 0, why: OFFLINE })).toEqual({
      attempt: 6,
      chain: { droppedCallId: DROPPED_CALL, failed: 5, liveAtMs: undefined },
      delayMs: 30_000,
      journal: {
        callId: DROPPED_CALL,
        events: [{ attempt: 5, kind: "failed", why: OFFLINE }, scheduled({ attempt: 6, delayMs: 30_000 })],
      },
      kind: "retry",
    });
  });

  it("cuts a journalled reason at the verb's bound", () => {
    const waiting = { droppedCallId: DROPPED_CALL, failed: 0, liveAtMs: undefined };
    const long = "x".repeat(2_500);
    const outcome = callEndOutcome({ callId: ATTEMPT_CALL, chain: waiting, dropped: false, nowMs: 0, why: long });
    expect(outcome.journal!.events[0]).toEqual({ attempt: 1, kind: "failed", why: "x".repeat(2_000) });
  });

  it("journals nowhere when the drop came before any call was begun", () => {
    const waiting = { droppedCallId: undefined, failed: 0, liveAtMs: undefined };
    const outcome = callEndOutcome({ callId: undefined, chain: waiting, dropped: false, nowMs: 0, why: OFFLINE });
    expect(outcome).toEqual({
      attempt: 2,
      chain: { ...waiting, failed: 1 },
      delayMs: 2_000,
      journal: undefined,
      kind: "retry",
    });
  });

  it("continues the count when a reconnected call drops again before it settled, journalling onto the FIRST dropped call", () => {
    const back = { droppedCallId: DROPPED_CALL, failed: 1, liveAtMs: 10_000 };
    const again = "the plan call ended: the realtime transport closed";
    expect(
      callEndOutcome({
        callId: ATTEMPT_CALL,
        chain: back,
        dropped: true,
        nowMs: 10_000 + RECONNECT_SETTLE_MS - 1,
        why: again,
      }),
    ).toEqual({
      attempt: 3,
      chain: { droppedCallId: DROPPED_CALL, failed: 2, liveAtMs: undefined },
      delayMs: 5_000,
      journal: {
        callId: DROPPED_CALL,
        events: [{ attempt: 2, kind: "failed", why: again }, scheduled({ attempt: 3, delayMs: 5_000 })],
      },
      kind: "retry",
    });
  });

  it("starts a fresh count, for the call that just dropped, when a reconnected call drops after it settled", () => {
    const back = { droppedCallId: DROPPED_CALL, failed: 3, liveAtMs: 10_000 };
    expect(
      callEndOutcome({
        callId: ATTEMPT_CALL,
        chain: back,
        dropped: true,
        nowMs: 10_000 + RECONNECT_SETTLE_MS,
        why: LIMIT,
      }),
    ).toEqual({
      attempt: 1,
      chain: { droppedCallId: ATTEMPT_CALL, failed: 0, liveAtMs: undefined },
      delayMs: 0,
      journal: { callId: ATTEMPT_CALL, events: [scheduled({ attempt: 1, delayMs: 0 })] },
      kind: "retry",
    });
  });

  it("keeps backing off, never giving up, on a call that keeps falling straight over once it comes back", () => {
    const back = { droppedCallId: DROPPED_CALL, failed: 4, liveAtMs: 10_000 };
    expect(callEndOutcome({ callId: ATTEMPT_CALL, chain: back, dropped: true, nowMs: 10_500, why: LIMIT })).toEqual({
      attempt: 6,
      chain: { droppedCallId: DROPPED_CALL, failed: 5, liveAtMs: undefined },
      delayMs: 30_000,
      journal: {
        callId: DROPPED_CALL,
        events: [{ attempt: 5, kind: "failed", why: LIMIT }, scheduled({ attempt: 6, delayMs: 30_000 })],
      },
      kind: "retry",
    });
  });
});

describe("reconnectLiveJournal", () => {
  it("names the attempt after every failed one, and the call it went live as, onto the dropped call", () => {
    const waiting = { droppedCallId: DROPPED_CALL, failed: 1, liveAtMs: undefined };
    expect(reconnectLiveJournal({ chain: waiting, newCallId: ATTEMPT_CALL })).toEqual({
      callId: DROPPED_CALL,
      events: [{ attempt: 2, kind: "live", newCallId: ATTEMPT_CALL }],
    });
  });

  it("journals nowhere when the drop came before any call was begun", () => {
    const waiting = { droppedCallId: undefined, failed: 0, liveAtMs: undefined };
    expect(reconnectLiveJournal({ chain: waiting, newCallId: ATTEMPT_CALL })).toBe(undefined);
  });
});

// A dropped state carries a short plain label too.
describe("the orb's words", () => {
  it("says the connection is lost, plainly, at every stage of coming back", () => {
    expect([LINK_LOST_WORDS, reconnectStepWords({ attempt: 7 }), NETWORK_WAIT_WORDS]).toEqual([
      "connection lost, reconnecting",
      "connection lost, reconnecting, attempt 7",
      "connection lost, waiting for the network",
    ]);
  });
});

/**
 * A wait over a recording of what it did, a network the test flips, and a schedule that holds its one timer for the
 * test to fire.
 *
 * @returns the wait, what it did in order, the network, and the pending timer, if one is pending
 */
function waitOnFakes(): {
  wait: ReconnectWait;
  did: string[];
  network: { online: boolean };
  pending: { timer: { ms: number; run: () => void } | undefined };
} {
  const did: string[] = [];
  const network = { online: true };
  const pending: { timer: { ms: number; run: () => void } | undefined } = { timer: undefined };
  const wait = new ReconnectWait({
    attempt: ({ attempt }) => {
      did.push(`attempt ${String(attempt)}`);
    },
    online: () => network.online,
    parked: () => {
      did.push("parked");
    },
    schedule: (timer) => {
      pending.timer = timer;
      return () => {
        pending.timer = undefined;
      };
    },
  });
  return { did, network, pending, wait };
}

describe("ReconnectWait", () => {
  it("counts the attempt's wait down, then makes it", () => {
    const { did, pending, wait } = waitOnFakes();
    wait.wait({ attempt: 3, delayMs: 5_000 });
    expect(pending.timer!.ms).toBe(5_000);
    expect(did).toEqual([]);
    pending.timer!.run();
    expect(did).toEqual(["attempt 3"]);
  });

  it("parks an attempt that falls due offline, and makes it the moment the network is back", () => {
    const { did, network, pending, wait } = waitOnFakes();
    network.online = false;
    wait.wait({ attempt: 2, delayMs: 2_000 });
    pending.timer!.run();
    expect(did).toEqual(["parked"]);
    network.online = true;
    wait.networkBack();
    expect(did).toEqual(["parked", "attempt 2"]);
  });

  it("cuts a countdown short when the network comes back, and the cancelled timer never makes it twice", () => {
    const { did, pending, wait } = waitOnFakes();
    wait.wait({ attempt: 6, delayMs: 30_000 });
    const timer = pending.timer!;
    wait.networkBack();
    expect([did, pending.timer]).toEqual([["attempt 6"], undefined]);
    timer.run();
    expect(did).toEqual(["attempt 6"]);
  });

  it("does nothing on the network coming back with no attempt waiting", () => {
    const { did, wait } = waitOnFakes();
    wait.networkBack();
    expect(did).toEqual([]);
  });

  it("forgets a cleared attempt, parked or counting down", () => {
    const { did, network, pending, wait } = waitOnFakes();
    wait.wait({ attempt: 1, delayMs: 0 });
    wait.clear();
    expect(pending.timer).toBe(undefined);
    network.online = false;
    wait.wait({ attempt: 2, delayMs: 0 });
    pending.timer!.run();
    wait.clear();
    wait.networkBack();
    expect(did).toEqual(["parked"]);
  });

  it("keeps only the latest attempt waiting", () => {
    const { did, pending, wait } = waitOnFakes();
    wait.wait({ attempt: 1, delayMs: 0 });
    wait.wait({ attempt: 2, delayMs: 2_000 });
    expect(pending.timer!.ms).toBe(2_000);
    wait.networkBack();
    wait.networkBack();
    expect(did).toEqual(["attempt 2"]);
  });
});
