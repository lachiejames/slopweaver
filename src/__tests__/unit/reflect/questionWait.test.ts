/**
 * How long a question kept work waiting on the owner's answer — `questionWait.ts`, read through {@link measureJournal}: the
 * clock a live run held it on, paused at a death and resumed at the restart that carries it. Which event settles it is
 * `questionSettle.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { hoursBetween } from "../../../reflect/questionWait.js";
import { measureJournal } from "../../../reflect/runJournalConsequences.js";

const window = { fromIso: "2026-11-05T00:00:00.000Z", toIso: "2026-11-06T00:00:00.000Z" };

const started = ({ atIso }: { atIso: string }): RunEvent => ({ atIso, branch: "b", docHash: "h", kind: "started" });
const closed = ({ atIso }: { atIso: string }): RunEvent => ({ atIso, kind: "closed", residue: [], summary: "shipped" });
const question = ({ atIso }: { atIso: string }): RunEvent => ({ atIso, kind: "question", question: "which PR?" });
const answered = ({ atIso }: { atIso: string }): RunEvent => ({ answer: "the first", atIso, kind: "answered" });
/** The events as one live run opened at the window's start, so a question in them is one a run held. */
const inRun = ({ events }: { events: readonly RunEvent[] }): RunEvent[] => [
  started({ atIso: window.fromIso }),
  ...events,
];

describe("hoursBetween", () => {
  it("reads the hours between two instants, and none for a backwards span or an unreadable instant", () => {
    expect(hoursBetween({ fromIso: "2026-11-05T10:00:00.000Z", toIso: "2026-11-05T11:30:00.000Z" })).toBe(1.5);
    expect(hoursBetween({ fromIso: "2026-11-05T11:00:00.000Z", toIso: "2026-11-05T10:00:00.000Z" })).toBeUndefined();
    expect(hoursBetween({ fromIso: "not a time", toIso: "2026-11-05T10:00:00.000Z" })).toBeUndefined();
  });
});

describe("measureJournal question waits", () => {
  it("never measures a question appended after its cycle ended as work waiting on the owner", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      closed({ atIso: "2026-11-05T02:00:00.000Z" }),
      question({ atIso: "2026-11-05T03:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect(measures.questions.size).toBe(0);
    expect(measures.unmeasurable).toBe(0);
  });

  it("measures a question asked while the run was dead from the re-start that carries it, as the board's fold carries it", () => {
    const events: RunEvent[] = [
      started({ atIso: "2026-11-05T00:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        atIso: "2026-11-05T02:00:00.000Z",
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-11-05T01:00:00.000Z",
      },
      question({ atIso: "2026-11-05T03:00:00.000Z" }),
      started({ atIso: "2026-11-05T04:00:00.000Z" }),
      answered({ atIso: "2026-11-05T05:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([...measures.questions.entries()]).toStrictEqual([
      [1, { openAtWindowEnd: false, waitHours: 1 }],
      [3, { openAtWindowEnd: false, waitHours: 1 }],
    ]);
    expect(measures.unmeasurable).toBe(0);
  });

  it("counts a wait unmeasurable when a re-start is stamped before the orphan it follows, never overlapping stretches", () => {
    const events: RunEvent[] = [
      started({ atIso: "2026-11-05T00:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        atIso: "2026-11-05T10:00:00.000Z",
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-11-05T01:00:00.000Z",
      },
      started({ atIso: "2026-11-05T05:00:00.000Z" }),
      answered({ atIso: "2026-11-05T06:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([measures.questions.size, measures.unmeasurable]).toStrictEqual([0, 1]);
  });

  it("counts a wait unmeasurable when an orphan appended before the answer is stamped after it, never clipped to it", () => {
    const events: RunEvent[] = [
      started({ atIso: "2026-11-05T00:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        atIso: "2026-11-05T10:00:00.000Z",
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-11-05T01:00:00.000Z",
      },
      answered({ atIso: "2026-11-05T05:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([measures.questions.size, measures.unmeasurable]).toStrictEqual([0, 1]);
  });

  it("counts a wait unmeasurable when a correction appended before the answer is stamped after it", () => {
    const events: RunEvent[] = [
      started({ atIso: "2026-11-05T00:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      { atIso: "2026-11-05T10:00:00.000Z", kind: "question-corrected", question: "which PR, #1 or #2?", why: "typo" },
      answered({ atIso: "2026-11-05T05:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([measures.questions.size, measures.unmeasurable]).toStrictEqual([0, 1]);
  });

  it("counts a wait unmeasurable when two lines between the ask and the answer are stamped against their append order", () => {
    const events: RunEvent[] = [
      started({ atIso: "2026-11-05T00:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      { atIso: "2026-11-05T04:00:00.000Z", kind: "question-corrected", question: "which PR, #1?", why: "typo" },
      { atIso: "2026-11-05T03:00:00.000Z", kind: "question-corrected", question: "which PR, #1 or #2?", why: "typo" },
      answered({ atIso: "2026-11-05T05:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([measures.questions.size, measures.unmeasurable]).toStrictEqual([0, 1]);
  });

  it("clips a live stretch at the window's end when the orphan that ends it falls after the window", () => {
    const events: RunEvent[] = [
      started({ atIso: "2026-11-05T00:00:00.000Z" }),
      question({ atIso: "2026-11-05T20:00:00.000Z" }),
      {
        atIso: "2026-11-06T03:00:00.000Z",
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-11-05T20:00:00.000Z",
      },
    ];
    expect(measureJournal({ events, slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: true,
      waitHours: 4,
    });
  });

  it("counts a question appended after its run closed but stamped before the close as unmeasurable", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      closed({ atIso: "2026-11-05T05:00:00.000Z" }),
      question({ atIso: "2026-11-05T03:00:00.000Z" }),
      started({ atIso: "2026-11-05T06:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([measures.questions.size, measures.unmeasurable]).toStrictEqual([0, 1]);
  });

  it("measures a question asked mid-run in a cycle that later ended", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      question({ atIso: "2026-11-05T02:00:00.000Z" }),
      closed({ atIso: "2026-11-05T05:00:00.000Z" }),
    ];
    expect(measureJournal({ events, slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 3,
    });
  });

  it("counts a question stamped before its run started as unmeasurable, never a wait measured from outside the run", () => {
    const events = [
      started({ atIso: "2026-11-05T10:00:00.000Z" }),
      question({ atIso: "2026-11-05T09:00:00.000Z" }),
      closed({ atIso: "2026-11-05T11:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect(measures.questions.size).toBe(0);
    expect(measures.unmeasurable).toBe(1);
  });

  it("measures a question's wait to its answer", () => {
    const events = [
      started({ atIso: "2026-11-05T00:30:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      answered({ atIso: "2026-11-05T04:30:00.000Z" }),
    ];
    expect(measureJournal({ events, slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 3.5,
    });
  });

  it("never charges a question asked before any run started as work waiting, as the board carries it into no run", () => {
    const events = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      started({ atIso: "2026-11-05T03:00:00.000Z" }),
      answered({ atIso: "2026-11-05T04:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([measures.questions.size, measures.unmeasurable]).toStrictEqual([0, 1]);
  });

  it("keeps a question OPEN through an orphaned cycle, as openQuestion.ts carries it, but stops the work's wait at the orphan", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        atIso: "2026-11-05T02:00:00.000Z",
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-11-05T01:00:00.000Z",
      },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: true,
      waitHours: 1,
    });
  });

  it("counts a wait settled at an unparseable instant as unmeasurable, never as still open", () => {
    for (const atIso of ["not-an-instant", "2026-11-04T25:00:00Z", "2026-02-30T12:00:00Z"]) {
      const events = [question({ atIso: "2026-11-05T01:00:00.000Z" }), answered({ atIso })];
      const measures = measureJournal({ events: inRun({ events }), slug: "row", window });
      expect(measures.questions.size).toBe(0);
      expect(measures.unmeasurable).toBe(1);
    }
  });

  it("reads an offset-form answer as the instant it names, not as text", () => {
    const events = [question({ atIso: "2026-11-05T00:00:00.000Z" }), answered({ atIso: "2026-11-06T01:00:00+02:00" })];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 23,
    });
  });

  it("measures an unanswered question to the window's end and says it was still open", () => {
    const events = [question({ atIso: "2026-11-05T22:00:00.000Z" })];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: true,
      waitHours: 2,
    });
  });

  it("pauses a question's wait while its session is dead and resumes it at the restart that carries it", () => {
    const events: RunEvent[] = [
      started({ atIso: "2026-11-05T00:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        atIso: "2026-11-05T02:00:00.000Z",
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-11-05T01:00:00.000Z",
      },
      started({ atIso: "2026-11-05T03:00:00.000Z" }),
      answered({ atIso: "2026-11-05T10:00:00.000Z" }),
    ];
    expect([...measureJournal({ events, slug: "row", window }).questions.entries()]).toStrictEqual([
      [1, { openAtWindowEnd: false, waitHours: 8 }],
    ]);
  });

  it("runs a question's wait on through a restart, which carries it as openQuestion.ts does, to its answer", () => {
    const events = [
      started({ atIso: "2026-11-05T00:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      started({ atIso: "2026-11-05T02:00:00.000Z" }),
      answered({ atIso: "2026-11-05T10:00:00.000Z" }),
    ];
    expect([...measureJournal({ events, slug: "row", window }).questions.entries()]).toStrictEqual([
      [1, { openAtWindowEnd: false, waitHours: 9 }],
    ]);
  });

  it("reads an identical question asked again after a restart as a NEW question replacing the first", () => {
    const events = [
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      started({ atIso: "2026-11-05T01:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      answered({ atIso: "2026-11-05T03:00:00.000Z" }),
    ];
    expect([...measureJournal({ events, slug: "row", window }).questions.entries()]).toStrictEqual([
      [1, { openAtWindowEnd: false, waitHours: 0 }],
      [3, { openAtWindowEnd: false, waitHours: 2 }],
    ]);
  });

  it("reads a byte-identical question line directly after another as a second question, as the board's fold does", () => {
    const events = [
      started({ atIso: "2026-11-05T00:30:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      answered({ atIso: "2026-11-05T02:00:00.000Z" }),
    ];
    const measures = measureJournal({ events, slug: "row", window });
    expect([...measures.questions.entries()]).toStrictEqual([
      [1, { openAtWindowEnd: false, waitHours: 0 }],
      [2, { openAtWindowEnd: false, waitHours: 1 }],
    ]);
    expect(measures.unmeasurable).toBe(0);
  });
});
