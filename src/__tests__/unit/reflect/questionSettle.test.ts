/**
 * WHICH event settles a question — `questionSettle.ts`, read through {@link measureJournal}'s waits: an answer, a
 * withdrawal of the held text, a new question replacing it, or a ruling the owner made at or after the ask, at its decision.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { settledAt } from "../../../reflect/questionSettle.js";
import { measureJournal } from "../../../reflect/runJournalConsequences.js";

const window = { fromIso: "2026-11-05T00:00:00.000Z", toIso: "2026-11-06T00:00:00.000Z" };

const started = ({ atIso }: { atIso: string }): RunEvent => ({ atIso, branch: "b", docHash: "h", kind: "started" });
const question = ({ atIso }: { atIso: string }): RunEvent => ({ atIso, kind: "question", question: "which PR?" });
const answered = ({ atIso }: { atIso: string }): RunEvent => ({ answer: "the first", atIso, kind: "answered" });
/** The events as one live run opened at the window's start, so a question in them is one a run held. */
const inRun = ({ events }: { events: readonly RunEvent[] }): RunEvent[] => [
  started({ atIso: window.fromIso }),
  ...events,
];

describe("settledAt", () => {
  it("reads a ruling at its decision instant and every other line at its own", () => {
    const ruling: RunEvent = {
      anchor: "transcript:t#u",
      atIso: "2026-11-05T12:00:00.000Z",
      decidedIso: "2026-11-05T10:00:00.000Z",
      kind: "ruling",
      ruling: "the first",
    };
    expect(settledAt({ event: ruling })).toBe("2026-11-05T10:00:00.000Z");
    expect(settledAt({ event: answered({ atIso: "2026-11-05T11:00:00.000Z" }) })).toBe("2026-11-05T11:00:00.000Z");
  });
});

describe("measureJournal question settles", () => {
  it("states no wait when the answering ruling was journalled before it was decided, never a wait off that clock", () => {
    const ruling: RunEvent = {
      anchor: "talk:fixture",
      atIso: "2026-11-05T00:30:00.000Z",
      decidedIso: "2026-11-05T10:00:00.000Z",
      kind: "ruling",
      ruling: "ship it",
    };
    const probed: RunEvent[] = [
      { atIso: "2026-11-05T04:00:00.000Z", kind: "question-corrected", question: "which PR, #1?", why: "typo" },
      { atIso: "2026-11-05T03:00:00.000Z", kind: "question-corrected", question: "which PR, #2?", why: "typo" },
    ];
    for (const events of [
      [ruling, question({ atIso: "2026-11-05T01:00:00.000Z" }), ...probed],
      [question({ atIso: "2026-11-05T01:00:00.000Z" }), { ...ruling, atIso: "2026-11-05T02:00:00.000Z" }],
    ]) {
      const measures = measureJournal({ events: inRun({ events }), slug: "row", window });
      expect([measures.questions.size, measures.unmeasurable]).toStrictEqual([0, 1]);
    }
  });

  it("stops the clock at a ruling backfilled after the answer but decided before it, never the later answer", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      answered({ atIso: "2026-11-05T05:00:00.000Z" }),
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T06:00:00.000Z",
        decidedIso: "2026-11-05T03:00:00.000Z",
        kind: "ruling",
        ruling: "ship it",
      },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 2,
    });
  });

  it("stops the clock at a ruling's decision when a death sits between that decision and the ruling being journalled", () => {
    const events: RunEvent[] = [
      started({ atIso: "2026-11-05T00:00:00.000Z" }),
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        atIso: "2026-11-05T04:00:00.000Z",
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-11-05T01:00:00.000Z",
      },
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T09:00:00.000Z",
        decidedIso: "2026-11-05T02:30:00.000Z",
        kind: "ruling",
        ruling: "ship it",
      },
    ];
    expect(measureJournal({ events, slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 1.5,
    });
  });

  it("settles a question at a ruling the owner made after it was asked, at the ruling's decision instant", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T09:00:00.000Z",
        decidedIso: "2026-11-05T02:30:00.000Z",
        kind: "ruling",
        ruling: "ship it",
      },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 1.5,
    });
  });

  it("never settles a question at a ruling a later correction restated it FROM", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T02:00:00.000Z",
        decidedIso: "2026-11-05T01:30:00.000Z",
        kind: "ruling",
        ruling: "narrow it",
      },
      { atIso: "2026-11-05T03:00:00.000Z", kind: "question-corrected", question: "narrowed: which PR?", why: "ruled" },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: true,
      waitHours: 23,
    });
  });

  it("settles a restated question at a ruling journalled AFTER the restatement", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      { atIso: "2026-11-05T03:00:00.000Z", kind: "question-corrected", question: "narrowed: which PR?", why: "ruled" },
      { anchor: "talk:fixture", atIso: "2026-11-05T05:00:00.000Z", kind: "ruling", ruling: "#2" },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 4,
    });
  });

  it("states no wait for a question stamped earlier than a ruling appended ahead of it, never a wait off a contradicted ask", () => {
    const events: RunEvent[] = [
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T10:00:00.000Z",
        decidedIso: "2026-11-05T02:00:00.000Z",
        kind: "ruling",
        ruling: "ship it",
      },
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
    ];
    const measures = measureJournal({ events: inRun({ events }), slug: "row", window });
    expect([measures.questions.size, measures.unmeasurable]).toStrictEqual([0, 1]);
  });

  it("settles a question at an answer that came before a ruling appended earlier but decided later", () => {
    const events: RunEvent[] = [
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T00:30:00.000Z",
        decidedIso: "2026-11-05T10:00:00.000Z",
        kind: "ruling",
        ruling: "ship it",
      },
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      answered({ atIso: "2026-11-05T02:00:00.000Z" }),
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(2)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 1,
    });
  });

  it("counts a wait as unmeasurable when an unreadable answer competes with a readable earlier-appended ruling", () => {
    const events: RunEvent[] = [
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T00:30:00.000Z",
        decidedIso: "2026-11-05T10:00:00.000Z",
        kind: "ruling",
        ruling: "ship it",
      },
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      answered({ atIso: "not-an-instant" }),
    ];
    const measures = measureJournal({ events: inRun({ events }), slug: "row", window });
    expect([measures.questions.size, measures.unmeasurable]).toStrictEqual([0, 1]);
  });

  it("never settles a question at an earlier-appended ruling decided before it was asked", () => {
    const events: RunEvent[] = [
      { anchor: "talk:fixture", atIso: "2026-11-05T00:30:00.000Z", kind: "ruling", ruling: "an older call" },
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(2)).toStrictEqual({
      openAtWindowEnd: true,
      waitHours: 23,
    });
  });

  it("settles a question at whichever answering ruling was DECIDED first, not appended first", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T09:00:00.000Z",
        decidedIso: "2026-11-05T05:00:00.000Z",
        kind: "ruling",
        ruling: "the later call",
      },
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T10:00:00.000Z",
        decidedIso: "2026-11-05T02:00:00.000Z",
        kind: "ruling",
        ruling: "the first call",
      },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 1,
    });
  });

  it("never settles a question at a ruling decided BEFORE it was asked", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      {
        anchor: "talk:fixture",
        atIso: "2026-11-05T02:00:00.000Z",
        decidedIso: "2026-11-04T12:00:00.000Z",
        kind: "ruling",
        ruling: "an older call",
      },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: true,
      waitHours: 23,
    });
  });

  it("stops the wait at an answer that comes before any orphan", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      answered({ atIso: "2026-11-05T03:00:00.000Z" }),
      {
        atIso: "2026-11-05T05:00:00.000Z",
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-11-05T03:00:00.000Z",
      },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 2,
    });
  });

  it("keeps a question waiting through a withdrawal of a DIFFERENT question, as openQuestion.ts binds it", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      { atIso: "2026-11-05T02:00:00.000Z", kind: "question-withdrawn", question: "some other question", why: "moot" },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: true,
      waitHours: 23,
    });
  });

  it("stops the clock at a withdrawal of the question as last CORRECTED", () => {
    const events: RunEvent[] = [
      question({ atIso: "2026-11-05T01:00:00.000Z" }),
      { atIso: "2026-11-05T02:00:00.000Z", kind: "question-corrected", question: "which PR, #1 or #2?", why: "typo" },
      { atIso: "2026-11-05T04:00:00.000Z", kind: "question-withdrawn", question: "which PR, #1 or #2?", why: "moot" },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 3,
    });
  });

  it("ignores a reshape of an already-shaped ask, as the board's fold does, so a withdrawal of the held text settles it", () => {
    const options = [
      { letter: "A", option: "the first", tradeoff: "slower" },
      { letter: "B", option: "the second", tradeoff: "riskier" },
    ];
    const stakes = { blastRadius: "one repo", risk: "a wrong merge", stillReal: "read the PR" };
    const events: RunEvent[] = [
      { atIso: "2026-11-05T01:00:00.000Z", kind: "question", lean: "A", options, problem: "two PRs", question: "Q" },
      {
        atIso: "2026-11-05T02:00:00.000Z",
        kind: "question-shaped",
        lean: "A",
        options,
        problem: "two PRs",
        question: "Q2",
        replaces: "Q",
        stakes,
      },
      { atIso: "2026-11-05T03:00:00.000Z", kind: "question-withdrawn", question: "Q", why: "moot" },
    ];
    expect(measureJournal({ events: inRun({ events }), slug: "row", window }).questions.get(1)).toStrictEqual({
      openAtWindowEnd: false,
      waitHours: 2,
    });
  });

  it("stops a question's clock when a NEW question replaces it, so two waits never overlap", () => {
    const events = [question({ atIso: "2026-11-05T01:00:00.000Z" }), question({ atIso: "2026-11-05T03:00:00.000Z" })];
    const measures = measureJournal({ events: inRun({ events }), slug: "row", window });
    expect(measures.questions.get(1)).toStrictEqual({ openAtWindowEnd: false, waitHours: 2 });
    expect(measures.questions.get(2)).toStrictEqual({ openAtWindowEnd: true, waitHours: 21 });
  });
});
