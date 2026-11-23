import { describe, expect, it } from "vitest";

import { blockerFor, type DocProbeState, type HandoverDoc } from "../../../../handover/doc.js";
import type { ProbeResult } from "../../../../handover/probe.js";
import { doc } from "./harness.js";

describe("blockerFor", () => {
  it("is undefined for a ready doc with no dependencies", () => {
    const ready = doc({ slug: "a" });

    expect(blockerFor({ all: [ready], doc: ready })).toBeUndefined();
  });

  it("waits while a dependency is not done", () => {
    const first = doc({ slug: "first", status: "ready" });
    const second = doc({ blockedBy: ["first"], slug: "second" });

    expect(blockerFor({ all: [first, second], doc: second })).toEqual({ kind: "waiting", on: ["first"] });
  });

  it("clears once an ask dependency is settled filed or answered — its status stays ready by design", () => {
    const filed = {
      ...doc({ slug: "filed-ask" }),
      kind: "ask" as const,
      settlement: "filed" as const,
      settlementWitness: "some-doc",
    };
    const answered = {
      ...doc({ slug: "answered-ask" }),
      kind: "ask" as const,
      settlement: "answered" as const,
      settlementWitness: "pr",
    };
    const second = doc({ blockedBy: ["filed-ask", "answered-ask"], slug: "second" });

    expect(blockerFor({ all: [filed, answered, second], doc: second })).toBeUndefined();
  });

  it("still waits on an ask settled declined — a declined ask is terminal-not-shipped", () => {
    const declined = {
      ...doc({ slug: "declined-ask" }),
      kind: "ask" as const,
      settlement: "declined" as const,
      settlementWitness: "anchor",
    };
    const second = doc({ blockedBy: ["declined-ask"], slug: "second" });

    expect(blockerFor({ all: [declined, second], doc: second })).toEqual({ kind: "waiting", on: ["declined-ask"] });
  });

  it("clears once the dependency is done", () => {
    const first = doc({ slug: "first", status: "done" });
    const second = doc({ blockedBy: ["first"], slug: "second" });

    expect(blockerFor({ all: [first, second], doc: second })).toBeUndefined();
  });

  /**
   * A typo'd slug must not read as satisfied. Treating an unknown dependency as met would let a
   * mistyped name mark work runnable — the exact failure this board exists to prevent, one level down.
   */
  it("names a dependency that does not exist, separately from one that is merely pending", () => {
    const only = doc({ blockedBy: ["ghost"], slug: "only" });

    expect(blockerFor({ all: [only], doc: only })).toEqual({ kind: "missing-dependency", on: ["ghost"] });
  });

  it("reports a done doc as done rather than runnable", () => {
    const finished = doc({ slug: "a", status: "done" });

    expect(blockerFor({ all: [finished], doc: finished })).toEqual({ kind: "already-done" });
  });

  it("holds a draft back", () => {
    const draft = doc({ slug: "a", status: "draft" });

    expect(blockerFor({ all: [draft], doc: draft })).toEqual({ kind: "still-draft" });
  });

  /**
   * `blocked` is not a status — blocking is derived from `blockedBy` — so a doc declaring it lands here.
   * Falling through to "runnable" would let a typo start work. Found by dogfooding: the first three real
   * docs written for this feature all said `status: blocked`.
   */
  it("refuses to run a doc whose status it does not recognise", () => {
    const odd = doc({ slug: "a", status: "unknown" });

    expect(blockerFor({ all: [odd], doc: odd })).toEqual({ kind: "undeclared-status" });
  });
});

describe("blockerFor — a doc whose probes all pass", () => {
  const PASS: ProbeResult = { note: "exists", outcome: "pass", probe: { file: "a.ts", kind: "present", symbol: "x" } };
  const LANDED: DocProbeState = { commitsAhead: 0, computed: "landed", results: [PASS] };

  it("reports `probes-pass`, the LOOK SHIPPED blocker, when no reason was stated", () => {
    const shipped: HandoverDoc = { ...doc({ slug: "a" }), doneWhen: [PASS.probe] };

    expect(blockerFor({ all: [shipped], doc: shipped, state: LANDED })).toEqual({ count: 1, kind: "probes-pass" });
  });

  /**
   * A stated `notDoneReason` means the probes are a deliberately narrower slice than the doc's real scope, so
   * the doc stays exactly as runnable as its declared `status:` says — the same outcome as a doc with no
   * probes at all, never `probes-pass`.
   */
  it("falls through to the declared status instead, when the doc explained the gap", () => {
    const narrower: HandoverDoc = {
      ...doc({ slug: "a" }),
      doneWhen: [PASS.probe],
      notDoneReason: "Slice 1 only — the real finish line is a later slice",
    };

    expect(blockerFor({ all: [narrower], doc: narrower, state: LANDED })).toBeUndefined();
  });

  it("still honours a real dependency once the reason has been stated", () => {
    const first = doc({ slug: "first", status: "ready" });
    const narrower: HandoverDoc = {
      ...doc({ blockedBy: ["first"], slug: "second" }),
      doneWhen: [PASS.probe],
      notDoneReason: "Slice 1 only",
    };

    expect(blockerFor({ all: [first, narrower], doc: narrower, state: LANDED })).toEqual({
      kind: "waiting",
      on: ["first"],
    });
  });
});

describe("blockerFor — a doc with an unevaluated probe", () => {
  const SKIPPED: ProbeResult = {
    note: "command probe not evaluated — pass --probe to run it",
    outcome: "not-evaluated",
    probe: { command: "yarn test", kind: "command" },
  };
  const PASS: ProbeResult = { note: "exists", outcome: "pass", probe: { file: "a.ts", kind: "present", symbol: "x" } };
  const UNEVALUATED: DocProbeState = { commitsAhead: 0, computed: "unevaluated", results: [PASS, SKIPPED] };

  /**
   * A doc with one passing probe and one declined `command:` probe must never be reported as blocked from
   * starting — nothing has actually failed, only gone unchecked. Reusing `partial`'s blocker kind here would
   * misdescribe a doc where `failed` is really zero, which is why `unevaluated` gets its own kind instead.
   */
  it("reports `unevaluated`, not `partial` and not a stop-start blocker", () => {
    const readyDoc: HandoverDoc = { ...doc({ slug: "a" }), doneWhen: [PASS.probe, SKIPPED.probe] };

    expect(blockerFor({ all: [readyDoc], doc: readyDoc, state: UNEVALUATED })).toEqual({
      kind: "unevaluated",
      passed: 1,
      skipped: 1,
    });
  });
});
