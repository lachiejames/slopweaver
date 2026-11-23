/**
 * The Codex plan week projected off a filed reading: at risk with its evidence, clear with free resets counted, and
 * unmeasurable on every gap — a monthly-spend plan, an unread plan, no demand, unread free resets behind a spell.
 */
import { describe, expect, it } from "vitest";

import type { Ceiling } from "../../../capacity/ceilings.js";
import type { WeekDemand } from "../../../capacity/weekDemand.js";
import type { HostDrySpell, HostWeekProjection } from "../../../capacity/weekRisk.js";
import { codexWeekProjection } from "../../../codex/weekRisk.js";
import { DETAIL_LINE_CAP } from "../../../hand/details.js";
import type { RegisteredPlan } from "../../../plans/types.js";
import { OPEN_MACHINE, readingOf, registered } from "../monitor/fleetRunsDryFixtures.js";

const NOW = "2026-11-08T12:00:00.000Z";
const HOUR_MS = 3_600_000;
const THRESHOLDS = { alertAtPercent: 90, pauseAtPercent: 99 } as const;
const OPENING = { demandShare: 0.9, minDryHours: 4 } as const;

/** An instant `hours` from {@link NOW}. */
function at({ hours }: { hours: number }): string {
  return new Date(Date.parse(NOW) + hours * HOUR_MS).toISOString();
}

/** A Codex plan's ceiling at `used` of its week, resetting `resetHours` from now, holding `freeResets`. */
function codex({
  alias,
  freeResets = 0,
  resetHours,
  used,
}: {
  alias: string;
  freeResets?: number | null;
  resetHours: number;
  used: number;
}): Ceiling {
  return {
    account: `${alias} (acme)`,
    freeResets,
    headroom: null,
    id: `codex:${alias}`,
    kind: "codex",
    reason: null,
    status: "open",
    windows: [
      { available: 100, resetAtIso: at({ hours: 2 }), used: 0, window: "five-hour" },
      { available: 100, resetAtIso: at({ hours: resetHours }), used, window: "weekly" },
    ],
  };
}

/** A measured trailing draw of `pointsPerHour` over a week. */
function measured({ pointsPerHour }: { pointsPerHour: number }): WeekDemand {
  return { kind: "measured", pointsPerHour, readings: 300, spanHours: 168 };
}

const TWO_PLANS: readonly RegisteredPlan[] = [
  registered({ alias: "codex-one", provider: "codex" }),
  registered({ alias: "codex-two", provider: "codex" }),
  registered({ alias: "plan-one", provider: "claude" }),
];

/** The projection over two plans at 90%, resetting in 30h and 40h, with the free resets given. */
function project({
  demand = measured({ pointsPerHour: 1 / 0.9 }),
  freeResets = 0,
  plans = TWO_PLANS,
}: {
  demand?: WeekDemand;
  freeResets?: number | null;
  plans?: readonly RegisteredPlan[];
}): ReturnType<typeof codexWeekProjection> {
  const reading = readingOf({
    ceilings: [
      OPEN_MACHINE,
      codex({ alias: "codex-one", freeResets, resetHours: 30, used: 90 }),
      codex({ alias: "codex-two", resetHours: 40, used: 90 }),
    ],
    observedAtIso: NOW,
  });
  return codexWeekProjection({ criterion: OPENING, demand, reading, registered: plans, thresholds: THRESHOLDS });
}

describe("codexWeekProjection", () => {
  it("is at risk when every routable plan caps before a reset, carrying its basis, every plan and a stable identity", () => {
    expect(project({})).toEqual({
      kind: "at-risk",
      spell: {
        basis:
          "Codex, projected at 90% of the trailing draw: 0.24 plan-weeks/day (trailing 0.27 plan-weeks/day, over 168h of capacity readings), 1.68 plan-weeks over the next 7 days, 0.12 of them unmet; 0 free reset(s) the chair may claim, 0 claimed; 0.00 plan-weeks left unspent at the current resets",
        endIso: at({ hours: 30 }),
        endedById: "codex:codex-one",
        host: "codex",
        hours: 12,
        identity: ["codex:codex-one@99", "codex:codex-two@99"],
        planLines: [
          "codex-one: 90% used of a 99% ceiling, 9% of a week left before its 2026-11-09T18:00Z reset; the routed draw fills it 2026-11-09T00:00Z, 18h before that reset; 0 free reset(s) held, 0 claimed in the projection",
          "codex-two: 90% used of a 99% ceiling, 9% of a week left before its 2026-11-10T04:00Z reset; the routed draw fills it 2026-11-09T05:00Z, 23h before that reset; 0 free reset(s) held, 0 claimed in the projection",
        ],
        startIso: at({ hours: 18 }),
      },
    });
  });

  it("is clear when a free reset the chair would claim carries the week, and shows the claim it rests on", () => {
    const projection = project({ freeResets: 1 });
    expect(projection.kind).toBe("clear");
    const lines = (projection as Extract<HostWeekProjection, { kind: "clear" }>).lines!;
    expect(lines[0]).toContain("0.00 of them unmet; 1 free reset(s) the chair may claim, 1 claimed;");
    expect(lines[1]).toContain("; 1 free reset(s) held, 1 claimed in the projection");
  });

  it("says a plan under the owner's own usage limit is never claimed for, whatever it holds", () => {
    const limited: readonly RegisteredPlan[] = [
      { ...registered({ alias: "codex-one", provider: "codex" }), usageLimitPercent: 50 },
      registered({ alias: "codex-two", provider: "codex" }),
    ];
    // Held at 50% while it reads 90%, so it takes nothing, claims nothing, and codex-two alone runs out.
    const spell = spellOf({ projection: project({ freeResets: 3, plans: limited }) });
    expect(spell.planLines[0]).toBe(
      "codex-one: 90% used of a 50% ceiling, 0% of a week left before its 2026-11-09T18:00Z reset; the routed draw fills it 2026-11-08T12:00Z, 1d6h before that reset; it stops at your own usage limit, where no free reset is claimed",
    );
    expect([spell.basis, ...spell.planLines].every((line) => line.length <= DETAIL_LINE_CAP)).toBe(true);
  });

  it("is unmeasurable when a spell rests on free resets nobody read", () => {
    expect(project({ freeResets: null })).toEqual({
      kind: "unmeasurable",
      why: "a Codex spell is projected, but codex:codex-one's free resets are not read, and a claim may prevent it",
    });
  });

  it("is unmeasurable on a monthly-spend plan, an unread plan, or no trailing draw", () => {
    const monthly = [...TWO_PLANS, registered({ alias: "codex-m", allowance: "monthly-spend", provider: "codex" })];
    expect(project({ plans: monthly })).toEqual({
      kind: "unmeasurable",
      why: "Codex plan codex-m is a monthly-spend plan, whose spend no reading measures",
    });
    const extra = [...TWO_PLANS, registered({ alias: "codex-three", provider: "codex" })];
    expect(project({ plans: extra })).toEqual({
      kind: "unmeasurable",
      why: "Codex plan codex-three has no readable weekly window in the latest capacity reading",
    });
    expect(project({ demand: { kind: "unmeasurable", why: "too short" } })).toEqual({
      kind: "unmeasurable",
      why: "Codex trailing demand: too short",
    });
  });

  it("is clear with no routable Codex plan, and lists a paused one without routing it", () => {
    expect(project({ plans: [registered({ alias: "plan-one", provider: "claude" })] })).toEqual({
      kind: "clear",
      why: "no Codex plan is routable, so there is no Codex week to run out",
    });
    const paused: RegisteredPlan = {
      ...registered({ alias: "codex-p", provider: "codex" }),
      paused: { reason: "held for a review", sinceIso: at({ hours: -5 }) },
    };
    expect(spellOf({ projection: project({ plans: [...TWO_PLANS, paused] }) }).planLines.at(-1)).toBe(
      "codex-p: paused, not routed — held for a review",
    );
  });

  it("starts a plan whose reset is already past in the window it rolled into, never the expired one", () => {
    const reading = readingOf({
      ceilings: [
        OPEN_MACHINE,
        codex({ alias: "codex-one", resetHours: -1, used: 10 }),
        codex({ alias: "codex-two", resetHours: 40, used: 90 }),
      ],
      observedAtIso: NOW,
    });
    const projection = codexWeekProjection({
      criterion: OPENING,
      demand: measured({ pointsPerHour: 1 / 0.9 }),
      reading,
      registered: TWO_PLANS,
      thresholds: THRESHOLDS,
    });
    expect(projection.kind).toBe("clear");
    expect((projection as Extract<HostWeekProjection, { kind: "clear" }>).lines![1]).toMatch(
      /^codex-one: 0% used of a 99% ceiling, 99% of a week left before its 2026-11-15T11:00Z reset; /,
    );
  });

  it("is unmeasurable on a weekly reset more than a week out, which no line could describe at its reset", () => {
    const reading = readingOf({
      ceilings: [
        OPEN_MACHINE,
        codex({ alias: "codex-one", resetHours: 200, used: 0 }),
        codex({ alias: "codex-two", resetHours: 40, used: 90 }),
      ],
      observedAtIso: NOW,
    });
    expect(
      codexWeekProjection({
        criterion: OPENING,
        demand: measured({ pointsPerHour: 1 / 0.9 }),
        reading,
        registered: TWO_PLANS,
        thresholds: THRESHOLDS,
      }),
    ).toEqual({
      kind: "unmeasurable",
      why: "Codex plan codex-one's weekly window resets more than a week after the latest capacity reading, which no weekly window does",
    });
  });

  it("starts an unstarted window whose reset Codex stamped seconds past the week at the week's end", () => {
    const fresh: Ceiling = {
      ...codex({ alias: "codex-one", resetHours: 0, used: 0 }),
      windows: [{ available: 100, resetAtIso: "2026-11-15T12:00:02.957Z", used: 0, window: "weekly" }],
    };
    const reading = readingOf({
      ceilings: [OPEN_MACHINE, fresh, codex({ alias: "codex-two", resetHours: 40, used: 90 })],
      observedAtIso: NOW,
    });
    const projection = codexWeekProjection({
      criterion: OPENING,
      demand: measured({ pointsPerHour: 1 / 0.9 }),
      reading,
      registered: TWO_PLANS,
      thresholds: THRESHOLDS,
    });
    expect(projection.kind).toBe("clear");
    expect((projection as Extract<HostWeekProjection, { kind: "clear" }>).lines![1]).toMatch(
      /^codex-one: 0% used of a 99% ceiling, 99% of a week left before its 2026-11-15T12:00Z reset; /,
    );
  });

  it("clips a paused plan's long reason to one card detail, so a valid at-risk week never reads unmeasurable", () => {
    const paused: RegisteredPlan = {
      ...registered({ alias: "a".repeat(32), provider: "codex" }),
      paused: { reason: "x".repeat(300), sinceIso: at({ hours: -5 }) },
    };
    const line = spellOf({ projection: project({ plans: [...TWO_PLANS, paused] }) }).planLines.at(-1)!;
    expect([line.length, line.startsWith(`${"a".repeat(32)}: paused, not routed — xxx`), line.endsWith("x…")]).toEqual([
      DETAIL_LINE_CAP,
      true,
      true,
    ]);
  });
});

/** The spell inside an at-risk projection, throwing otherwise so the assertion carries no branch. */
function spellOf({ projection }: { projection: HostWeekProjection }): HostDrySpell {
  if (projection.kind !== "at-risk") {
    throw new Error(`expected a spell, got: ${projection.why}`);
  }
  return projection.spell;
}
