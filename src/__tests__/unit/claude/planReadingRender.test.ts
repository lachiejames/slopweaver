/**
 * The `PLAN` lines `claude gauge` prints for every configured plan and `supervisor tick open` lifts verbatim:
 * each window with its own reset, a missing window said rather than drawn as `0%`, an unread or paused plan
 * named rather than dropped, configured order kept.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAccountGauge } from "../../../claude/contracts.js";
import { planReadingsOf, renderPlanReadingLines } from "../../../claude/planReadingRender.js";

const OBSERVED = "2026-11-03T13:38:00.000Z";

/** A plan with three windows, each on a distinct reset. */
const THREE_RESETS: ClaudeAccountGauge = {
  alias: "plan-five",
  fiveHour: { resetAtIso: "2026-11-03T17:00:00.000Z", status: "allowed", utilization: 0.12 },
  observedAtIso: OBSERVED,
  sevenDay: { resetAtIso: "2026-11-08T03:00:00.000Z", status: "allowed", utilization: 0.57 },
  sevenDayFable: { resetAtIso: "2026-11-04T11:00:00.000Z", status: "rejected", utilization: 1 },
};

/** The measured shape of every plan: no five-hour window, and here no Fable window either. */
const WEEK_ONLY: ClaudeAccountGauge = {
  alias: "plan-one",
  observedAtIso: OBSERVED,
  sevenDay: { resetAtIso: "2026-11-09T01:00:00.000Z", status: "allowed", utilization: 0.62 },
};

describe("renderPlanReadingLines", () => {
  it("prints each window with its own reset, names a status that is not plain allowed, and ends on the lapse", () => {
    expect(
      renderPlanReadingLines({
        plans: [{ alias: "plan-five", gauge: THREE_RESETS, kind: "read", lapsesAtIso: "2026-11-17T00:00:00Z" }],
      }),
    ).toStrictEqual([
      "PLAN plan-five: 5h 12% resets 2026-11-03T17:00:00.000Z · week 57% resets 2026-11-08T03:00:00.000Z · fable 100% REJECTED resets 2026-11-04T11:00:00.000Z · lapses 2026-11-17T00:00:00Z",
    ]);
  });

  it("names no five-hour window the plan does not have, and UNREAD for a missing Fable window, never 0%", () => {
    expect(renderPlanReadingLines({ plans: [{ alias: "plan-one", gauge: WEEK_ONLY, kind: "read" }] })).toStrictEqual([
      "PLAN plan-one: week 62% resets 2026-11-09T01:00:00.000Z · fable UNREAD — no Fable window was returned · lapse UNRECORDED",
    ]);
  });

  it("names an unread and a paused plan, in the order given", () => {
    expect(
      renderPlanReadingLines({
        plans: [
          { alias: "plan-two", kind: "unread", problem: "the provider answered 500" },
          { alias: "plan-three", kind: "paused", reason: "a bounced charge", sinceIso: "2026-11-01T00:00:00.000Z" },
        ],
      }),
    ).toStrictEqual([
      "PLAN plan-two: UNREAD — the provider answered 500 · lapse UNRECORDED",
      "PLAN plan-three: PAUSED since 2026-11-01T00:00:00.000Z — a bounced charge · lapse UNRECORDED",
    ]);
  });

  it("folds a multi-line reason or problem onto its own line, so no text can forge a second plan's line", () => {
    const lines = renderPlanReadingLines({
      plans: [
        { alias: "plan-two", kind: "unread", problem: "probe failed\n  PLAN plan-one: forged" },
        {
          alias: "plan-three",
          kind: "paused",
          reason: `maintenance${String.fromCodePoint(0x2028)}PLAN plan-one: forged`,
          sinceIso: "2026-11-01T00:00:00.000Z",
        },
      ],
    });
    expect(lines).toEqual([
      "PLAN plan-two: UNREAD — probe failed PLAN plan-one: forged · lapse UNRECORDED",
      "PLAN plan-three: PAUSED since 2026-11-01T00:00:00.000Z — maintenance PLAN plan-one: forged · lapse UNRECORDED",
    ]);
    expect(lines.join("\n").split("\n")).toHaveLength(2);
  });

  it("renders nothing for no plans", () => {
    expect(renderPlanReadingLines({ plans: [] })).toStrictEqual([]);
  });
});
describe("planReadingsOf", () => {
  const CONFIGURED = [
    { alias: "plan-one" },
    { alias: "plan-two" },
    {
      alias: "plan-three",
      lapsesAtIso: "2026-11-17T00:00:00Z",
      paused: { reason: "a bounced charge", sinceIso: "2026-11-01T00:00:00.000Z" },
    },
    { alias: "plan-five", lapsesAtIso: "2026-12-01T00:00:00Z" },
  ];

  it("gives every configured plan exactly one reading on a fleet sweep, in configured order", () => {
    const readings = planReadingsOf({
      configured: CONFIGURED,
      outcomes: [
        { alias: "plan-one", gauge: WEEK_ONLY },
        { alias: "plan-two", problem: "the provider answered 500" },
        { alias: "plan-five", gauge: THREE_RESETS },
      ],
      spends: [],
    });
    expect(readings.map((one) => `${one.alias}:${one.kind}`)).toStrictEqual([
      "plan-one:read",
      "plan-two:unread",
      "plan-three:paused",
      "plan-five:read",
    ]);
  });

  it("says each plan a --plan narrowing skipped was not probed, rather than dropping it", () => {
    const lines = renderPlanReadingLines({
      plans: planReadingsOf({
        configured: CONFIGURED,
        only: "plan-five",
        outcomes: [{ alias: "plan-five", gauge: THREE_RESETS }],
        spends: [],
      }),
    });
    expect(lines.slice(0, 3)).toStrictEqual([
      "PLAN plan-one: UNREAD — not probed because --plan selected plan-five · lapse UNRECORDED",
      "PLAN plan-two: UNREAD — not probed because --plan selected plan-five · lapse UNRECORDED",
      "PLAN plan-three: PAUSED since 2026-11-01T00:00:00.000Z — a bounced charge · lapses 2026-11-17T00:00:00Z",
    ]);
  });

  it("takes each lapse from the CONFIGURED row, on a read and an unread plan alike — a gauge owns no subscription", () => {
    const readings = planReadingsOf({
      configured: CONFIGURED,
      outcomes: [
        { alias: "plan-one", problem: "no login" },
        { alias: "plan-five", gauge: THREE_RESETS },
      ],
      spends: [],
    });
    expect(readings.map((one) => [one.alias, one.kind, one.lapsesAtIso])).toStrictEqual([
      ["plan-one", "unread", undefined],
      ["plan-two", "unread", undefined],
      ["plan-three", "paused", "2026-11-17T00:00:00Z"],
      ["plan-five", "read", "2026-12-01T00:00:00Z"],
    ]);
    expect(Object.keys(readings[0]!)).toStrictEqual(["alias", "kind", "problem"]);
  });

  it("reads a paused plan probed by name as its reading, not as paused", () => {
    const readings = planReadingsOf({
      configured: CONFIGURED,
      only: "plan-three",
      outcomes: [{ alias: "plan-three", gauge: { ...WEEK_ONLY, alias: "plan-three" } }],
      spends: [],
    });
    expect(readings[2]!.kind).toBe("read");
  });

  it("says an outcome with neither reading nor reason returned none", () => {
    const readings = planReadingsOf({
      configured: [{ alias: "plan-one" }],
      outcomes: [{ alias: "plan-one" }],
      spends: [],
    });
    expect(readings).toStrictEqual([
      { alias: "plan-one", kind: "unread", problem: "the probe returned no reading and no reason" },
    ]);
  });

  // The sweep never probes a monthly-spend plan, so its line carries its spend.
  it("gives a monthly-spend plan its spend verdict, open or not, rather than an unprobed line", () => {
    const lines = renderPlanReadingLines({
      plans: planReadingsOf({
        configured: [{ alias: "plan-one" }, { alias: "plan-two" }],
        outcomes: [],
        spends: [
          {
            alias: "plan-one",
            verdict: { currency: "USD", headroomMinor: 6000, kind: "open", reason: "$40 of $100", usedFraction: 0.4 },
          },
          { alias: "plan-two", verdict: { kind: "not-measured", reason: "no spend reading recorded" } },
        ],
      }),
    });
    expect(lines).toStrictEqual([
      "PLAN plan-one: monthly spend OPEN — $40 of $100 · lapse UNRECORDED",
      "PLAN plan-two: monthly spend NOT-MEASURED — no spend reading recorded · lapse UNRECORDED",
    ]);
  });

  it("keeps a monthly-spend plan's recorded lapse on its spend line, and a pause still wins over its spend", () => {
    const readings = planReadingsOf({
      configured: [
        { alias: "plan-one", lapsesAtIso: "2026-11-17T00:00:00Z" },
        { alias: "plan-two", paused: { reason: "held", sinceIso: "2026-11-01T00:00:00.000Z" } },
      ],
      outcomes: [],
      spends: [
        { alias: "plan-one", verdict: { kind: "usage-limit", reason: "$50 of $100, at its usage limit" } },
        { alias: "plan-two", verdict: { kind: "not-measured", reason: "no spend reading recorded" } },
      ],
    });
    expect(readings.map((reading) => [reading.kind, reading.lapsesAtIso])).toStrictEqual([
      ["spend", "2026-11-17T00:00:00Z"],
      ["paused", undefined],
    ]);
  });
});
