/**
 * The load-dispatch gate — `supervisor tick-record` refusing a tick that SAW the machine holding and neither
 * found an investigation open nor said why it was leaving one unopened.
 *
 * The three-conjunct predicate is the thing under test, and the third conjunct is what stops the gate wedging
 * the supervisor: `machine watch` is bounded and foreground by doctrine rule 2, so a real hold no watcher
 * happened to observe must still be answerable in band, by narrating it.
 */
import { describe, expect, it } from "vitest";

import { judgeLoadDispatch } from "../../../supervisor/loadDispatchGate.js";

/** The facts a capacity observation carries, with only what a case varies overridden. */
function facts(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dispatchBackoffSeconds: 0,
    dispatchCovering: 0,
    dispatchOpen: 0,
    dispatchSubject: "",
    hold: true,
    holdSubjects: ["cpu"],
    load1: 45.9,
    segmentsPct: 15,
    swapfileCount: 5,
    topForeignGb: 5.2,
    topForeignLabel: "mds",
    ...over,
  };
}

/** A draft's sources, carrying one capacity observation. */
function sourcesWith(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { capacity: { facts: facts(), status: "read", ...over } };
}

/** The judgement that answers for a hold by narrating it. */
const MACHINE_RATIONALE = { kind: "hold-rationale", subject: { kind: "machine", label: "the machine" } };

describe("judgeLoadDispatch", () => {
  it("refuses a tick that read a hold, opened no dispatch and gave no reason", () => {
    const verdict = judgeLoadDispatch({ judgements: [], sources: sourcesWith() });

    expect(verdict.kind).toBe("refused");
    expect(verdict).toStrictEqual({ holdSubjects: ["cpu"], kind: "refused", load1: 45.9 });
  });

  it("passes a tick whose machine was not holding", () => {
    const sources = { capacity: { facts: facts({ hold: false, holdSubjects: [] }), status: "read" } };

    expect(judgeLoadDispatch({ judgements: [], sources })).toStrictEqual({ kind: "clean" });
  });

  it("passes a tick whose only hold was recent boots — a burst clears itself, and an investigation is a boot", () => {
    const sources = { capacity: { facts: facts({ holdSubjects: ["boots"], load1: 4 }), status: "read" } };

    expect(judgeLoadDispatch({ judgements: [], sources })).toStrictEqual({ kind: "clean" });
  });

  it("passes a tick whose only hold was the disk floor — worktree prune clears it, never an investigation", () => {
    const sources = { capacity: { facts: facts({ holdSubjects: ["disk"], load1: 4 }), status: "read" } };

    expect(judgeLoadDispatch({ judgements: [], sources })).toStrictEqual({ kind: "clean" });
  });

  it("still refuses a cpu hold that recent boots ALSO held on", () => {
    const sources = { capacity: { facts: facts({ holdSubjects: ["cpu", "boots"] }), status: "read" } };

    expect(judgeLoadDispatch({ judgements: [], sources })).toStrictEqual({
      holdSubjects: ["cpu", "boots"],
      kind: "refused",
      load1: 45.9,
    });
  });

  it("passes a tick that read a hold with an investigation already SEATED on it", () => {
    const seated = facts({ dispatchCovering: 1, dispatchOpen: 1, dispatchSubject: "bfs" });
    const sources = { capacity: { facts: seated, status: "read" } };

    expect(judgeLoadDispatch({ judgements: [], sources })).toStrictEqual({ kind: "clean" });
  });

  it("still refuses a hold whose only open row SEATED NOBODY — a failed spawn is not coverage", () => {
    // Review pass r2 `gate-cannot-be-satisfied-by-assertion`: a `cmux spawn` that failed, and a seat the
    // backoff suppressed, both write an open row carrying `seated: { kind: "none" }`. Counting one as an
    // answer made the case where the fleet TRIED and could not the case where the gate stopped asking.
    const unmanned = facts({ dispatchCovering: 0, dispatchOpen: 1, dispatchSubject: "bfs" });
    const sources = { capacity: { facts: unmanned, status: "read" } };

    expect(judgeLoadDispatch({ judgements: [], sources })).toStrictEqual({
      holdSubjects: ["cpu"],
      kind: "refused",
      load1: 45.9,
    });
  });

  it("passes a tick that narrated the hold instead — the way out that keeps the supervisor unwedged", () => {
    const verdict = judgeLoadDispatch({ judgements: [MACHINE_RATIONALE], sources: sourcesWith() });

    expect(verdict).toStrictEqual({ kind: "clean" });
  });

  it("still refuses when the only hold rationale is about something other than the machine", () => {
    const judgements = [{ kind: "hold-rationale", subject: { kind: "plan", label: "a plan" } }];

    expect(judgeLoadDispatch({ judgements, sources: sourcesWith() }).kind).toBe("refused");
  });

  it("still refuses when a machine judgement is recorded under a different kind", () => {
    const judgements = [{ kind: "capacity-note", subject: { kind: "machine", label: "the machine" } }];

    expect(judgeLoadDispatch({ judgements, sources: sourcesWith() }).kind).toBe("refused");
  });

  it("judges a partial capacity observation exactly as it judges a read one", () => {
    const sources = { capacity: { facts: facts(), status: "partial" } };

    expect(judgeLoadDispatch({ judgements: [], sources }).kind).toBe("refused");
  });

  it("reports unreadable — never clean — when the tick took no capacity reading at all", () => {
    const verdict = judgeLoadDispatch({ judgements: [], sources: { capacity: { status: "unavailable" } } });

    expect(verdict).toStrictEqual({
      kind: "unreadable",
      why: 'the draft\'s capacity observation is "unavailable", so this tick never read whether the machine was holding',
    });
  });

  it("reports unreadable when the draft carries no capacity observation", () => {
    const verdict = judgeLoadDispatch({ judgements: [], sources: {} });

    expect(verdict).toStrictEqual({ kind: "unreadable", why: "the draft carries no capacity observation at all" });
  });

  it("reports unreadable when the observation carries no hold reading", () => {
    const sources = { capacity: { facts: { load1: 45.9 }, status: "read" } };

    expect(judgeLoadDispatch({ judgements: [], sources })).toStrictEqual({
      kind: "unreadable",
      why: "the draft's capacity observation carries no `hold` reading",
    });
  });

  it("names the re-capture command when the reading predates the dispatch register", () => {
    const { dispatchCovering: _dropped, ...older } = facts();
    const sources = { capacity: { facts: older, status: "read" } };
    const verdict = judgeLoadDispatch({ judgements: [], sources });

    expect(verdict.kind).toBe("unreadable");
    expect(verdict).toStrictEqual({
      kind: "unreadable",
      why:
        "the draft's capacity observation carries no `dispatchCovering` count — re-capture it with " +
        "`slopweaver machine capacity --json`, which reads the dispatch register itself",
    });
  });

  it("reports a refusal with no load reading as zero rather than refusing to judge", () => {
    const { load1: _dropped, ...noLoad } = facts();
    const sources = { capacity: { facts: noLoad, status: "read" } };

    expect(judgeLoadDispatch({ judgements: [], sources })).toStrictEqual({
      holdSubjects: ["cpu"],
      kind: "refused",
      load1: 0,
    });
  });
});
