import { describe, expect, it } from "vitest";

import {
  afterConnectionEnded,
  type ConnectionStep,
  FRESH_RECONNECT_COUNTERS,
  type ReconnectCounters,
} from "../../../../../cli/commands/listen/connectionStep.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { MULTIPLE_CONNECTIONS_GRACE_MS, socketConnectionPermit } from "../../../../../live/listen/connections.js";
import { createDedupeState } from "../../../../../live/listen/dedupe.js";

/** The refusal Slack's `hello` carrying two connections produces — built by the real permit, never by hand. */
const REFUSAL = unwrapErr(socketConnectionPermit({ allowMultipleConnections: false, connections: 2 }));

/** One ended connection, refused at its `hello` or not, and permitted at it or not. */
function ended({
  helloPermitted,
  reason,
  refused,
}: {
  helloPermitted: boolean;
  reason: string;
  refused: boolean;
}): Extract<ConnectionStep, { kind: "ended" }> {
  return {
    connectionRefusal: refused ? REFUSAL : undefined,
    helloPermitted,
    kind: "ended",
    reason,
    seen: createDedupeState(),
    threadReplies: new Map(),
  };
}

/** Seams that record every log line and every wait, answer `outcome` to each wait, and read a fixed clock. */
function seams({ nowMs, outcome }: { nowMs: number; outcome: "elapsed" | "cancelled" }): {
  readonly deps: Parameters<typeof afterConnectionEnded>[0]["deps"];
  readonly lines: string[];
  readonly waits: number[];
} {
  const lines: string[] = [];
  const waits: number[] = [];
  return {
    deps: {
      log: ({ line }) => {
        lines.push(line);
      },
      nowMs: () => nowMs,
      wait: async ({ ms }) => {
        waits.push(ms);
        return outcome;
      },
    },
    lines,
    waits,
  };
}

describe("afterConnectionEnded", () => {
  it("opens a refusal streak at the first refused hello and retries it at 1s, leaving the failure budget alone", async () => {
    const fixture = seams({ nowMs: 5_000, outcome: "elapsed" });
    const counters: ReconnectCounters = { ...FRESH_RECONNECT_COUNTERS, failures: 3 };

    const after = await afterConnectionEnded({
      counters,
      deps: fixture.deps,
      signal: new AbortController().signal,
      step: ended({ helloPermitted: false, reason: "multiple Socket Mode connections", refused: true }),
    });

    expect(after).toEqual({
      counters: { failures: 3, firstRefusalAtMs: 5_000, refusalBackoffMs: 1_000, refusals: 1 },
      decision: { kind: "continue" },
    });
    expect(fixture.waits).toEqual([1_000]);
  });

  it("stops with an error on a refused hello once the streak has run the whole grace window, without waiting", async () => {
    const fixture = seams({ nowMs: MULTIPLE_CONNECTIONS_GRACE_MS, outcome: "elapsed" });
    const counters: ReconnectCounters = { failures: 0, firstRefusalAtMs: 0, refusalBackoffMs: 91_000, refusals: 8 };

    const after = await afterConnectionEnded({
      counters,
      deps: fixture.deps,
      signal: new AbortController().signal,
      step: ended({ helloPermitted: false, reason: "multiple Socket Mode connections", refused: true }),
    });

    expect(after).toEqual({ counters, decision: { code: EXIT_ERROR, kind: "stop" } });
    expect(fixture.waits).toEqual([]);
    expect(fixture.lines).toEqual([
      "stopping: Slack still reports 2 connections 120000ms after the first refused hello, past the 120000ms " +
        "grace for a socket this listener lost to drain — another listener holds this app. Stop it and retry.",
    ]);
  });

  it("stops on the backoff already waited when the wall clock was moved backward mid-streak", async () => {
    // The counterexample: 121s of backoff behind the streak, and a rollback leaves the wall clock 61s in.
    const fixture = seams({ nowMs: 1_061_000, outcome: "elapsed" });
    const counters: ReconnectCounters = {
      failures: 0,
      firstRefusalAtMs: 1_000_000,
      refusalBackoffMs: 121_000,
      refusals: 8,
    };

    const after = await afterConnectionEnded({
      counters,
      deps: fixture.deps,
      signal: new AbortController().signal,
      step: ended({ helloPermitted: false, reason: "multiple Socket Mode connections", refused: true }),
    });

    expect(after).toEqual({ counters, decision: { code: EXIT_ERROR, kind: "stop" } });
    expect(fixture.waits).toEqual([]);
  });

  it("a permitted hello resets the failure count and closes the refusal streak before the next backoff", async () => {
    const fixture = seams({ nowMs: 0, outcome: "elapsed" });
    const counters: ReconnectCounters = { failures: 7, firstRefusalAtMs: 0, refusalBackoffMs: 15_000, refusals: 4 };

    const after = await afterConnectionEnded({
      counters,
      deps: fixture.deps,
      signal: new AbortController().signal,
      step: ended({ helloPermitted: true, reason: "socket error", refused: false }),
    });

    expect(after).toEqual({
      counters: { failures: 1, firstRefusalAtMs: undefined, refusalBackoffMs: 0, refusals: 0 },
      decision: { kind: "continue" },
    });
    expect(fixture.waits).toEqual([1_000]);
    expect(fixture.lines).toEqual(["reconnecting in 1000ms (socket error)"]);
  });

  it("stops cleanly when the operator's signal cancels a refused hello's backoff", async () => {
    const fixture = seams({ nowMs: 0, outcome: "cancelled" });

    const after = await afterConnectionEnded({
      counters: FRESH_RECONNECT_COUNTERS,
      deps: fixture.deps,
      signal: new AbortController().signal,
      step: ended({ helloPermitted: false, reason: "multiple Socket Mode connections", refused: true }),
    });

    expect(after.decision).toEqual({ code: EXIT_OK, kind: "stop" });
    expect(fixture.waits).toEqual([1_000]);
  });
});
