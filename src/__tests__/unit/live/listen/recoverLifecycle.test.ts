/**
 * `lifecycleExclusions` — the five exclusions the ask-lifecycle log decides for one recovery candidate.
 * `first-answered` is the witness this branch added: the plan is posted and the same worker is still building
 * it, so a window scan must treat it as in flight rather than re-capture it.
 */
import { describe, expect, it } from "vitest";

import type { AskLifecycle, AskLifecycleEvent, TerminalAskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import { lifecycleExclusions } from "../../../../live/listen/recoverLifecycle.js";

const ASK = { channel: "C0SYN000010", messageTs: "1790924298.202269", threadTs: "1790924298.202269" };
const SINCE = "2026-10-02T06:58:20.000Z";

const CAPTURED_EVENT: AskLifecycleEvent = {
  ...ASK,
  kind: "captured",
  surface: "channel",
  tsIso: SINCE,
  userId: "U0AAA",
};

/** One folded entry in the given state, with whatever kind-specific extras the case needs. */
function lifecycleIn({
  state,
  extra = {},
}: {
  state: AskLifecycle["state"];
  extra?: Partial<AskLifecycle>;
}): AskLifecycle {
  return {
    ...ASK,
    capturedIso: SINCE,
    lastEvent: CAPTURED_EVENT,
    state,
    surface: "channel",
    userId: "U0AAA",
    ...extra,
  };
}

const REDISPATCHED: AskLifecycle["redispatched"] = {
  ...ASK,
  kind: "redispatched",
  reason: "picked up once",
  strandedAs: "failed",
  tsIso: SINCE,
};

describe("lifecycleExclusions — no log row", () => {
  it("excludes nothing when the log carries neither a fold nor a terminal event", () => {
    expect(lifecycleExclusions({ lifecycle: undefined, strandedLane: false, terminal: undefined })).toEqual({
      exclusions: [],
      why: [],
    });
  });
});

describe("lifecycleExclusions — in flight", () => {
  it.each(["captured", "checklist-posted", "dispatched", "dispatch-unwitnessed", "dispatch-witnessed"] as const)(
    "excludes an ask in %s as in-flight",
    (state) => {
      const result = lifecycleExclusions({
        lifecycle: lifecycleIn({ state }),
        strandedLane: false,
        terminal: undefined,
      });

      expect(result.exclusions).toEqual(["in-flight"]);
      expect(result.why[0]).toContain(`(${state})`);
    },
  );

  it("excludes a first-answered ask as in-flight — the plan stands and the same worker is still building it", () => {
    const result = lifecycleExclusions({
      lifecycle: lifecycleIn({ state: "first-answered" }),
      strandedLane: false,
      terminal: undefined,
    });

    expect(result.exclusions).toEqual(["in-flight"]);
    expect(result.why[0]).toContain("(first-answered)");
  });

  it("keeps a first-answered ask excluded on the stranded lane too — it is never stranded", () => {
    const result = lifecycleExclusions({
      lifecycle: lifecycleIn({ state: "first-answered" }),
      strandedLane: true,
      terminal: undefined,
    });

    expect(result.exclusions).toEqual(["in-flight"]);
  });
});

describe("lifecycleExclusions — resolved and terminal", () => {
  it("excludes a triaged-no-response ask as already-resolved", () => {
    const result = lifecycleExclusions({
      lifecycle: lifecycleIn({ state: "triaged-no-response" }),
      strandedLane: false,
      terminal: undefined,
    });

    expect(result.exclusions).toEqual(["already-resolved"]);
    expect(result.why[0]).toContain("(triaged-no-response)");
  });

  it("excludes on a terminal event even with no fold, naming the terminal kind", () => {
    const terminal: TerminalAskLifecycleEvent = {
      ...ASK,
      answerTs: "1790926498.645000",
      kind: "answered",
      tsIso: SINCE,
    };

    const result = lifecycleExclusions({ lifecycle: undefined, strandedLane: false, terminal });

    expect(result.exclusions).toEqual(["terminal-lifecycle"]);
    expect(result.why[0]).toContain('terminal "answered" event');
  });
});

describe("lifecycleExclusions — worked and ended without an answer", () => {
  it.each(["failed", "answer-lost", "dispatch-failed", "lease-expired", "redispatched"] as const)(
    "excludes %s as already-worked on an ordinary scan",
    (state) => {
      const result = lifecycleExclusions({
        lifecycle: lifecycleIn({ state }),
        strandedLane: false,
        terminal: undefined,
      });

      expect(result.exclusions).toEqual(["already-worked"]);
    },
  );

  it("exempts a stranded ask whose one re-dispatch is unspent, but only for the stranded lane", () => {
    const lifecycle = lifecycleIn({ state: "lease-expired" });

    expect(lifecycleExclusions({ lifecycle, strandedLane: true, terminal: undefined }).exclusions).toEqual([]);
    expect(lifecycleExclusions({ lifecycle, strandedLane: false, terminal: undefined }).exclusions).toEqual([
      "already-worked",
    ]);
  });

  it("keeps a stranded ask excluded once its re-dispatch is spent", () => {
    const lifecycle = lifecycleIn({ extra: { redispatched: REDISPATCHED }, state: "failed" });

    expect(lifecycleExclusions({ lifecycle, strandedLane: true, terminal: undefined }).exclusions).toEqual([
      "already-worked",
    ]);
  });

  it("never exempts answer-lost, which is not a stranded state", () => {
    const lifecycle = lifecycleIn({ state: "answer-lost" });

    expect(lifecycleExclusions({ lifecycle, strandedLane: true, terminal: undefined }).exclusions).toEqual([
      "already-worked",
    ]);
  });
});

describe("lifecycleExclusions — blocked on a human", () => {
  it("excludes an ask waiting on the owner, quoting what it waits on", () => {
    const lifecycle = lifecycleIn({
      extra: {
        blockedOnHuman: {
          ...ASK,
          kind: "blocked-on-human",
          need: "sign-in",
          stepText: "sign in",
          tsIso: SINCE,
          what: "Datadog",
        },
      },
      state: "blocked-on-human",
    });

    const result = lifecycleExclusions({ lifecycle, strandedLane: false, terminal: undefined });

    expect(result.exclusions).toEqual(["blocked-on-human"]);
    expect(result.why[0]).toContain('("Datadog")');
  });

  it("excludes an unblocked ask no session has re-dispatched yet", () => {
    const result = lifecycleExclusions({
      lifecycle: lifecycleIn({ state: "unblocked" }),
      strandedLane: false,
      terminal: undefined,
    });

    expect(result.exclusions).toEqual(["blocked-on-human"]);
    expect(result.why[0]).toContain("turn dispatch");
  });

  it("reports several exclusions in test order, one sentence each", () => {
    const terminal: TerminalAskLifecycleEvent = {
      ...ASK,
      answerTs: "1790926498.645000",
      kind: "answered",
      tsIso: SINCE,
    };

    const result = lifecycleExclusions({
      lifecycle: lifecycleIn({ state: "captured" }),
      strandedLane: false,
      terminal,
    });

    expect(result.exclusions).toEqual(["terminal-lifecycle", "in-flight"]);
    expect(result.why).toHaveLength(2);
  });
});
