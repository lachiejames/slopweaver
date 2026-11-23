/**
 * {@link measureJournal} per CYCLE — what a run-journal finding measurably cost the owner in rewritten and dropped runs.
 *
 * A card that says only "a brief was amended eleven times" cannot be graded; it has to lead
 * with the impact. These pin the measurement that impact is built from: per cycle, never per file. A question's wait
 * is `questionWait.test.ts`; the sentences are `journalConsequenceText.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { measureJournal } from "../../../reflect/runJournalConsequences.js";

const window = { fromIso: "2026-11-05T00:00:00.000Z", toIso: "2026-11-06T00:00:00.000Z" };

const started = ({ atIso }: { atIso: string }): RunEvent => ({ atIso, branch: "b", docHash: "h", kind: "started" });
const amended = ({ atIso }: { atIso: string }): RunEvent => ({ atIso, docHash: "h", kind: "amended", why: "scope" });
const closed = ({ atIso }: { atIso: string }): RunEvent => ({ atIso, kind: "closed", residue: [], summary: "shipped" });
const abandoned = ({ atIso }: { atIso: string }): RunEvent => ({ atIso, kind: "abandoned", why: "superseded" });

describe("measureJournal", () => {
  it("measures a rewritten cycle that closed in the window, start to close, keyed to the amendment's position", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      amended({ atIso: "2026-11-05T02:00:00.000Z" }),
      closed({ atIso: "2026-11-05T10:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect(measures.amendments.get(1)).toStrictEqual({ abandoned: false, completedHours: 9, cycleId: "row#0" });
    expect(measures.completed).toStrictEqual([{ amended: true, cycleId: "row#0", elapsedHours: 9 }]);
  });

  it("splits a journal into cycles at each `started`, so one cycle's rewrite is never charged to another", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      closed({ atIso: "2026-11-05T03:00:00.000Z" }),
      started({ atIso: "2026-11-05T04:00:00.000Z" }),
      amended({ atIso: "2026-11-05T05:00:00.000Z" }),
      abandoned({ atIso: "2026-11-05T06:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect(measures.completed).toStrictEqual([{ amended: false, cycleId: "row#0", elapsedHours: 2 }]);
    expect(measures.amendments.get(3)).toStrictEqual({ abandoned: true, completedHours: undefined, cycleId: "row#1" });
  });

  it("never counts a cycle rewritten BEFORE the window as one left alone", () => {
    const events = [
      started({ atIso: "2026-11-04T20:00:00.000Z" }),
      amended({ atIso: "2026-11-04T21:00:00.000Z" }),
      closed({ atIso: "2026-11-05T00:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect(measures.completed).toStrictEqual([{ amended: true, cycleId: "row#0", elapsedHours: 4 }]);
    expect(measures.amendments.size).toBe(0);
  });

  it("never measures an amendment appended after its cycle ended as a mid-run rewrite", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      abandoned({ atIso: "2026-11-05T02:00:00.000Z" }),
      amended({ atIso: "2026-11-05T03:00:00.000Z" }),
    ];
    expect(measureJournal({ events, slug: "row", window }).amendments.size).toBe(0);
  });

  it("never measures an amendment timestamped before its run started as a mid-run rewrite", () => {
    const events = [
      started({ atIso: "2026-11-05T10:00:00.000Z" }),
      amended({ atIso: "2026-11-05T09:00:00.000Z" }),
      abandoned({ atIso: "2026-11-05T11:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([measures.amendments.size, measures.unmeasurable]).toStrictEqual([0, 1]);
  });

  it("keeps a run whose amendment is out of clock order out of the left-alone cohort", () => {
    const events = [
      started({ atIso: "2026-11-05T10:00:00.000Z" }),
      amended({ atIso: "2026-11-05T09:00:00.000Z" }),
      closed({ atIso: "2026-11-05T12:00:00.000Z" }),
    ];
    expect(measureJournal({ events, slug: "row", window }).completed).toStrictEqual([
      { amended: true, cycleId: "row#0", elapsedHours: 2 },
    ]);
  });

  it("keeps a run amended only after it closed in the left-alone cohort", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      closed({ atIso: "2026-11-05T03:00:00.000Z" }),
      amended({ atIso: "2026-11-05T04:00:00.000Z" }),
    ];
    expect(measureJournal({ events, slug: "row", window }).completed).toStrictEqual([
      { amended: false, cycleId: "row#0", elapsedHours: 2 },
    ]);
  });

  it("never reads an abandonment as dropped work when the same cycle later closed, which records it shipped", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      amended({ atIso: "2026-11-05T01:30:00.000Z" }),
      abandoned({ atIso: "2026-11-05T02:00:00.000Z" }),
      closed({ atIso: "2026-11-05T03:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([...measures.abandonedEnds.entries()]).toStrictEqual([]);
    expect(measures.amendments.get(1)!.abandoned).toBe(false);
  });

  it("keys only the abandonment that ENDED its cycle, so a duplicate line is never a second dropped run", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      abandoned({ atIso: "2026-11-05T02:00:00.000Z" }),
      abandoned({ atIso: "2026-11-05T03:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([...measures.abandonedEnds.entries()]).toStrictEqual([[1, { cycleId: "row#0" }]]);
  });

  it("never reads an amendment as mid-run when its run's start is stamped at an unreadable instant", () => {
    const events = [
      started({ atIso: "not-an-instant" }),
      amended({ atIso: "2026-11-05T02:00:00.000Z" }),
      abandoned({ atIso: "2026-11-05T03:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect(measures.amendments.size).toBe(0);
    expect(measures.unmeasurable).toBe(1);
  });

  it("never reads an abandonment or an amendment in a cycle no `started` opened as a run dropped or rewritten", () => {
    const events = [amended({ atIso: "2026-11-05T01:00:00.000Z" }), abandoned({ atIso: "2026-11-05T02:00:00.000Z" })];
    const measures = measureJournal({ events, slug: "row", window });
    expect([[...measures.abandonedEnds.entries()], [...measures.amendments.entries()]]).toStrictEqual([[], []]);
  });

  it("ends a cycle at an orphan, so a later abandonment drops nothing and the orphaned run is neither finished nor dropped", () => {
    const events: RunEvent[] = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      amended({ atIso: "2026-11-05T02:00:00.000Z" }),
      {
        atIso: "2026-11-05T03:00:00.000Z",
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-11-05T02:00:00.000Z",
      },
      abandoned({ atIso: "2026-11-05T04:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([...measures.abandonedEnds.entries()]).toStrictEqual([]);
    expect([...measures.amendments.entries()]).toStrictEqual([
      [1, { abandoned: false, completedHours: undefined, cycleId: "row#0" }],
    ]);
    expect(measures.completed).toStrictEqual([]);
  });

  it("counts a backwards span as unmeasurable rather than a zero-hour run", () => {
    const events = [started({ atIso: "2026-11-05T10:00:00.000Z" }), closed({ atIso: "2026-11-05T09:00:00.000Z" })];
    const measures = measureJournal({ events, slug: "row", window });
    expect(measures.completed).toStrictEqual([]);
    expect(measures.unmeasurable).toBe(1);
  });
});
