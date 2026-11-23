/*
 * The Fleet page's glance: the verdict, the ceiling that binds, the burst and the alignment, each derived from the
 * tick's own readings — including a tick that reads `3 working` with
 * three plans behind their week, which the glance must say something about.
 */
import { describe, expect, it } from "vitest";

import {
  type FleetWhy,
  readFleetWhy,
  readFleetWhyReading,
  readGlancePlans,
  readSeatCeiling,
  whyOfTick,
} from "../../components/live/readGlance";
import type { BoardRowQuote } from "../../components/live/readHisWords";
import type { Seat } from "../../components/live/readNow";
import type { Placed, RankedRow } from "../../components/live/readWorkstreams";
import { type FleetGlance, fleetGlanceOf, type GlanceCapacity } from "../../lib/fleetGlance";
import type { GlancePlan, GlancePlans, GlanceStatus } from "../../lib/fleetGlancePlans";
import type { OpenOrder } from "../../lib/fleetViews";
import type { NowSeatsView } from "../../lib/nowSeats";

/** The instant tick-13 observed `machine capacity`. */
const TICK_13 = "2026-10-06T01:59:27.372Z";

/** A seat as `session watch` prints one. */
const seat = ({ ref, signal }: { ref: string; signal: string }): Seat => ({
  attentionKind: undefined,
  cwd: `/w/${ref}`,
  host: "claude",
  lastActivityAtIso: undefined,
  lastEventName: "agent.hook.Stop",
  manager: undefined,
  mapped: true,
  openedAtIso: undefined,
  quietMinutes: 3,
  sessionId: undefined,
  sessionTitle: undefined,
  signal,
  title: `title ${ref}`,
  toolCalls: 7,
  workspaceId: `id-${ref}`,
  workspaceRef: ref,
});

/** A ready board row. */
const row = ({ id }: { id: string }): RankedRow => ({
  groomed: true,
  id,
  kind: "doc",
  label: `doing ${id}`,
  openedIso: undefined,
  priority: "p1",
  ready: true,
  standing: "in-flight",
  waitingHours: 0,
});

/** A seat placed on a row. */
const placed = ({ session, id }: { session: string; id: string }): Placed => ({ rank: 1, row: row({ id }), session });

/** The owner's words on a row. */
const quote = ({ words }: { words: string }): BoardRowQuote => ({
  anchor: "talk-call:c1#turn",
  atIso: "2026-10-06T02:25:00.000Z",
  cut: "none",
  where: "call",
  words,
});

/** A plan with its five-hour and seven-day windows. */
const plan = ({
  alias,
  status = "open",
  reason,
  fiveHour = 0,
  week,
  resetAtIso,
}: {
  alias: string;
  status?: GlanceStatus;
  reason?: string;
  fiveHour?: number;
  week: number;
  resetAtIso: string;
}): GlancePlan => ({
  account: `${alias}@example.invalid`,
  freeResets: undefined,
  id: `claude:${alias}`,
  pause: undefined,
  provider: "claude",
  reason,
  status,
  windows: [
    { available: 100, resetAtIso: "2026-10-06T05:00:00.000Z", used: fiveHour, window: "five-hour" },
    { available: 100, resetAtIso, used: week, window: "seven-day" },
  ],
});

/** Tick-13's five Claude plans, their weeks exactly as `machine capacity` prints them. */
const TICK_13_PLANS: readonly GlancePlan[] = [
  plan({ alias: "plan-one", resetAtIso: "2026-10-08T19:00:00.000Z", week: 56 }),
  plan({ alias: "plan-two", resetAtIso: "2026-10-10T22:00:00.000Z", week: 22 }),
  plan({ alias: "plan-three", resetAtIso: "2026-10-09T07:00:00.000Z", week: 61 }),
  plan({ alias: "plan-four", resetAtIso: "2026-10-11T03:00:00.000Z", week: 19 }),
  plan({ alias: "plan-five", resetAtIso: "2026-10-07T11:00:00.000Z", week: 83 }),
];

/** Plans ahead of their week, so no burst is open. */
const AHEAD_PLANS: readonly GlancePlan[] = [
  plan({ alias: "plan-three", resetAtIso: "2026-10-09T07:00:00.000Z", week: 61 }),
  plan({ alias: "plan-five", resetAtIso: "2026-10-07T11:00:00.000Z", week: 83 }),
];

/** A machine capacity reading carrying these plans. */
const capacity = ({
  plans,
  hold = false,
  holdSubjects = [],
}: {
  plans: GlancePlans;
  hold?: boolean;
  holdSubjects?: readonly string[];
}): GlanceCapacity => ({ hold, holdSubjects, load1: 9.32, loadHold: 24, plans });

const W1 = seat({ ref: "workspace:1", signal: "working" });
const W2 = seat({ ref: "workspace:2", signal: "working" });
const W3 = seat({ ref: "workspace:3", signal: "working" });
const IDLE = seat({ ref: "workspace:4", signal: "idle" });

/** W1 and W2 on rows; W3 working on no row — still the working band, a signal outranks a placement; IDLE between turns on a row. */
const JOINED: NowSeatsView = {
  betweenTurns: [{ placement: placed({ id: "row-idle", session: "workspace:4" }), seat: IDLE }],
  kind: "joined",
  notOnBoard: [],
  working: [
    { placement: placed({ id: "row-steered", session: "workspace:1" }), seat: W1 },
    { placement: placed({ id: "row-unsteered", session: "workspace:2" }), seat: W2 },
    { placement: undefined, seat: W3 },
  ],
};

/** The owner's words stand on the steered row and the idle seat's row only. */
const QUOTES: ReadonlyMap<string, BoardRowQuote> = new Map([
  ["row-steered", quote({ words: "capacity maxed and alignment maxed" })],
  ["row-idle", quote({ words: "fans are way too quiet" })],
]);

/** An open order with this many ready rows nobody is on. */
const order = ({ open }: { open: number }): OpenOrder => ({
  kind: "open",
  open: Array.from({ length: open }, (_, at) => row({ id: `ready-${String(at)}` })),
  seatedIds: new Set(),
});

/** What `fleetGlanceOf` takes, less the instant every case judges at. */
type GlanceInput = Omit<Parameters<typeof fleetGlanceOf>[0], "nowIso">;

/** Tick-13's glance input: four seats, three working, a measured ceiling of three and two ready rows unseated. */
const TICK_13_INPUT: GlanceInput = {
  capacity: capacity({ plans: { kind: "read", lowest: undefined, plans: TICK_13_PLANS } }),
  ceiling: { kind: "measured", seats: 3 },
  order: order({ open: 2 }),
  quotes: QUOTES,
  seats: [W1, W2, W3, IDLE],
  view: JOINED,
};

/** The glance over tick-13's input with these fields replaced — an explicit `undefined` included. */
const glance = (over: Partial<GlanceInput>): FleetGlance =>
  fleetGlanceOf({ ...TICK_13_INPUT, ...over, nowIso: TICK_13 });

/** Tick-13's machine reading over other plans. */
const withPlans = ({ plans }: { plans: GlancePlans }): Partial<GlanceInput> => ({ capacity: capacity({ plans }) });

describe("fleetGlanceOf, on tick-13's reading", () => {
  it("names the burst the owner could not see: three working at a ceiling of three, three plans behind their week", () => {
    const at = glance({});
    expect(at).toEqual({
      alignment: { kind: "joined", onSteer: 1, working: 3 },
      binding: "plan week",
      burst: { kind: "read", open: ["plan-one", "plan-two", "plan-four"], taken: false },
      ceiling: 3,
      verdict: "burst unused",
      why: "plan-one, plan-two and plan-four are behind their week, so seats above 3 there would spend allowance that otherwise expires.",
      working: 3,
    });
  });
});

describe("fleetGlanceOf, the verdict", () => {
  it("reads capacity maxed when the seats fill the ceiling and no plan is behind its week", () => {
    const at = glance(withPlans({ plans: { kind: "read", lowest: undefined, plans: AHEAD_PLANS } }));
    expect([at.verdict, at.binding, at.why]).toEqual([
      "capacity maxed",
      "plan week",
      "3 working, the most the plans' week carries at the measured burn.",
    ]);
    expect(at.burst).toEqual({ kind: "read", open: [], taken: false });
  });

  it("reads capacity maxed, burst taken, when more seats work than the week paces", () => {
    const at = glance({ ceiling: { kind: "measured", seats: 2 } });
    expect([at.verdict, at.burst, at.why]).toEqual([
      "capacity maxed",
      { kind: "read", open: ["plan-one", "plan-two", "plan-four"], taken: true },
      "3 working, above the 2 the week paces, drawing on plans behind their week.",
    ]);
  });

  it("reads seats free, counting the ready rows nobody is on", () => {
    const at = glance({ ceiling: { kind: "measured", seats: 5 }, order: order({ open: 4 }) });
    expect([at.verdict, at.binding, at.why]).toEqual([
      "seats free",
      "nothing",
      "2 more working seats fit the plans' week, and 4 ready rows have nobody on them.",
    ]);
  });

  it("reads not measured, bound to the board, when seats are free and the board did not read", () => {
    const at = glance({ ceiling: { kind: "measured", seats: 5 }, order: undefined });
    expect([at.verdict, at.binding, at.why]).toEqual([
      "not measured",
      "board",
      "2 more working seats fit the plans' week, but whether a ready row has nobody on it was not read.",
    ]);
  });

  it("reads held by the board when seats are free and every ready row already has one", () => {
    const at = glance({ ceiling: { kind: "measured", seats: 5 }, order: order({ open: 0 }) });
    expect([at.verdict, at.binding, at.why]).toEqual([
      "held",
      "board",
      "The plans' week carries 5, and every ready row on the board already has a seat.",
    ]);
  });

  it("reads held by machine load when the machine refuses a seat, ahead of every other arm", () => {
    const at = glance({
      ceiling: { kind: "measured", seats: 5 },
      capacity: capacity({
        hold: true,
        holdSubjects: ["vitest"],
        plans: { kind: "read", lowest: undefined, plans: TICK_13_PLANS },
      }),
    });
    expect([at.verdict, at.binding, at.why]).toEqual([
      "held",
      "machine load",
      "The machine is holding new seats: vitest, load 9.3 against a hold at 24.",
    ]);
  });

  it("reads held by the five-hour window when no plan is open and one sits at its five-hour cap", () => {
    const at = glance(
      withPlans({
        plans: {
          kind: "read",
          lowest: undefined,
          plans: [
            plan({
              alias: "plan-five",
              fiveHour: 100,
              reason: "five-hour window at 100%",
              resetAtIso: "2026-10-07T11:00:00.000Z",
              status: "held",
              week: 83,
            }),
          ],
        },
      }),
    );
    expect([at.verdict, at.binding, at.why]).toEqual([
      "held",
      "five-hour window",
      "No Claude plan is taking new work. plan-five: five-hour window at 100%.",
    ]);
  });

  it("reads held by the plan week when no plan is open and none is at its five-hour cap", () => {
    const at = glance(
      withPlans({
        plans: {
          kind: "read",
          lowest: undefined,
          plans: [plan({ alias: "plan-five", resetAtIso: "2026-10-07T11:00:00.000Z", status: "paused", week: 99 })],
        },
      }),
    );
    expect([at.verdict, at.binding, at.why]).toEqual(["held", "plan week", "No Claude plan is taking new work."]);
  });

  it("reads not measured when the fleet ceiling is unmeasurable, naming why", () => {
    const at = glance({ ceiling: { kind: "unmeasurable", reason: "no plan has a readable week" } });
    expect([at.verdict, at.binding, at.ceiling, at.why]).toEqual([
      "not measured",
      "not known",
      undefined,
      "How many seats the plans carry is not measured: no plan has a readable week.",
    ]);
  });

  it("reads not measured when the fleet ceiling reading has not arrived", () => {
    const at = glance({ ceiling: undefined });
    expect([at.verdict, at.why]).toEqual([
      "not measured",
      "The fleet ceiling reading is not available, so how many seats the plans carry is not known.",
    ]);
  });
});

describe("fleetGlanceOf, the burst", () => {
  it("is unread when the capacity reading predates the plans' ceilings, and never reads maxed over it", () => {
    const at = glance(withPlans({ plans: { kind: "absent" } }));
    expect([at.burst, at.verdict, at.why]).toEqual([
      { kind: "unread", why: "the machine capacity reading predates the plans' ceilings" },
      "not measured",
      "3 working against the 3 the week paces, but whether a plan is behind its week is not known: the machine capacity reading predates the plans' ceilings.",
    ]);
  });

  it("is unread when the machine capacity reading has not arrived, so three of three is not called maxed", () => {
    const at = glance({ capacity: undefined });
    expect([at.burst, at.verdict]).toEqual([
      { kind: "unread", why: "the machine capacity reading is not available" },
      "not measured",
    ]);
  });

  it("is unread, and never maxed, when an open plan's week carries no reset to judge it against", () => {
    const at = glance(
      withPlans({
        plans: {
          kind: "read",
          lowest: undefined,
          plans: [
            ...AHEAD_PLANS,
            {
              account: undefined,
              freeResets: undefined,
              id: "claude:plan-two",
              pause: undefined,
              provider: "claude",
              reason: undefined,
              status: "open",
              windows: [{ available: 100, resetAtIso: undefined, used: 22, window: "seven-day" }],
            },
          ],
        },
      }),
    );
    expect([at.burst, at.verdict]).toEqual([
      { kind: "unread", why: "the week of plan-two did not read" },
      "not measured",
    ]);
  });

  it("is unread when the reading carries no Claude plan at all", () => {
    expect(glance(withPlans({ plans: { kind: "read", lowest: undefined, plans: [] } })).burst).toEqual({
      kind: "unread",
      why: "the machine capacity reading carries no Claude plan",
    });
  });

  it("is unread when the plans' ceilings did not read", () => {
    expect(glance(withPlans({ plans: { kind: "unreadable" } })).burst).toEqual({
      kind: "unread",
      why: "the plans' ceilings in the machine capacity reading did not read",
    });
  });

  it("never counts a plan that is not open, however far behind its week", () => {
    const at = glance(
      withPlans({
        plans: {
          kind: "read",
          lowest: undefined,
          plans: [
            plan({ alias: "plan-two", resetAtIso: "2026-10-10T22:00:00.000Z", status: "refusing", week: 0 }),
            ...AHEAD_PLANS,
          ],
        },
      }),
    );
    expect(at.burst).toEqual({ kind: "read", open: [], taken: false });
  });
});

describe("fleetGlanceOf, the alignment", () => {
  it("is unknown until the board reads the owner's words", () => {
    expect(glance({ quotes: undefined }).alignment).toEqual({
      kind: "unknown",
      why: "the board has not been read, so the owner's words behind each row are not known",
    });
  });

  it("is unknown, naming the gap, when the seats could not be joined to the board", () => {
    const at = glance({
      view: { kind: "signal-only", reason: "no-reconcile", stopped: [IDLE], working: [W1, W2, W3] },
    });
    expect(at.alignment).toEqual({ kind: "unknown", why: "the board reading is not available" });
  });
});

describe("fleetGlanceOf, beside a Codex plan", () => {
  it("judges the burst and the verdict on the Claude plans alone", () => {
    const codexFull: GlancePlan = {
      account: "codex@example.invalid",
      freeResets: 1,
      id: "codex:codex-one",
      pause: undefined,
      provider: "codex",
      reason: "weekly window at 100%",
      status: "held",
      windows: [{ available: 100, resetAtIso: "2026-10-06T03:00:00.000Z", used: 100, window: "weekly" }],
    };
    const at = glance(withPlans({ plans: { kind: "read", lowest: undefined, plans: [...TICK_13_PLANS, codexFull] } }));
    expect([at.verdict, at.binding, at.burst]).toEqual([
      "burst unused",
      "plan week",
      { kind: "read", open: ["plan-one", "plan-two", "plan-four"], taken: false },
    ]);
  });
});

/** One recorded ceiling as `machine capacity --json` writes it, the fields under test replaced. */
const recorded = (over: Record<string, unknown>): Record<string, unknown> => ({
  account: "admin@example.invalid",
  freeResets: null,
  headroom: 0.4,
  id: "claude:plan-two",
  kind: "claude",
  reason: null,
  status: "open",
  windows: [{ available: 100, resetAtIso: "2026-10-10T22:00:00.000Z", used: 22, window: "seven-day" }],
  ...over,
});

/** The first plan a read produced; throws when the plans did not read, so the assertion after it never guesses. */
const firstPlan = ({ plans }: { plans: GlancePlans }): GlancePlan => {
  if (plans.kind !== "read") {
    throw new Error(`the plans did not read: ${plans.kind}`);
  }
  const [first] = plans.plans;
  if (first === undefined) {
    throw new Error("the plans read empty");
  }
  return first;
};

describe("readGlancePlans", () => {
  it("keeps the Claude and Codex plans and the route's lowest ceiling, and drops the machine", () => {
    const payload = {
      ceilings: {
        ceilings: [
          recorded({}),
          recorded({
            account: "codex@example.invalid",
            freeResets: 2,
            id: "codex:codex-one",
            kind: "codex",
            windows: [{ available: 100, resetAtIso: null, used: 40, window: "weekly" }],
          }),
          recorded({
            account: null,
            id: "machine:load",
            kind: "machine",
            windows: [{ available: 24, resetAtIso: null, used: 9.32, window: "load1" }],
          }),
        ],
        lowest: "claude:plan-two",
      },
    };
    expect(readGlancePlans({ payload })).toEqual({
      kind: "read",
      lowest: "claude:plan-two",
      plans: [
        {
          account: "admin@example.invalid",
          freeResets: null,
          id: "claude:plan-two",
          provider: "claude",
          reason: undefined,
          status: "open",
          windows: [{ available: 100, resetAtIso: "2026-10-10T22:00:00.000Z", used: 22, window: "seven-day" }],
        },
        {
          account: "codex@example.invalid",
          freeResets: 2,
          id: "codex:codex-one",
          provider: "codex",
          reason: undefined,
          status: "open",
          windows: [{ available: 100, resetAtIso: undefined, used: 40, window: "weekly" }],
        },
      ],
    });
  });

  it("keeps a recorded null account and free resets as null, apart from a missing key", () => {
    expect(readGlancePlans({ payload: { ceilings: { ceilings: [recorded({ account: null })] } } })).toEqual({
      kind: "read",
      lowest: undefined,
      plans: [
        {
          account: null,
          freeResets: null,
          id: "claude:plan-two",
          provider: "claude",
          reason: undefined,
          status: "open",
          windows: [{ available: 100, resetAtIso: "2026-10-10T22:00:00.000Z", used: 22, window: "seven-day" }],
        },
      ],
    });
  });

  it("reads an inherited null as a missing key, never as one the capture recorded", () => {
    const own = recorded({});
    delete own["account"];
    delete own["freeResets"];
    const parent = Object.create({ account: null, freeResets: null }) as Record<string, unknown>;
    const inheriting = Object.assign(parent, own);
    expect(readGlancePlans({ payload: { ceilings: { ceilings: [inheriting] } } })).toEqual({
      kind: "read",
      lowest: undefined,
      plans: [
        {
          account: undefined,
          freeResets: undefined,
          id: "claude:plan-two",
          provider: "claude",
          reason: undefined,
          status: "open",
          windows: [{ available: 100, resetAtIso: "2026-10-10T22:00:00.000Z", used: 22, window: "seven-day" }],
        },
      ],
    });
  });

  it("reads a capture from before the account fields, those fields and the lowest left unknown", () => {
    const old = recorded({});
    delete old["account"];
    delete old["freeResets"];
    expect(readGlancePlans({ payload: { ceilings: { ceilings: [old] } } })).toEqual({
      kind: "read",
      lowest: undefined,
      plans: [
        {
          account: undefined,
          freeResets: undefined,
          id: "claude:plan-two",
          provider: "claude",
          reason: undefined,
          status: "open",
          windows: [{ available: 100, resetAtIso: "2026-10-10T22:00:00.000Z", used: 22, window: "seven-day" }],
        },
      ],
    });
  });

  it("is unreadable when an account, a free-reset count or the lowest is the wrong type", () => {
    expect(readGlancePlans({ payload: { ceilings: { ceilings: [recorded({ account: 7 })] } } })).toEqual({
      kind: "unreadable",
    });
    expect(readGlancePlans({ payload: { ceilings: { ceilings: [recorded({ freeResets: "one" })] } } })).toEqual({
      kind: "unreadable",
    });
    expect(readGlancePlans({ payload: { ceilings: { ceilings: [recorded({})], lowest: 3 } } })).toEqual({
      kind: "unreadable",
    });
  });

  it("is unreadable on a provider it has never heard of, rather than skipping it", () => {
    expect(readGlancePlans({ payload: { ceilings: { ceilings: [recorded({ kind: "gemini" })] } } })).toEqual({
      kind: "unreadable",
    });
  });

  it("is absent on a document from before the ceilings field", () => {
    expect(readGlancePlans({ payload: { hold: false } })).toEqual({ kind: "absent" });
  });

  it("is unreadable when a ceiling will not read", () => {
    const payload = { ceilings: { ceilings: [{ id: "claude:plan-two", kind: "claude", status: 3, windows: [] }] } };
    expect(readGlancePlans({ payload })).toEqual({ kind: "unreadable" });
  });

  it("is unreadable on a status outside the closed set", () => {
    expect(readGlancePlans({ payload: { ceilings: { ceilings: [recorded({ status: "resting" })] } } })).toEqual({
      kind: "unreadable",
    });
  });

  it("reads a paused plan's pause: its week at the pause, or why it was not read", () => {
    const paused = (weekAtPause: unknown): Record<string, unknown> =>
      recorded({
        pause: { sinceIso: "2026-10-09T07:13:00.000Z", weekAtPause },
        reason: "paused — never hit a limit",
        status: "paused",
        windows: [],
      });
    const read = readGlancePlans({
      payload: {
        ceilings: {
          ceilings: [
            paused({
              available: 100,
              kind: "read",
              readAtIso: "2026-10-09T07:05:00.000Z",
              resetAtIso: null,
              used: 80,
            }),
          ],
        },
      },
    });
    const unavailable = readGlancePlans({
      payload: {
        ceilings: { ceilings: [paused({ kind: "unavailable", why: "no capacity reading before the pause" })] },
      },
    });

    expect(read.kind).toBe("read");
    expect(firstPlan({ plans: read }).pause).toEqual({
      sinceIso: "2026-10-09T07:13:00.000Z",
      weekAtPause: {
        available: 100,
        kind: "read",
        readAtIso: "2026-10-09T07:05:00.000Z",
        resetAtIso: undefined,
        used: 80,
      },
    });
    expect(firstPlan({ plans: unavailable }).pause).toEqual({
      sinceIso: "2026-10-09T07:13:00.000Z",
      weekAtPause: { kind: "unavailable", why: "no capacity reading before the pause" },
    });
    expect(readGlancePlans({ payload: { ceilings: { ceilings: [paused({ kind: "guessed" })] } } })).toEqual({
      kind: "unreadable",
    });
  });
});

describe("readSeatCeiling", () => {
  it("reads a measured ceiling", () => {
    expect(readSeatCeiling({ ceiling: { kind: "measured", seats: 3 } })).toEqual({ kind: "measured", seats: 3 });
  });

  it("reads an unmeasurable ceiling with its reason", () => {
    expect(readSeatCeiling({ ceiling: { kind: "unmeasurable", reason: "no burn yet" } })).toEqual({
      kind: "unmeasurable",
      reason: "no burn yet",
    });
  });

  it("refuses a document that is not a fleet ceiling report", () => {
    expect(readSeatCeiling({ ceiling: { kind: "guessed", seats: 3 } })).toBe(undefined);
  });
});

describe("readFleetWhy", () => {
  const CURRENT = { machineObservedAtIso: "2026-10-09T14:40:00.000Z", tick: "tick-27", working: 7 };

  it("reads the binding, the reading it judged, the window and the sentences, ignoring every other field", () => {
    expect(
      readFleetWhy({
        binding: "plans",
        current: CURRENT,
        minutes: 60,
        sentences: ["Plans bind.", "One held."],
        unknownBecause: null,
      }),
    ).toEqual({
      binding: "plans",
      judgedMachineAtIso: "2026-10-09T14:40:00.000Z",
      judgedTick: "tick-27",
      minutes: 60,
      sentences: ["Plans bind.", "One held."],
    });
  });

  it("reads a report that judged no reading as neither tick nor instant, not as a refusal", () => {
    const why = readFleetWhy({
      binding: "unknown",
      current: { machineObservedAtIso: null, tick: null },
      minutes: 60,
      sentences: ["No usable machine capacity reading."],
    })!;
    expect([why.judgedTick, why.judgedMachineAtIso, why.binding]).toEqual([undefined, undefined, "unknown"]);
  });

  it("refuses a report with no sentence, no binding, no current figures, or none of the report at all", () => {
    expect(readFleetWhy({ binding: "plans", current: CURRENT, minutes: 60, sentences: [] })).toBe(undefined);
    expect(readFleetWhy({ current: CURRENT, minutes: 60, sentences: ["Plans bind."] })).toBe(undefined);
    expect(readFleetWhy({ binding: "plans", minutes: 60, sentences: ["Plans bind."] })).toBe(undefined);
    expect(
      readFleetWhy({
        binding: "plans",
        current: { machineObservedAtIso: 4, tick: "tick-27" },
        minutes: 60,
        sentences: ["x"],
      }),
    ).toBe(undefined);
    expect(readFleetWhy("fleet why")).toBe(undefined);
  });
});

describe("whyOfTick", () => {
  const VERDICT = { by: "tick-27", observedAtIso: "2026-10-09T14:40:00.000Z" };
  const NEWER = "2026-10-09T14:55:00.000Z";
  const JUDGED = {
    binding: "plans",
    judgedMachineAtIso: VERDICT.observedAtIso,
    judgedTick: VERDICT.by,
    minutes: 60,
    sentences: ["Plans bind."],
  };
  const UNJUDGED = {
    binding: "unknown",
    judgedMachineAtIso: undefined,
    judgedTick: undefined,
    minutes: 60,
    sentences: ["No usable machine capacity reading."],
  };
  const why = ({ by, observedAtIso, value }: { by: string; observedAtIso: string; value: FleetWhy }) => ({
    by,
    observedAtIso,
    readingId: "r-1",
    recordedAtIso: observedAtIso,
    value,
  });

  it("draws the why that judged the verdict's own reading", () => {
    expect(
      whyOfTick({
        capacity: VERDICT,
        why: why({ by: "tick-27", observedAtIso: "2026-10-09T14:41:00.000Z", value: JUDGED }),
      }),
    ).toEqual(JUDGED);
  });

  it("draws a newer tick's why that could not judge its binding, since it says why", () => {
    expect(
      whyOfTick({ capacity: VERDICT, why: why({ by: "tick-28", observedAtIso: NEWER, value: UNJUDGED }) }),
    ).toEqual(UNJUDGED);
  });

  it("does not draw a newer tick's judged why beside a verdict the page has not polled yet", () => {
    const tick28 = { ...JUDGED, judgedMachineAtIso: NEWER, judgedTick: "tick-28" };
    expect(whyOfTick({ capacity: VERDICT, why: why({ by: "tick-28", observedAtIso: NEWER, value: tick28 }) })).toBe(
      undefined,
    );
  });

  it("does not draw an older tick's why beside a newer verdict, judged or not", () => {
    const older = "2026-10-09T14:25:00.000Z";
    const tick26 = { ...JUDGED, judgedMachineAtIso: older, judgedTick: "tick-26" };
    expect([
      whyOfTick({ capacity: VERDICT, why: why({ by: "tick-26", observedAtIso: older, value: tick26 }) }),
      whyOfTick({ capacity: VERDICT, why: why({ by: "tick-26", observedAtIso: older, value: UNJUDGED }) }),
    ]).toEqual([undefined, undefined]);
  });

  it("does not draw a report under the verdict's reused tick label that judged another reading, older or newer", () => {
    const earlier = { ...JUDGED, judgedMachineAtIso: "2026-10-09T13:40:00.000Z" };
    const later = { ...JUDGED, judgedMachineAtIso: "2026-10-09T15:40:00.000Z" };
    expect([
      whyOfTick({
        capacity: VERDICT,
        why: why({ by: "tick-27", observedAtIso: "2026-10-09T13:41:00.000Z", value: earlier }),
      }),
      whyOfTick({
        capacity: VERDICT,
        why: why({ by: "tick-27", observedAtIso: "2026-10-09T15:41:00.000Z", value: later }),
      }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("readFleetWhyReading", () => {
  it("reads the ledger row's tick beside the report, which the glance matches to the capacity reading's", () => {
    const reading = readFleetWhyReading({
      by: "tick-27",
      document: {
        binding: "plans",
        current: { machineObservedAtIso: "2026-10-09T14:39:00.000Z", tick: "tick-27" },
        minutes: 60,
        sentences: ["Plans bind."],
      },
      observedAtIso: "2026-10-09T14:40:00.000Z",
      readingId: "r-1",
      recordedAtIso: "2026-10-09T14:40:01.000Z",
    })!;
    expect([reading.by, reading.value]).toEqual([
      "tick-27",
      {
        binding: "plans",
        judgedMachineAtIso: "2026-10-09T14:39:00.000Z",
        judgedTick: "tick-27",
        minutes: 60,
        sentences: ["Plans bind."],
      },
    ]);
  });
});
