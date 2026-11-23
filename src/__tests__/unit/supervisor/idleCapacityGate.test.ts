/**
 * The idle-capacity gate — `supervisor tick-record` refusing a tick that read NO hold and left a groomed,
 * ready p0–p2 doc or ask row with no seat, no spawn and no named reason.
 *
 * The predicate is judged per ROW, which is the whole difference from the sweep gate: an outcome with one
 * live seat was "covered" while 97 ready rows under it sat unspawned. Every case below asserts the whole
 * verdict, so a row that drops out of — or sneaks into — the refusal reddens the test.
 */
import { describe, expect, it } from "vitest";

import { judgeIdleCapacity } from "../../../supervisor/idleCapacityGate.js";

/** A capacity observation's facts, with only what a case varies overridden. */
function facts(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { hold: false, holdSubjects: [], load1: 3.77, ...over };
}

/** A draft's sources: a capacity reading, and a gauge naming a plan unless a case says otherwise. */
function sourcesWith({
  capacity = { facts: facts(), status: "read" },
  gauge = { facts: { nextAllModels: "plan-four", nextFable: "plan-four" }, status: "read" },
}: {
  capacity?: Record<string, unknown>;
  gauge?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return { capacity, gauge };
}

/** One board row as `handover reconcile --json` emits it, with only what a case varies overridden. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { groomed: true, id: "some-doc", kind: "doc", priority: "p2", ready: true, ...over };
}

/** A reconciliation carrying these ready rows and placements. */
function reconciliationWith({
  ready,
  aligned = [],
  misaligned = [],
  unprioritised = [],
}: {
  ready: readonly Record<string, unknown>[];
  aligned?: readonly Record<string, unknown>[];
  misaligned?: readonly Record<string, unknown>[];
  unprioritised?: readonly Record<string, unknown>[];
}): Record<string, unknown> {
  return { aligned, misaligned, ready, unprioritised };
}

/** A placement of one live session on a row. */
function seat({ id }: { id: string }): Record<string, unknown> {
  return { rank: 1, row: row({ id }), session: "workspace:7" };
}

/** A `spawned` action on a subject. */
function spawned({
  subject,
  outcome = "completed",
}: {
  subject: Record<string, unknown>;
  outcome?: string;
}): Record<string, unknown> {
  return { kind: "spawned", outcome, subject: { label: "a spawn", ...subject } };
}

/** A judgement of a kind on a subject. */
function judgement({ kind, subject }: { kind: string; subject: Record<string, unknown> }): Record<string, unknown> {
  return { kind, subject: { label: "a subject", ...subject } };
}

/** The one-ready-p2-doc reconciliation most cases start from. */
const ONE_DOC = reconciliationWith({ ready: [row({ id: "the-doc" })] });

/** A refusal from a capture that measured no working-seat ceiling: every fill field `null`, never guessed. */
const NO_SEAT_CEILING = {
  ceilingMeasurementProblem: null,
  seatsOwed: null,
  workingSeatCeiling: null,
  workingSeats: null,
} as const;

/** The legacy refusal a capture with no ceilings produces: no binding ceiling, no reading. */
const NO_CEILINGS = { ...NO_SEAT_CEILING, bindingCeilingId: null, ceilings: null } as const;

describe("judgeIdleCapacity", () => {
  it("refuses a free machine that left a groomed ready p2 doc with nobody on it and no reason", () => {
    expect(
      judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources: sourcesWith() }),
    ).toStrictEqual({
      ...NO_CEILINGS,
      kind: "refused",
      load1: 3.77,
      rows: [{ id: "the-doc", priority: "p2" }],
      workspaceSpawns: 0,
    });
  });

  it("passes a tick whose machine held on cpu", () => {
    const sources = sourcesWith({ capacity: { facts: facts({ hold: true, holdSubjects: ["cpu"] }), status: "read" } });

    expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources })).toStrictEqual({
      kind: "clean",
    });
  });

  it("passes a boots-only hold — unlike the load gate, because a hold of any kind holds every spawn", () => {
    const sources = sourcesWith({
      capacity: { facts: facts({ hold: true, holdSubjects: ["boots"] }), status: "read" },
    });

    expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources })).toStrictEqual({
      kind: "clean",
    });
  });

  it("passes a tick whose gauge says no plan can take an all-models spawn — Ceiling A, measured", () => {
    const sources = sourcesWith({ gauge: { facts: { nextAllModels: null, nextFable: null }, status: "read" } });

    expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources })).toStrictEqual({
      kind: "clean",
    });
  });

  it("still refuses when only Fable is spent — a pinned Opus or Sonnet seat still routes", () => {
    const sources = sourcesWith({ gauge: { facts: { nextAllModels: "plan-four", nextFable: null }, status: "read" } });

    expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources }).kind).toBe("refused");
  });

  it("still refuses when the gauge was never read — an unread gauge clears nothing", () => {
    const sources = sourcesWith({ gauge: { diagnostic: "no login", status: "unavailable" } });

    expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources }).kind).toBe("refused");
  });

  it("leaves out a row a live seat is on, from each of the three placement lists", () => {
    const reconciliation = reconciliationWith({
      aligned: [seat({ id: "aligned-doc" })],
      misaligned: [seat({ id: "misaligned-doc" })],
      ready: [row({ id: "aligned-doc" }), row({ id: "misaligned-doc" }), row({ id: "unprioritised-doc" })],
      unprioritised: [seat({ id: "unprioritised-doc" })],
    });

    expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation, sources: sourcesWith() })).toStrictEqual({
      kind: "clean",
    });
  });

  it("answers a row with a COMPLETED spawn naming it, and only that", () => {
    const actions = [spawned({ subject: { id: "the-doc", kind: "handover" } })];

    expect(
      judgeIdleCapacity({ actions, judgements: [], reconciliation: ONE_DOC, sources: sourcesWith() }),
    ).toStrictEqual({ kind: "clean" });
  });

  it("does not count a FAILED spawn — it seated nobody", () => {
    const actions = [spawned({ outcome: "failed", subject: { id: "the-doc", kind: "handover" } })];

    expect(
      judgeIdleCapacity({ actions, judgements: [], reconciliation: ONE_DOC, sources: sourcesWith() }),
    ).toStrictEqual({
      ...NO_CEILINGS,
      kind: "refused",
      load1: 3.77,
      rows: [{ id: "the-doc", priority: "p2" }],
      workspaceSpawns: 0,
    });
  });

  it("counts a spawn that names a WORKSPACE rather than a row, and answers no row with it", () => {
    const actions = [spawned({ subject: { id: "workspace:248", kind: "session" } })];

    expect(
      judgeIdleCapacity({ actions, judgements: [], reconciliation: ONE_DOC, sources: sourcesWith() }),
    ).toStrictEqual({
      ...NO_CEILINGS,
      kind: "refused",
      load1: 3.77,
      rows: [{ id: "the-doc", priority: "p2" }],
      workspaceSpawns: 1,
    });
  });

  it("answers a row with a hold-rationale naming it", () => {
    const judgements = [judgement({ kind: "hold-rationale", subject: { id: "the-doc", kind: "handover" } })];

    expect(
      judgeIdleCapacity({ actions: [], judgements, reconciliation: ONE_DOC, sources: sourcesWith() }),
    ).toStrictEqual({ kind: "clean" });
  });

  it("is NOT answered by an outcome, all-outcomes or machine rationale, nor by another kind of judgement", () => {
    // The incident's own shape: two outcome rationales copied from tick to tick while 31 rows sat ready.
    const judgements = [
      judgement({ kind: "hold-rationale", subject: { id: "gcp-backups", kind: "outcome" } }),
      judgement({ kind: "hold-rationale", subject: { id: "all-outcomes", kind: "outcome" } }),
      judgement({ kind: "hold-rationale", subject: { id: "machine", kind: "machine" } }),
      judgement({ kind: "priority-call", subject: { id: "the-doc", kind: "handover" } }),
    ];

    expect(
      judgeIdleCapacity({ actions: [], judgements, reconciliation: ONE_DOC, sources: sourcesWith() }),
    ).toStrictEqual({
      ...NO_CEILINGS,
      kind: "refused",
      load1: 3.77,
      rows: [{ id: "the-doc", priority: "p2" }],
      workspaceSpawns: 0,
    });
  });

  it("owes a seat to groomed p0–p2 DOCS and ASKS, never a tag, and keeps the reconciliation's rank order", () => {
    const reconciliation = reconciliationWith({
      ready: [
        row({ id: "urgent-doc", priority: "p0" }),
        row({ id: "land-slopweaver-1977-4ddf33f", kind: "ask", priority: "p1" }),
        row({ id: "an-ask", kind: "ask", priority: "p1" }),
        row({ id: "a-tag", kind: "tag", priority: "p0" }),
        row({ id: "placed-p1", priority: "p1" }),
        row({ id: "low-doc", priority: "p3" }),
        row({ id: "low-ask", kind: "ask", priority: "p3" }),
        row({ groomed: false, id: "unplaced-doc", priority: "p2" }),
        row({ id: "placed-p2", priority: "p2" }),
      ],
    });

    expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation, sources: sourcesWith() })).toStrictEqual({
      ...NO_CEILINGS,
      kind: "refused",
      load1: 3.77,
      rows: [
        { id: "urgent-doc", priority: "p0" },
        { id: "land-slopweaver-1977-4ddf33f", priority: "p1" },
        { id: "an-ask", priority: "p1" },
        { id: "placed-p1", priority: "p1" },
        { id: "placed-p2", priority: "p2" },
      ],
      workspaceSpawns: 0,
    });
  });

  it("answers an ask exactly as a doc: a completed spawn or a row-named reason clears it", () => {
    const reconciliation = reconciliationWith({
      ready: [
        row({ id: "land-slopweaver-1977-4ddf33f", kind: "ask", priority: "p1" }),
        row({ id: "named-ask", kind: "ask", priority: "p1" }),
      ],
    });

    expect(
      judgeIdleCapacity({
        actions: [spawned({ subject: { id: "land-slopweaver-1977-4ddf33f", kind: "handover" } })],
        judgements: [judgement({ kind: "hold-rationale", subject: { id: "named-ask", kind: "handover" } })],
        reconciliation,
        sources: sourcesWith(),
      }),
    ).toStrictEqual({ kind: "clean" });
  });

  it("passes an EMPTY ready list — nothing startable is a real board state, not an unread one", () => {
    const reconciliation = reconciliationWith({ ready: [] });

    expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation, sources: sourcesWith() })).toStrictEqual({
      kind: "clean",
    });
  });

  it("judges capacity FIRST — a held tick is clean over a reconciliation it could not read", () => {
    const sources = sourcesWith({ capacity: { facts: facts({ hold: true, holdSubjects: ["cpu"] }), status: "read" } });

    expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: {}, sources })).toStrictEqual({
      kind: "clean",
    });
  });

  describe("with a ceilings reading, a reason must name the row AND the binding ceiling", () => {
    /** A capture whose ceilings bind on `claude:plan-one` at 20% headroom, or whose one plan is spent. */
    function ceilingSources({ selected = true }: { selected?: boolean } = {}): Record<string, unknown> {
      const route = {
        driver: "claude",
        headroom: 0.2,
        limitingCeilingId: "claude:plan-one",
        planCeilingId: "claude:plan-one",
      };
      const ceilings = {
        ceilings: [
          {
            headroom: 0.83,
            id: "machine",
            kind: "machine",
            reason: null,
            status: "open",
            windows: [{ available: 22, resetAtIso: null, used: 3.77, window: "load1" }],
          },
          {
            headroom: selected ? 0.2 : 0,
            id: "claude:plan-one",
            kind: "claude",
            reason: selected ? null : "seven_day refused",
            status: selected ? "open" : "refusing",
            windows: [{ available: 100, resetAtIso: "2026-10-01T00:00:00.000Z", used: 80, window: "seven-day" }],
          },
        ],
        lowest: selected ? "claude:plan-one" : null,
        observedAtIso: "2026-09-28T09:00:00.000Z",
        problems: [],
        routes: selected ? [route] : [],
        selectedRoute: selected ? route : null,
      };
      return sourcesWith({ capacity: { facts: facts({ ceilings }), status: "read" } });
    }

    /** A hold-rationale on the doc, with these related subjects. */
    function rationale({ related }: { related?: readonly Record<string, unknown>[] }): Record<string, unknown> {
      const base = judgement({ kind: "hold-rationale", subject: { id: "the-doc", kind: "handover" } });
      return related === undefined ? base : { ...base, relatedSubjects: related };
    }

    it("refuses a row-only reason, naming the binding ceiling and carrying the reading", () => {
      const sources = ceilingSources();
      const verdict = judgeIdleCapacity({
        actions: [],
        judgements: [rationale({})],
        reconciliation: ONE_DOC,
        sources,
      });

      expect(verdict).toStrictEqual({
        ...NO_SEAT_CEILING,
        bindingCeilingId: "claude:plan-one",
        ceilings: (sources["capacity"] as { facts: { ceilings: unknown } }).facts.ceilings,
        kind: "refused",
        load1: 3.77,
        rows: [{ id: "the-doc", priority: "p2" }],
        workspaceSpawns: 0,
      });
    });

    it("answers the row with a reason naming it AND the binding ceiling", () => {
      const judgements = [rationale({ related: [{ id: "claude:plan-one", kind: "ceiling", label: "week at 80%" }] })];

      expect(
        judgeIdleCapacity({ actions: [], judgements, reconciliation: ONE_DOC, sources: ceilingSources() }),
      ).toStrictEqual({ kind: "clean" });
    });

    it("does not answer with a reason naming a ceiling that does not bind", () => {
      const judgements = [rationale({ related: [{ id: "machine", kind: "ceiling", label: "load" }] })];

      expect(
        judgeIdleCapacity({ actions: [], judgements, reconciliation: ONE_DOC, sources: ceilingSources() }).kind,
      ).toBe("refused");
    });

    it("does not answer with a reason naming only the ceiling", () => {
      const judgements = [judgement({ kind: "hold-rationale", subject: { id: "claude:plan-one", kind: "ceiling" } })];

      expect(
        judgeIdleCapacity({ actions: [], judgements, reconciliation: ONE_DOC, sources: ceilingSources() }).kind,
      ).toBe("refused");
    });

    it("still answers the row with a completed spawn, which needs no ceiling", () => {
      const actions = [spawned({ subject: { id: "the-doc", kind: "handover" } })];

      expect(
        judgeIdleCapacity({ actions, judgements: [], reconciliation: ONE_DOC, sources: ceilingSources() }),
      ).toStrictEqual({ kind: "clean" });
    });

    it("passes a tick where every route through a plan is measured spent", () => {
      expect(
        judgeIdleCapacity({
          actions: [],
          judgements: [],
          reconciliation: ONE_DOC,
          sources: ceilingSources({ selected: false }),
        }),
      ).toStrictEqual({ kind: "clean" });
    });

    it("lets the ceilings replace the gauge — a gauge naming no plan does not clear an open route", () => {
      const sources = {
        ...ceilingSources(),
        gauge: { facts: { nextAllModels: null, nextFable: null }, status: "read" },
      };

      expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources }).kind).toBe("refused");
    });

    it("refuses as unreadable a top-level hold its ceilings' open machine contradicts — never picks one", () => {
      const open = ceilingSources();
      const ceilings = (open["capacity"] as { facts: { ceilings: unknown } }).facts.ceilings;
      const sources = sourcesWith({
        capacity: { facts: facts({ ceilings, hold: true, holdSubjects: ["cpu"] }), status: "read" },
      });
      const verdict = judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources });

      expect(verdict.kind).toBe("unreadable");
      expect((verdict as { why: string }).why).toContain("says the machine is held where its ceilings say it is not");
    });

    it("refuses as unreadable a ceiling whose status contradicts its headroom", () => {
      const open = ceilingSources();
      const reading = (open["capacity"] as { facts: { ceilings: { ceilings: Record<string, unknown>[] } } }).facts
        .ceilings;
      const ceilings = {
        ...reading,
        ceilings: [reading.ceilings[0], { ...reading.ceilings[1], headroom: 0, status: "unreadable" }],
      };
      const sources = sourcesWith({ capacity: { facts: facts({ ceilings }), status: "read" } });
      const verdict = judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources });

      expect(verdict.kind).toBe("unreadable");
      expect((verdict as { why: string }).why).toContain("claude:plan-one: status unreadable with headroom 0");
    });

    it("refuses as unreadable a PRESENT ceilings key whose value is undefined — never an older capture", () => {
      const sources = sourcesWith({
        capacity: { facts: facts({ ceilings: undefined, hold: true, holdSubjects: ["cpu"] }), status: "read" },
      });

      expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources }).kind).toBe(
        "unreadable",
      );
    });

    it("refuses as unreadable a malformed ceilings reading even on a held tick", () => {
      const sources = sourcesWith({
        capacity: { facts: facts({ ceilings: { lowest: 7 }, hold: true, holdSubjects: ["cpu"] }), status: "read" },
      });

      expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources }).kind).toBe(
        "unreadable",
      );
    });

    it("refuses as unreadable a ceilings reading that does not parse", () => {
      const sources = sourcesWith({ capacity: { facts: facts({ ceilings: { lowest: 7 } }), status: "read" } });
      const verdict = judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources });

      expect(verdict.kind).toBe("unreadable");
      expect((verdict as { why: string }).why).toContain(
        "the draft's capacity observation carries ceilings that do not parse",
      );
    });
  });

  describe("with a measured working-seat ceiling, the first N − working unseated rows are owed a seat", () => {
    /** A watch reading with this many working seats and two more waiting on the owner. */
    function watchWith({ working }: { working: number }): Record<string, unknown> {
      const rows = [
        ...Array.from({ length: working }, (_, index) => ({
          on: "a doc",
          session: `w${String(index)}`,
          state: "working",
        })),
        { on: "a doc", session: "waiting-1", state: "needs-input" },
        { on: "a doc", session: "waiting-2", state: "idle" },
      ];
      return { facts: { rows, suppressed: 0 }, status: "read" };
    }

    /** Sources carrying a seat ceiling, a watch and the usual open gauge. */
    function fillSources({
      ceiling,
      working = 1,
      watch = watchWith({ working }),
    }: {
      ceiling: unknown;
      working?: number;
      watch?: Record<string, unknown>;
    }): Record<string, unknown> {
      return { ...sourcesWith({ capacity: { facts: facts({ workingSeatCeiling: ceiling }), status: "read" } }), watch };
    }

    /** Five ranked ready docs, nobody on any of them. */
    const FIVE_DOCS = reconciliationWith({
      ready: ["first", "second", "third", "fourth", "fifth"].map((id) => row({ id })),
    });

    /** The refusal below a measured ceiling of 4 with 1 working: three seats owed. */
    const OWED_THREE = {
      bindingCeilingId: null,
      ceilingMeasurementProblem: null,
      ceilings: null,
      kind: "refused",
      load1: 3.77,
      seatsOwed: 3,
      workingSeatCeiling: 4,
      workingSeats: 1,
      workspaceSpawns: 0,
    } as const;

    it("owes exactly the first N − working rows, in rank order, and no more", () => {
      const verdict = judgeIdleCapacity({
        actions: [],
        judgements: [],
        reconciliation: FIVE_DOCS,
        sources: fillSources({ ceiling: { kind: "measured", seats: 4 } }),
      });

      expect(verdict).toStrictEqual({
        ...OWED_THREE,
        rows: [
          { id: "first", priority: "p2" },
          { id: "second", priority: "p2" },
          { id: "third", priority: "p2" },
        ],
      });
    });

    it("owes the free seat to a ready landing DISPATCH row ranked first", () => {
      // `github landing --register` writes `kind: ask`; before asks were owed, this tick passed tick close.
      const reconciliation = reconciliationWith({
        ready: [
          row({ id: "land-slopweaver-1977-4ddf33f", kind: "ask", priority: "p1" }),
          row({ id: "some-doc", priority: "p2" }),
        ],
      });

      expect(
        judgeIdleCapacity({
          actions: [],
          judgements: [],
          reconciliation,
          sources: fillSources({ ceiling: { kind: "measured", seats: 2 } }),
        }),
      ).toStrictEqual({
        ...OWED_THREE,
        rows: [{ id: "land-slopweaver-1977-4ddf33f", priority: "p1" }],
        seatsOwed: 1,
        workingSeatCeiling: 2,
      });
    });

    it("is clean once the working seats reach the ceiling, over a reconciliation it never had to read", () => {
      expect(
        judgeIdleCapacity({
          actions: [],
          judgements: [],
          reconciliation: {},
          sources: fillSources({ ceiling: { kind: "measured", seats: 4 }, working: 4 }),
        }),
      ).toStrictEqual({ kind: "clean" });
    });

    it("counts only WORKING seats toward the fill — a seat waiting on the owner draws nothing", () => {
      const verdict = judgeIdleCapacity({
        actions: [],
        judgements: [],
        reconciliation: FIVE_DOCS,
        sources: fillSources({ ceiling: { kind: "measured", seats: 2 }, working: 0 }),
      });

      expect(verdict).toStrictEqual({
        ...OWED_THREE,
        rows: [
          { id: "first", priority: "p2" },
          { id: "second", priority: "p2" },
        ],
        seatsOwed: 2,
        workingSeatCeiling: 2,
        workingSeats: 0,
      });
    });

    it("still passes a machine hold, which no seat ceiling overrides", () => {
      const sources = {
        ...fillSources({ ceiling: { kind: "measured", seats: 4 } }),
        capacity: {
          facts: facts({ hold: true, holdSubjects: ["boots"], workingSeatCeiling: { kind: "measured", seats: 4 } }),
          status: "read",
        },
      };

      expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: FIVE_DOCS, sources })).toStrictEqual({
        kind: "clean",
      });
    });

    it("clears an owed row with a completed spawn on it, and a spawn of a LOWER row clears nothing above it", () => {
      const actions = [
        spawned({ subject: { id: "second", kind: "handover" } }),
        spawned({ subject: { id: "fifth", kind: "handover" } }),
      ];

      expect(
        judgeIdleCapacity({
          actions,
          judgements: [],
          reconciliation: FIVE_DOCS,
          sources: fillSources({ ceiling: { kind: "measured", seats: 4 } }),
        }),
      ).toStrictEqual({
        ...OWED_THREE,
        rows: [
          { id: "first", priority: "p2" },
          { id: "third", priority: "p2" },
        ],
      });
    });

    it("does not let a plain or a Claude-ceiling rationale answer below the ceiling, and does let a machine one", () => {
      const onRow = ({ id, related }: { id: string; related?: readonly Record<string, unknown>[] }) => ({
        ...judgement({ kind: "hold-rationale", subject: { id, kind: "handover" } }),
        ...(related === undefined ? {} : { relatedSubjects: related }),
      });
      const judgements = [
        onRow({ id: "first" }),
        onRow({ id: "second", related: [{ id: "claude:plan-one", kind: "ceiling", label: "week" }] }),
        onRow({ id: "third", related: [{ id: "machine", kind: "ceiling", label: "boots held mid-tick" }] }),
      ];

      expect(
        judgeIdleCapacity({
          actions: [],
          judgements,
          reconciliation: FIVE_DOCS,
          sources: fillSources({ ceiling: { kind: "measured", seats: 4 } }),
        }),
      ).toStrictEqual({
        ...OWED_THREE,
        rows: [
          { id: "first", priority: "p2" },
          { id: "second", priority: "p2" },
        ],
      });
    });

    it("clears a row that left ready in the re-read reconciliation, and owes the next one in its place", () => {
      const reconciliation = reconciliationWith({
        ready: ["second", "third", "fourth", "fifth"].map((id) => row({ id })),
      });

      expect(
        judgeIdleCapacity({
          actions: [],
          judgements: [],
          reconciliation,
          sources: fillSources({ ceiling: { kind: "measured", seats: 4 } }),
        }),
      ).toStrictEqual({
        ...OWED_THREE,
        rows: [
          { id: "second", priority: "p2" },
          { id: "third", priority: "p2" },
          { id: "fourth", priority: "p2" },
        ],
      });
    });

    it("runs the legacy predicate on an UNMEASURABLE ceiling and carries its reason, claiming no number", () => {
      const verdict = judgeIdleCapacity({
        actions: [],
        judgements: [],
        reconciliation: ONE_DOC,
        sources: fillSources({ ceiling: { kind: "unmeasurable", reason: "no seat was working while read" } }),
      });

      expect(verdict).toStrictEqual({
        ...NO_CEILINGS,
        ceilingMeasurementProblem: "no seat was working while read",
        kind: "refused",
        load1: 3.77,
        rows: [{ id: "the-doc", priority: "p2" }],
        workspaceSpawns: 0,
      });
    });

    it("refuses as unreadable a measured ceiling with no watch rows to count the fill against", () => {
      expect(
        judgeIdleCapacity({
          actions: [],
          judgements: [],
          reconciliation: FIVE_DOCS,
          sources: fillSources({
            ceiling: { kind: "measured", seats: 4 },
            watch: { diagnostic: "cmux down", status: "unavailable" },
          }),
        }),
      ).toStrictEqual({
        kind: "unreadable",
        why: "the draft's watch observation carries no session rows, so the fill against the measured seat ceiling is unread",
      });
    });

    it("refuses as unreadable a seat ceiling that is neither a whole count nor a reason", () => {
      expect(
        judgeIdleCapacity({
          actions: [],
          judgements: [],
          reconciliation: FIVE_DOCS,
          sources: fillSources({ ceiling: { kind: "measured", seats: 2.5 } }),
        }),
      ).toStrictEqual({
        kind: "unreadable",
        why: "the draft's capacity observation carries a workingSeatCeiling that is neither a whole seat count nor a reason",
      });
    });
  });

  describe("refuses as unreadable when it cannot see", () => {
    it.each([
      [{}, "the draft carries no capacity observation at all"],
      [
        { capacity: { diagnostic: "timed out", status: "unavailable" } },
        'the draft\'s capacity observation is "unavailable", so this tick never read whether the machine could take another session',
      ],
      [
        { capacity: { facts: {}, status: "" } },
        'the draft\'s capacity observation is "malformed", so this tick never read whether the machine could take another session',
      ],
      [
        { capacity: { facts: { load1: 3 }, status: "read" } },
        "the draft's capacity observation carries no `hold` reading",
      ],
      [
        { capacity: { facts: { hold: false }, status: "partial" } },
        "the draft's capacity observation carries no `load1` reading",
      ],
    ])("the capacity reading %#", (sources, why) => {
      expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation: ONE_DOC, sources })).toStrictEqual({
        kind: "unreadable",
        why,
      });
    });

    it.each([
      [
        { aligned: [], misaligned: [], unprioritised: [] },
        "the reconciliation carries no `ready` list — re-run `slopweaver handover reconcile --json` with this checkout",
      ],
      [
        { aligned: [], ready: [], unprioritised: [] },
        "the reconciliation carries no `misaligned` placement, so which ready rows already have a seat cannot be read",
      ],
      [
        reconciliationWith({ ready: [row({ id: 7 })] }),
        "the reconciliation's ready[0] is not a board row with a string id and kind, a p0–p3 priority and a boolean groomed",
      ],
      [
        reconciliationWith({ ready: [row(), row({ priority: "p9" })] }),
        "the reconciliation's ready[1] is not a board row with a string id and kind, a p0–p3 priority and a boolean groomed",
      ],
      [
        reconciliationWith({ aligned: [{ session: "workspace:7" }], ready: [row()] }),
        "the reconciliation's aligned[0] carries no row id",
      ],
    ])("the reconciliation %#", (reconciliation, why) => {
      expect(judgeIdleCapacity({ actions: [], judgements: [], reconciliation, sources: sourcesWith() })).toStrictEqual({
        kind: "unreadable",
        why,
      });
    });
  });
});
