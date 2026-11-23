/** The `handover reconcile --json` document turned into the tick's reconcile observation. */
import { describe, expect, it } from "vitest";

import type { ReconcileFacts } from "../../../../supervisor/tickTypes.js";
import { factsOf, redirected, sourcesWith, verbatimOf } from "../tickDraftSourcesFixture.js";

describe("draftTickSources — reconcile", () => {
  it("counts each list and keeps both generated sentences", () => {
    const capture = redirected({
      path: "reconcile.json",
      value: {
        aligned: [1, 2, 3, 4],
        headline: "4 of 40 live session(s) are on the board's top 5.",
        intakeClause: "6 owner turn(s) have no row or card.",
        misaligned: [1],
        rankedCount: 644,
        staleAsks: [1, 2],
        starving: [],
        unregistered: [1, 2, 3],
      },
    });
    const sources = sourcesWith({ capture, kind: "reconcile" });

    expect(sources.reconcile.status).toBe("read");
    expect(factsOf({ observation: sources.reconcile })).toStrictEqual({
      alignedCount: 4,
      headline: "4 of 40 live session(s) are on the board's top 5.",
      intakeClause: "6 owner turn(s) have no row or card.",
      misalignedCount: 1,
      rankedCount: 644,
      staleAskCount: 2,
      starvingCount: 0,
      unregisteredCount: 3,
    });
    expect(verbatimOf({ observation: sources.reconcile })).toBe("4 of 40 live session(s) are on the board's top 5.");
  });

  /** A reconcile document carrying the fields the open-ready count is drawn from. */
  function readyDocument({
    fleet,
    ready,
    aligned = [{ row: { id: "a" }, session: "s1" }],
  }: {
    fleet: "observed" | "unavailable";
    ready: readonly string[];
    aligned?: readonly unknown[];
  }): Record<string, unknown> {
    return {
      aligned,
      fleet,
      headline: "1 of 3 live session(s) are on the board's top 5.",
      intakeClause: "no owner turn is unrowed.",
      misaligned: [{ row: { id: "b" }, session: "s2" }],
      rankedCount: 9,
      ready: ready.map((id) => ({ id, title: id })),
      staleAsks: [],
      starving: [],
      unprioritised: [{ row: { id: "c" }, session: "s3" }],
      unregistered: [],
    };
  }

  /** The reconcile facts drafted from one document. */
  function reconcileFactsOf({ value }: { value: Record<string, unknown> }): ReconcileFacts {
    const sources = sourcesWith({ capture: redirected({ path: "reconcile.json", value }), kind: "reconcile" });
    return factsOf({ observation: sources.reconcile });
  }

  it("counts the ready rows no aligned, misaligned or unprioritised seat is on", () => {
    const facts = reconcileFactsOf({ value: readyDocument({ fleet: "observed", ready: ["a", "b", "c", "d", "e"] }) });

    expect(facts.openReadyCount).toBe(2);
  });

  it("records a zero when every ready row has a seat", () => {
    const facts = reconcileFactsOf({ value: readyDocument({ fleet: "observed", ready: ["a", "c"] }) });

    expect(facts.openReadyCount).toBe(0);
  });

  it("records no count, never a zero, when the fleet was not observed", () => {
    const facts = reconcileFactsOf({ value: readyDocument({ fleet: "unavailable", ready: ["d"] }) });

    expect(Object.keys(facts)).not.toContain("openReadyCount");
    expect(facts.alignedCount).toBe(1);
  });

  it("records no count when one id sits on two ready rows", () => {
    const facts = reconcileFactsOf({ value: readyDocument({ fleet: "observed", ready: ["d", "d", "e"] }) });

    expect(Object.keys(facts)).not.toContain("openReadyCount");
  });

  it("records no count when a placement's row id does not read", () => {
    const facts = reconcileFactsOf({
      value: readyDocument({ aligned: [{ session: "s1" }], fleet: "observed", ready: ["d"] }),
    });

    expect(Object.keys(facts)).not.toContain("openReadyCount");
    expect(facts.alignedCount).toBe(1);
  });
});
