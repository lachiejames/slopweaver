/*
 * The Fleet page's state in words: every glance verdict to its badge and one sentence per line, the working count
 * always first, a machine hold's defence carrying the load windows and the consumers by name, and an investigation counted
 * only when a working session is on its board row right now.
 */
import { describe, expect, it } from "vitest";

import type { Capacity, CapacityInvestigation, CpuConsumer, Seat } from "../../components/live/readNow";
import type { RankedRow } from "../../components/live/readWorkstreams";
import type { FleetGlance } from "../../lib/fleetGlance";
import { FLEET_BADGES, fleetStateOf, investigationOf } from "../../lib/fleetState";
import { diskCaption } from "../../lib/fleetStateMachine";
import type { OpenOrder } from "../../lib/fleetViews";
import type { NowSeatsView } from "../../lib/nowSeats";

/** The instant the capacity reading was taken. */
const READ_AT = "2026-10-09T14:17:00.000Z";

/** A glance with only what a case varies. */
const glance = (over: Partial<FleetGlance>): FleetGlance => ({
  alignment: { kind: "unknown", why: "not joined" },
  binding: "nothing",
  burst: { kind: "read", open: [], taken: false },
  ceiling: 4,
  verdict: "seats free",
  why: "the glance's own why",
  working: 6,
  ...over,
});

/** A CPU consumer. */
const hog = ({ label, cpuPct }: { label: string; cpuPct: number }): CpuConsumer => ({
  classification: "foreign",
  cpuPct,
  label,
  pid: cpuPct,
  sessionId: undefined,
});

/** A capacity reading, holding on CPU unless a case says otherwise. */
const capacity = (over: Partial<Capacity>): Capacity => ({
  alert: false,
  cpu: {
    attributed: true,
    hogs: [
      hog({ cpuPct: 310, label: "bfs" }),
      hog({ cpuPct: 140, label: "node" }),
      hog({ cpuPct: 90, label: "tsgolint" }),
      hog({ cpuPct: 40, label: "git" }),
    ],
  },
  culprit: undefined,
  diskFreeGb: 200,
  diskHoldFreeGb: 30,
  diskUsedPct: 61,
  dispatch: { covering: 0, investigations: [], investigationsOmitted: 0, open: 0 },
  fleetSessions: 6,
  graded: [],
  hold: true,
  holdSubjects: ["cpu"],
  idlePct: undefined,
  load1: 26.6,
  load15: 18.04,
  load5: 23.25,
  loadHold: 22,
  memory: [{ classification: "fleet", footprintGb: 4.2, label: "claude", pid: 7, sessionCwd: "/w/a" }],
  orphanCount: 0,
  plans: { kind: "absent" },
  swapTotalGb: 8,
  swapUsedGb: 1,
  unattributedCores: undefined,
  verdict: "machine capacity: HOLD",
  ...over,
});

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
  quietMinutes: 1,
  sessionId: undefined,
  sessionTitle: undefined,
  signal,
  title: ref,
  toolCalls: 3,
  workspaceId: `id-${ref}`,
  workspaceRef: ref,
});

/** A board row. */
const row = ({ id }: { id: string }): RankedRow => ({
  groomed: true,
  id,
  kind: "doc",
  label: `Find what is holding the machine (${id})`,
  openedIso: undefined,
  priority: "p1",
  ready: true,
  standing: "in-flight",
  waitingHours: 0,
});

/** A joined view: one seat on `investigate-bfs`, working or not. */
const joined = ({ signal }: { signal: string }): NowSeatsView => ({
  betweenTurns: [],
  kind: "joined",
  notOnBoard: [],
  working: [
    { placement: { rank: 1, row: row({ id: "investigate-bfs" }), session: "s1" }, seat: seat({ ref: "w:1", signal }) },
  ],
});

/** A covering investigation the load raised. */
const INVESTIGATION: CapacityInvestigation = {
  id: "d1",
  observedIso: "2026-10-09T14:05:00.000Z",
  slug: "investigate-bfs",
  subjectLabel: "bfs",
  subjectWhy: "bfs at 310% cpu",
  triggers: ["hold", "single-process"],
};

/** A capacity reading whose register carries the investigation. */
const investigating = capacity({
  dispatch: { covering: 1, investigations: [INVESTIGATION], investigationsOmitted: 0, open: 1 },
});

/** A board with two ready rows nobody is on. */
const TWO_READY: OpenOrder = { kind: "open", open: [row({ id: "a" }), row({ id: "b" })], seatedIds: new Set() };

describe("fleetStateOf", () => {
  it("words a machine hold: the badge, the load against its hold, and when more start", () => {
    const state = fleetStateOf({
      capacity: capacity({}),
      glance: glance({ binding: "machine load", verdict: "held" }),
      order: undefined,
      readAtIso: READ_AT,
      view: joined({ signal: "working" }),
    });

    expect(state.badge).toBe("holding: machine busy");
    expect(state.sentence).toStrictEqual({
      lead: "6 working",
      lines: [
        "The machine is too busy for another session.",
        "Load is 26.6 against the 22 it holds at.",
        "More start once load is back under 22.",
      ],
    });
    expect(state.defence.headline).toBe(
      "The machine is holding new sessions: load is 26.6 against the 22 it holds at.",
    );
    expect(state.defence.measurements).toStrictEqual([
      "6 working; the plans' week carries 4",
      "load 26.6 / 23.3 / 18.0 over 1, 5 and 15 minutes; the hold is judged on the 1-minute figure at 22",
    ]);
    expect(state.defence.readAtIso).toBe(READ_AT);
  });

  it("names the top three CPU consumers and folds the rest, memory beside them", () => {
    const state = fleetStateOf({
      capacity: capacity({}),
      glance: glance({ binding: "machine load", verdict: "held" }),
      order: undefined,
      readAtIso: READ_AT,
      view: joined({ signal: "working" }),
    });

    expect(state.defence.cpu!.shown.map((consumer) => consumer.label)).toStrictEqual(["bfs", "node", "tsgolint"]);
    expect(state.defence.cpu!.folded.map((consumer) => consumer.label)).toStrictEqual(["git"]);
    expect(state.defence.memory!.shown.map((consumer) => consumer.label)).toStrictEqual(["claude"]);
  });

  it("releases a hold on several subjects when they clear, naming each", () => {
    const state = fleetStateOf({
      capacity: capacity({ diskFreeGb: 24.3, holdSubjects: ["cpu", "disk"] }),
      glance: glance({ binding: "machine load", verdict: "held" }),
      order: undefined,
      readAtIso: READ_AT,
      view: joined({ signal: "working" }),
    });

    expect(state.sentence.lines).toStrictEqual([
      "The machine is too busy for another session.",
      "Load is 26.6 against the 22 it holds at.",
      "The disk has 24.3 GB free, under the 30 GB it holds at.",
      "More start once that clears.",
    ]);
  });

  it("words a disk hold as the free GB against the floor, never a percentage, and releases it at the floor", () => {
    const state = fleetStateOf({
      capacity: capacity({ diskFreeGb: 24.3, diskUsedPct: 97, holdSubjects: ["disk"] }),
      glance: glance({ binding: "machine load", verdict: "held" }),
      order: undefined,
      readAtIso: READ_AT,
      view: joined({ signal: "working" }),
    });

    expect(state.sentence.lines).toStrictEqual([
      "The machine is too busy for another session.",
      "The disk has 24.3 GB free, under the 30 GB it holds at.",
      "More start once at least 30 GB is free again.",
    ]);
    expect(state.defence.headline).toBe(
      "The machine is holding new sessions: the disk has 24.3 GB free, under the 30 GB it holds at.",
    );
  });

  it("words a disk hold off a capture from before the floor was carried as the free GB alone", () => {
    const state = fleetStateOf({
      capacity: capacity({ diskFreeGb: 149.9, diskHoldFreeGb: undefined, diskUsedPct: 85, holdSubjects: ["disk"] }),
      glance: glance({ binding: "machine load", verdict: "held" }),
      order: undefined,
      readAtIso: READ_AT,
      view: joined({ signal: "working" }),
    });

    expect(state.sentence.lines).toStrictEqual([
      "The machine is too busy for another session.",
      "The disk has 149.9 GB free.",
      "More start once that clears.",
    ]);
  });

  it("carries no consumers and no investigation for any state but a machine hold", () => {
    const state = fleetStateOf({
      capacity: capacity({ hold: false, holdSubjects: [] }),
      glance: glance({ binding: "board", verdict: "held" }),
      order: undefined,
      readAtIso: READ_AT,
      view: joined({ signal: "working" }),
    });

    expect(state.badge).toBe("holding: nothing ready");
    expect(state.sentence.lines).toStrictEqual([
      "Every ready row already has a session.",
      "The next one starts when a row becomes ready.",
    ]);
    expect(state.defence.headline).toBe("Every ready row on the board already has a session.");
    expect(state.defence.cpu).toBe(undefined);
    expect(state.defence.memory).toBe(undefined);
    expect(state.defence.investigation).toStrictEqual({ kind: "not-applicable" });
  });

  it("words the plans holding, the pace, capacity, picking up and not measured", () => {
    const of = ({ over, order }: { over: Partial<FleetGlance>; order?: OpenOrder }): readonly string[] => {
      const state = fleetStateOf({
        capacity: undefined,
        glance: glance(over),
        order,
        readAtIso: undefined,
        view: joined({ signal: "working" }),
      });
      return [state.badge, state.sentence.lead, ...state.sentence.lines];
    };

    expect(of({ over: { binding: "plan week", verdict: "held" } })).toStrictEqual([
      "holding: plans won't take another session",
      "6 working",
      "No Claude plan will take another session.",
      "The next one starts when a plan reopens.",
    ]);
    expect(of({ over: { binding: "plan week", verdict: "burst unused" } })).toStrictEqual([
      "holding: at the week's pace",
      "6 working",
      "The plans' week paces 4.",
      "The plans behind their week could carry more.",
    ]);
    expect(of({ over: { binding: "plan week", verdict: "capacity maxed" } })).toStrictEqual([
      "at capacity",
      "6 working",
      "That is the most the plans' week carries at the measured burn.",
    ]);
    expect(
      of({
        over: {
          binding: "plan week",
          burst: { kind: "read", open: ["plan-one"], taken: true },
          verdict: "capacity maxed",
        },
      }),
    ).toStrictEqual([
      "at capacity",
      "6 working",
      "That is above the 4 the week paces.",
      "The fleet is using the plans behind their week.",
    ]);
    expect(of({ order: TWO_READY, over: { verdict: "seats free", working: 2 } })).toStrictEqual([
      "picking up more",
      "2 working",
      "2 ready rows have nobody on yet.",
      "The fleet picks them up next.",
    ]);
    expect(
      of({
        order: { kind: "open", open: [row({ id: "a" })], seatedIds: new Set() },
        over: { verdict: "seats free", working: 2 },
      }),
    ).toStrictEqual([
      "picking up more",
      "2 working",
      "1 ready row has nobody on yet.",
      "The fleet picks them up next.",
    ]);
    expect(of({ over: { verdict: "seats free", working: 2 } })).toStrictEqual([
      "picking up more",
      "2 working",
      "There is room for more within the plans' week.",
    ]);
    expect(of({ over: { binding: "not known", ceiling: undefined, verdict: "not measured" } })).toStrictEqual([
      "not measured",
      "6 working",
      "How many more the plans can carry is not measured right now.",
    ]);
    expect(of({ over: { binding: "board", verdict: "not measured", working: 2 } })).toStrictEqual([
      "not measured",
      "2 working",
      "The plans' week has room for more.",
      "Whether a ready row has nobody on it was not read.",
    ]);
  });

  it("words a machine hold that names no subject, and one on memory", () => {
    const lines = (over: Partial<Capacity>): readonly string[] =>
      fleetStateOf({
        capacity: capacity(over),
        glance: glance({ binding: "machine load", verdict: "held" }),
        order: undefined,
        readAtIso: READ_AT,
        view: joined({ signal: "working" }),
      }).sentence.lines;

    expect(lines({ holdSubjects: [] })).toStrictEqual([
      "The machine is too busy for another session.",
      "The capacity reading says hold without naming why.",
      "More start once that clears.",
    ]);
    expect(lines({ holdSubjects: ["memory"] })).toStrictEqual([
      "The machine is too busy for another session.",
      "Memory is under pressure.",
      "More start once that clears.",
    ]);
  });

  it("never apologises in any badge", () => {
    expect(Object.keys(FLEET_BADGES).length).toBeGreaterThan(0);
    expect(Object.values(FLEET_BADGES).filter((badge) => /sorry|unfortunately|apolog/i.test(badge))).toStrictEqual([]);
  });
});

describe("investigationOf", () => {
  it("names the session working the investigation's board row, and when it started", () => {
    expect(investigationOf({ capacity: investigating, view: joined({ signal: "working" }) })).toStrictEqual({
      kind: "active",
      session: "Find what is holding the machine (investigate-bfs)",
      slug: "investigate-bfs",
      startedIso: "2026-10-09T14:05:00.000Z",
      why: "bfs at 310% cpu",
    });
  });

  it("refuses an open row whose session is no longer working", () => {
    expect(investigationOf({ capacity: investigating, view: joined({ signal: "idle" }) })).toStrictEqual({
      kind: "none",
      why: "no session is looking into it, and the investigations still open have no working session on them",
    });
  });

  it("says nobody is looking when the register carries no investigation", () => {
    expect(investigationOf({ capacity: capacity({}), view: joined({ signal: "working" }) })).toStrictEqual({
      kind: "none",
      why: "no session is looking into it",
    });
  });

  it("says it cannot tell on a capture from before the field, and on seats not joined to the board", () => {
    const old = capacity({
      dispatch: { covering: 1, investigations: undefined, investigationsOmitted: undefined, open: 1 },
    });
    const signalOnly: NowSeatsView = { kind: "signal-only", reason: "no-reconcile", stopped: [], working: [] };

    expect(investigationOf({ capacity: old, view: joined({ signal: "working" }) })).toStrictEqual({
      kind: "unknown",
      why: "this capacity reading predates the investigations it carries",
    });
    expect(investigationOf({ capacity: investigating, view: signalOnly }).kind).toBe("unknown");
  });

  it("does not apply without a machine hold", () => {
    expect(investigationOf({ capacity: capacity({ hold: false }), view: joined({ signal: "working" }) })).toStrictEqual(
      {
        kind: "not-applicable",
      },
    );
  });
});

describe("diskCaption", () => {
  it("names the floor beside the free figure", () => {
    expect(diskCaption({ capacity: { diskHoldFreeGb: 30 } })).toBe("disk free, hold below 30 GB");
  });

  it("says disk free alone on a capture from before the floor was carried", () => {
    expect(diskCaption({ capacity: { diskHoldFreeGb: undefined } })).toBe("disk free");
  });
});
