/**
 * `statusLifecycle` — set, re-assert on a timer, clear. The Slack transport is the shared reacting fake with
 * `setAssistantStatus` replaced by a recorder, and the timer is a manual one passed through the
 * `scheduleReassert` seam, so the wire calls, the schedules and the cancels land in ONE ordered log and a
 * re-assert fires only when a test calls its captured callback.
 */
import { describe, expect, it } from "vitest";

import type { SlackWriteTransport } from "../../../../corpus/slack/writeTransport.js";
import { err, ok } from "../../../../lib/result.js";
import {
  ASSISTANT_STATUS_REASSERT_MS,
  type StatusReassertTimer,
  statusLifecycle,
} from "../../../../live/turn/posterStatus.js";
import type { AssistantStatusArgs, AssistantStatusOutcome } from "../../../../outbound/assistant/status.js";
import type { TurnChrome } from "../../../../outbound/slack/types.js";
import { reactingTransport } from "../../../reactingTransportFake.js";

/** One thing the lifecycle did, in the order it did it. */
type Step =
  | { readonly kind: "wire"; readonly args: AssistantStatusArgs }
  | { readonly kind: "schedule"; readonly id: number; readonly delayMs: number }
  | { readonly kind: "cancel"; readonly id: number };

/** What the fake transport does on one call: answer with an outcome, or throw. */
type Reply = { readonly outcome: AssistantStatusOutcome } | { readonly thrown: unknown };

const CHROME: TurnChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "acme-bot",
  bannerColor: "#7c3aed",
  detailLabel: "*Details*",
  metadataEventType: "slopweaver_turn",
};

/** The exact wire arguments the lifecycle sends for `status` in this file's thread. */
function wire({ status }: { status: string }): Step {
  return {
    args: { channel_id: "C1", icon_emoji: ":robot_face:", status, thread_ts: "1.1", username: "acme-bot" },
    kind: "wire",
  };
}

/** A lifecycle over a recording transport answering `replies` in order (then ok), and a manual timer. */
function harness({ replies = [] }: { replies?: readonly Reply[] } = {}): {
  readonly fire: (input: { readonly id: number }) => void;
  readonly lifecycle: ReturnType<typeof statusLifecycle>;
  readonly steps: Step[];
} {
  const steps: Step[] = [];
  const callbacks: (() => void)[] = [];
  let calls = 0;
  const transport: SlackWriteTransport = {
    ...reactingTransport({ standing: new Map() }),
    setAssistantStatus: async ({ args }) => {
      steps.push({ args, kind: "wire" });
      const reply = replies[calls];
      calls += 1;
      if (reply === undefined) {
        return ok(undefined);
      }
      if ("thrown" in reply) {
        throw reply.thrown;
      }
      return reply.outcome;
    },
  };
  const scheduleReassert: StatusReassertTimer = ({ callback, delayMs }) => {
    const id = callbacks.length;
    callbacks.push(callback);
    steps.push({ delayMs, id, kind: "schedule" });
    return {
      cancel: () => {
        steps.push({ id, kind: "cancel" });
      },
    };
  };
  const lifecycle = statusLifecycle({
    channel: "C1",
    scheduleReassert,
    threadTs: "1.1",
    transport,
    turnChrome: CHROME,
    turnId: "turn-1",
  });
  return { fire: ({ id }) => callbacks[id]!(), lifecycle, steps };
}

describe("ASSISTANT_STATUS_REASSERT_MS", () => {
  it("is 100 seconds, twenty under Slack's two-minute clear", () => {
    expect(ASSISTANT_STATUS_REASSERT_MS).toBe(100_000);
  });
});

describe("statusLifecycle — beginStatus", () => {
  it("sends the exact status arguments, then schedules one re-assert every 100 seconds, and returns ok", async () => {
    const { lifecycle, steps } = harness();

    expect(await lifecycle.beginStatus({ status: "reading the thread" })).toEqual(ok(undefined));
    expect(steps).toEqual([wire({ status: "reading the thread" }), { delayMs: 100_000, id: 0, kind: "schedule" }]);
  });

  it("re-sends the same status once each time the scheduled callback fires", async () => {
    const { fire, lifecycle, steps } = harness();
    await lifecycle.beginStatus({ status: "reading the thread" });

    fire({ id: 0 });

    expect(steps).toEqual([
      wire({ status: "reading the thread" }),
      { delayMs: 100_000, id: 0, kind: "schedule" },
      wire({ status: "reading the thread" }),
    ]);
  });

  it("cancels the previous timer AFTER the new status call and before scheduling its replacement", async () => {
    const { lifecycle, steps } = harness();
    await lifecycle.beginStatus({ status: "reading the thread" });

    await lifecycle.beginStatus({ status: "checking CI" });

    expect(steps).toEqual([
      wire({ status: "reading the thread" }),
      { delayMs: 100_000, id: 0, kind: "schedule" },
      wire({ status: "checking CI" }),
      { id: 0, kind: "cancel" },
      { delayMs: 100_000, id: 1, kind: "schedule" },
    ]);
  });
});

describe("statusLifecycle — stopping and ending", () => {
  it("stopStatusReasserting cancels the timer with no wire call, and a second stop cancels nothing more", async () => {
    const { lifecycle, steps } = harness();
    await lifecycle.beginStatus({ status: "reading the thread" });

    lifecycle.stopStatusReasserting();
    lifecycle.stopStatusReasserting();

    expect(steps).toEqual([
      wire({ status: "reading the thread" }),
      { delayMs: 100_000, id: 0, kind: "schedule" },
      { id: 0, kind: "cancel" },
    ]);
  });

  it("endStatus cancels the running timer and then clears the indicator with an empty status", async () => {
    const { lifecycle, steps } = harness();
    await lifecycle.beginStatus({ status: "reading the thread" });

    expect(await lifecycle.endStatus()).toEqual(ok(undefined));
    expect(steps).toEqual([
      wire({ status: "reading the thread" }),
      { delayMs: 100_000, id: 0, kind: "schedule" },
      { id: 0, kind: "cancel" },
      wire({ status: "" }),
    ]);
  });

  it("endStatus with no status ever begun cancels nothing and still sends the empty status", async () => {
    const { lifecycle, steps } = harness();

    expect(await lifecycle.endStatus()).toEqual(ok(undefined));
    expect(steps).toEqual([wire({ status: "" })]);
  });
});

describe("statusLifecycle — failures resolve, never reject", () => {
  it("returns a Slack refusal's reason as an Err and still schedules the re-assert", async () => {
    const refusal: AssistantStatusOutcome = err({
      error: "missing_scope",
      neededScope: "assistant:write",
      reason: "missing_scope (needs assistant:write)",
    });
    const { lifecycle, steps } = harness({ replies: [{ outcome: refusal }] });

    expect(await lifecycle.beginStatus({ status: "reading the thread" })).toEqual(
      err("missing_scope (needs assistant:write)"),
    );
    expect(steps).toEqual([wire({ status: "reading the thread" }), { delayMs: 100_000, id: 0, kind: "schedule" }]);
  });

  it("returns a thrown Error's message as an Err rather than rejecting", async () => {
    const { lifecycle } = harness({ replies: [{ thrown: new Error("read ECONNRESET") }] });

    expect(await lifecycle.beginStatus({ status: "reading the thread" })).toEqual(err("read ECONNRESET"));
  });

  it("returns a thrown non-Error value as its string form", async () => {
    const { lifecycle } = harness({ replies: [{ thrown: "socket hang up" }] });

    expect(await lifecycle.endStatus()).toEqual(err("socket hang up"));
  });

  it("a re-assert whose transport throws neither rejects nor cancels the timer", async () => {
    const { fire, lifecycle, steps } = harness({
      replies: [{ outcome: ok(undefined) }, { thrown: new Error("read ECONNRESET") }],
    });
    await lifecycle.beginStatus({ status: "reading the thread" });

    fire({ id: 0 });
    await Promise.resolve();

    expect(steps).toEqual([
      wire({ status: "reading the thread" }),
      { delayMs: 100_000, id: 0, kind: "schedule" },
      wire({ status: "reading the thread" }),
    ]);
  });
});
