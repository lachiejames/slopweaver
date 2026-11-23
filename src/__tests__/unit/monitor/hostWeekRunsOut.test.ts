/**
 * `host-week-runs-out`'s reading: one folded card for every at-risk model host, its key held across drift and
 * re-cut on a changed plan set, a gap beside a spell as its blind spot, and every other gap unmeasurable.
 */
import { describe, expect, it } from "vitest";

import type { HostDrySpell, HostWeekProjection } from "../../../capacity/weekRisk.js";
import { checkedHandDecision } from "../../../hand/decisionContext.js";
import { drySpellKeyLapsesAt, drySpellKeyRevision } from "../../../monitor/fleetRunsDry.js";
import {
  hostWeekRunsOutReading,
  PLAN_WEEK_HOLDING,
  PLAN_WEEK_OPENING,
  planWeekKey,
} from "../../../monitor/hostWeekRunsOut.js";
import { HOST_WEEK_RUNS_OUT } from "../../../monitor/hostWeekRunsOutDefinition.js";

/** A Codex spell from 18h to 30h past the fixture's base instant, over two plans. */
function codexSpell(over: Partial<HostDrySpell> = {}): HostDrySpell {
  return {
    basis: "Codex, projected at 90% of the trailing draw",
    endIso: "2026-11-09T18:00:00.000Z",
    endedById: "codex:codex-one",
    host: "codex",
    hours: 12,
    identity: ["codex:codex-one@99", "codex:codex-two@99"],
    planLines: ["codex-one: 90% of its week", "codex-two: 90% of its week"],
    startIso: "2026-11-09T06:00:00.000Z",
    ...over,
  };
}

const CLEAR: HostWeekProjection = { kind: "clear", why: "no spell" };

describe("hostWeekRunsOutReading", () => {
  it("opens below the trailing rate and holds at it, never the other way round", () => {
    expect([PLAN_WEEK_OPENING, PLAN_WEEK_HOLDING]).toEqual([
      { demandShare: 0.9, minDryHours: 4 },
      { demandShare: 1, minDryHours: 1 },
    ]);
  });

  it("is clear when both model hosts are clear, and unmeasurable naming each gap when neither is at risk", () => {
    expect(hostWeekRunsOutReading({ projections: { claude: CLEAR, codex: CLEAR } })).toEqual({
      monitorId: "host-week-runs-out",
      state: "clear",
    });
    expect(
      hostWeekRunsOutReading({
        projections: { claude: { kind: "unmeasurable", why: "journal stale" }, codex: CLEAR },
      }),
    ).toEqual({
      because: "Claude not projected: journal stale",
      monitorId: "host-week-runs-out",
      state: "unmeasurable",
    });
  });

  it("fires one folded card carrying the basis and every plan, with the other model host's gap as its blind spot", () => {
    const reading = hostWeekRunsOutReading({
      projections: {
        claude: { kind: "unmeasurable", why: "journal stale" },
        codex: { kind: "at-risk", spell: codexSpell() },
      },
    });
    expect(reading).toEqual({
      blindSpot: "Claude not projected: journal stale",
      monitorId: "host-week-runs-out",
      state: "firing",
      subjects: [
        {
          decision: expect.objectContaining({
            problem:
              "The Codex plans are projected to run out for about 12h from 2026-11-09T06:00Z, before codex:codex-one's reset at 2026-11-09T18:00Z.",
          }),
          details: [
            "Codex, projected at 90% of the trailing draw",
            "codex-one: 90% of its week",
            "codex-two: 90% of its week",
          ],
          id: "the Codex plans' week",
          key: planWeekKey({ spells: [codexSpell()] }),
          label: "Codex projected to run out for about 12h before a reset",
        },
      ],
    });
  });

  it("asks a decision the card validator accepts, offering no purchase and no console click", () => {
    const reading = hostWeekRunsOutReading({
      projections: { claude: CLEAR, codex: { kind: "at-risk", spell: codexSpell() } },
    });
    expect(reading.state).toBe("firing");
    const decision = (reading as Extract<typeof reading, { state: "firing" }>).subjects[0]!.decision!;
    expect(checkedHandDecision({ value: decision }).isOk()).toBe(true);
    expect(decision.options.map((option) => option.option)).toEqual([
      "Keep today's pace and accept the gap",
      "Defer the least urgent work until the reset",
    ]);
    expect(decision.lean).toBe(
      "Keep the pace: this already fills every routable Codex plan and claims each free reset the chair may, so deferring leaves usage unspent if the trend is wrong.",
    );
  });

  it("carries a clear projection's maths as evidence, never a card", () => {
    const lines = ["Codex, projected at 90% of the trailing draw", "codex-one: 48% used of a 99% ceiling"];
    expect(
      hostWeekRunsOutReading({ projections: { claude: CLEAR, codex: { kind: "clear", lines, why: "no spell" } } }),
    ).toEqual({ evidence: lines, monitorId: "host-week-runs-out", state: "clear" });
  });

  it("keys on the earliest spell end and a digest of the plans, so drift holds the card and a changed set re-cuts it", () => {
    const key = planWeekKey({ spells: [codexSpell()] });
    const drifted = planWeekKey({ spells: [codexSpell({ endIso: "2026-11-09T21:30:00.000Z", hours: 15 })] });
    const changed = planWeekKey({ spells: [codexSpell({ identity: ["codex:codex-one@99"] })] });
    expect(drySpellKeyLapsesAt({ key })).toBe("2026-11-09T18:00:00.000Z");
    expect(drySpellKeyRevision({ key: drifted })).toBe(drySpellKeyRevision({ key }));
    expect(drySpellKeyRevision({ key: changed })).not.toBe(drySpellKeyRevision({ key }));
    expect(HOST_WEEK_RUNS_OUT.holdRevision!({ key })).toBe(drySpellKeyRevision({ key }));
  });

  it("reads unmeasurable rather than post a card that cannot carry every plan whole", () => {
    const crowded = codexSpell({ planLines: Array.from({ length: 12 }, (_, index) => `plan-${String(index)}`) });
    expect(
      hostWeekRunsOutReading({ projections: { claude: CLEAR, codex: { kind: "at-risk", spell: crowded } } }).state,
    ).toBe("unmeasurable");
  });
});
