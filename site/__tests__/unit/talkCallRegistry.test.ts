import { describe, expect, it } from "vitest";
import { MeetingLedger } from "../../lib/meetingLedger";
import { TYPED_AT_REST_MS } from "../../lib/talkArbiter";
import { endCallsOnSignal, heldContextFor, liveTypedConversationOf } from "../../lib/talkCallRegistry";
import { TalkNoticeLedger } from "../../lib/talkNoticeLedger";

describe("liveTypedConversationOf", () => {
  const QUIET = { activityMs: 0, nowMs: TYPED_AT_REST_MS, replying: false };

  it("reads the owner's quiet typed conversation as at rest, and one active a millisecond inside the bound as not", () => {
    expect([
      liveTypedConversationOf({ ...QUIET, test: false }),
      liveTypedConversationOf({ ...QUIET, activityMs: 1, test: false }).atRest,
    ]).toEqual([{ atRest: true, replying: false, surface: "typed", test: false }, false]);
  });

  it("never reads a test instance's typed conversation, or one replying, as at rest", () => {
    expect([
      liveTypedConversationOf({ ...QUIET, test: true }).atRest,
      liveTypedConversationOf({ ...QUIET, replying: true, test: false }).atRest,
    ]).toEqual([false, false]);
  });
});

describe("heldContextFor", () => {
  const ownerMeetings = new MeetingLedger();
  const ownerNotices = new TalkNoticeLedger();

  it("hands the owner's call the process's own ledgers", () => {
    const context = heldContextFor({ instance: "owner", ownerMeetings, ownerNotices });
    expect([context.instance, context.meetings === ownerMeetings, context.notices === ownerNotices]).toEqual([
      "owner",
      true,
      true,
    ]);
  });

  it("hands a test call fresh ledgers of its own, so nothing it hears reaches the owner's", () => {
    const first = heldContextFor({ instance: "e2e", ownerMeetings, ownerNotices });
    const second = heldContextFor({ instance: "e2e", ownerMeetings, ownerNotices });
    expect([
      first.instance,
      first.meetings === ownerMeetings,
      first.notices === ownerNotices,
      first.meetings === second.meetings,
    ]).toEqual(["e2e", false, false, false]);
  });
});

/**
 * Two held calls, a journal drain and an exit seam, recording what a signal did to each, in order.
 *
 * @returns the calls, and what was stopped, killed, drained and exited
 */
function held(): {
  held: { stop: (input: { reason: string }) => void; kill: () => void }[];
  stopped: string[];
  exits: number[];
  exit: (status: { code: number }) => void;
  afterDispatch: (then: () => void) => void;
  drain: () => Promise<void>;
  settle: () => Promise<void>;
} {
  const stopped: string[] = [];
  const exits: number[] = [];
  const calls = ["a", "b"].map((name) => ({
    kill: () => {
      stopped.push(`${name}: killed`);
    },
    stop: ({ reason }: { reason: string }) => {
      stopped.push(`${name}: ${reason}`);
    },
  }));
  const queued: (() => void)[] = [];
  const drains: Promise<void>[] = [];
  return {
    afterDispatch: (then) => queued.push(then),
    drain: () => {
      stopped.push("journals drained");
      const drained = Promise.resolve();
      drains.push(drained);
      return drained;
    },
    exit: ({ code }) => {
      stopped.push(`exit ${String(code)}`);
      exits.push(code);
    },
    exits,
    held: calls,
    settle: async () => {
      for (const then of queued.splice(0)) {
        then();
      }
      await Promise.all(drains);
      await Promise.resolve();
    },
    stopped,
  };
}

describe("endCallsOnSignal", () => {
  it("stops every held call on a hang-up, drains the journals, then exits as SIGHUP would", async () => {
    const h = held();
    endCallsOnSignal({
      afterDispatch: h.afterDispatch,
      drain: h.drain,
      exit: h.exit,
      held: h.held,
      othersListening: () => false,
      signal: "SIGHUP",
    });
    await h.settle();
    expect(h.stopped).toEqual([
      "a: the console server received SIGHUP",
      "a: killed",
      "b: the console server received SIGHUP",
      "b: killed",
      "journals drained",
      "exit 129",
    ]);
  });

  it("exits with each ending signal's own status", async () => {
    // Only signals numbered alike on darwin and Linux, so the status is the same wherever this runs.
    const codes = await Promise.all(
      (["SIGQUIT", "SIGABRT", "SIGINT", "SIGTERM"] as const).map(async (signal) => {
        const h = held();
        endCallsOnSignal({
          afterDispatch: h.afterDispatch,
          drain: h.drain,
          exit: h.exit,
          held: h.held,
          othersListening: () => false,
          signal,
        });
        await h.settle();
        return h.exits;
      }),
    );
    expect(codes).toEqual([[131], [134], [130], [143]]);
  });

  it("stops and kills on SIGTERM while Next's own cleanup is listening, still starts the drain, and leaves the exit to Next", async () => {
    const h = held();
    endCallsOnSignal({
      afterDispatch: h.afterDispatch,
      drain: h.drain,
      exit: h.exit,
      held: h.held,
      othersListening: () => true,
      signal: "SIGTERM",
    });
    await h.settle();
    expect([h.stopped, h.exits]).toEqual([
      [
        "a: the console server received SIGTERM",
        "a: killed",
        "b: the console server received SIGTERM",
        "b: killed",
        "journals drained",
      ],
      [],
    ]);
  });

  it("kills every child even when another listener keeps the server alive, and leaves ending it to that one", async () => {
    const h = held();
    endCallsOnSignal({
      afterDispatch: h.afterDispatch,
      drain: h.drain,
      exit: h.exit,
      held: h.held,
      othersListening: () => true,
      signal: "SIGHUP",
    });
    await h.settle();
    expect([h.stopped.filter((line) => line.endsWith("killed")), h.exits]).toEqual([["a: killed", "b: killed"], []]);
  });

  it("kills at once but asks about other listeners only after dispatch, so a one-shot peer this signal spent does not count", async () => {
    const h = held();
    let peers = 1;
    endCallsOnSignal({
      afterDispatch: h.afterDispatch,
      drain: h.drain,
      exit: h.exit,
      held: h.held,
      othersListening: () => peers > 0,
      signal: "SIGHUP",
    });
    const killedBefore = h.stopped.filter((line) => line.endsWith("killed")).length;
    peers = 0;
    await h.settle();
    expect([killedBefore, h.exits]).toEqual([2, [129]]);
  });

  it("exits only once the drain settles, never before", async () => {
    const h = held();
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    endCallsOnSignal({
      afterDispatch: h.afterDispatch,
      drain: () => slow,
      exit: h.exit,
      held: h.held,
      othersListening: () => false,
      signal: "SIGHUP",
    });
    await h.settle();
    const before = [...h.exits];
    release();
    await slow;
    await Promise.resolve();
    expect([before, h.exits]).toEqual([[], [129]]);
  });
});
