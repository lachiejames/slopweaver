/**
 * The quiz pointed at traces: which subject a sweep cuts, what the ledger keeps, and
 * what the page asks the owner.
 *
 * The legacy-decode case is the one that would be missed. A ledger line written before traces were askable
 * holds a BARE lesson row under `fleet`; if that stopped decoding, every question a sweep had already asked
 * the owner would vanish from the ledger and the next render would re-cut a sweep they have already answered.
 */
import { describe, expect, it } from "vitest";

import { projectQuiz } from "../../../briefing/quiz.js";
import { cutQuestion } from "../../../knowledge/quiz/cut.js";
import { latestFleetTraces, nextSubject, parseQuizLine, subjectId } from "../../../knowledge/quiz/select.js";
import type { QuizEvent } from "../../../knowledge/quiz/types.js";
import type { TraceRow } from "../../../knowledge/traceRow.js";
import type { LessonRow } from "../../../knowledge/types.js";

const NOW = "2026-09-16T04:00:00.000Z";

/** One fleet trace as the register hands it back. */
const trace = (over: Partial<TraceRow> = {}): TraceRow => ({
  domain: "store-detective",
  doesNotProve: "Linear only; the load-test thread may name it another way",
  evidence: "16 Sep 2026: exact 0, wild-both 0",
  id: "t-0000000000000001",
  learner: "fleet",
  outcome: "empty",
  probe: "slopweaver store probe k6 --source linear",
  question: "why did the staging pool exhaust",
  recordedAtIso: "2026-09-16T03:00:00.000Z",
  run: "ad-hoc",
  verdict: "confirmed",
  ...over,
});

/** One fleet lesson. */
const lesson = (over: Partial<LessonRow> = {}): LessonRow => ({
  claim: "APM adaptive sampling sits upstream of retention filters",
  domain: "datadog",
  evidence: "a 100%-error filter kept 0 of 412 traces over 7d",
  id: "l-0000000000000001",
  learner: "fleet",
  recordedAtIso: "2026-09-12T10:00:00.000Z",
  run: "ad-hoc",
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

describe("latestFleetTraces", () => {
  it("keeps the newest recording of each claim", () => {
    const rows = latestFleetTraces({
      rows: [trace({ evidence: "older" }), trace({ evidence: "newer" })],
    });
    expect(rows.map((row) => row.evidence)).toEqual(["newer"]);
  });

  it("drops a trace of the owner's, so one of their answers cannot become its own reference answer", () => {
    expect(latestFleetTraces({ rows: [trace({ learner: "owner" })] })).toEqual([]);
  });

  it("drops a REFUTED trace — the fleet already found that place wrong, so there is nothing to keep", () => {
    expect(latestFleetTraces({ rows: [trace({ verdict: "refuted" })] })).toEqual([]);
  });
});

describe("nextSubject", () => {
  it("asks about a TRACE before a lesson, both never asked", () => {
    const subject = nextSubject({ events: [], lessons: [lesson()], traces: [trace()] });
    expect(subject?.kind).toBe("trace");
  });

  it("falls back to a lesson when the register holds no eligible trace", () => {
    const subject = nextSubject({ events: [], lessons: [lesson()], traces: [] });
    expect(subject?.kind).toBe("lesson");
  });

  it("asks about the least-asked subject first, whichever kind that is", () => {
    const asked: QuizEvent = {
      fleet: { kind: "trace", trace: trace() },
      kind: "selected",
      lessonId: "t-0000000000000001",
      quizId: "q-0000000000000001",
      selectedAtIso: "2026-09-15T00:00:00.000Z",
      sweepId: "tick-0",
    };
    const subject = nextSubject({ events: [asked], lessons: [lesson()], traces: [trace()] });
    expect(subject === undefined ? "none" : subjectId({ subject })).toBe("l-0000000000000001");
  });

  it("returns nothing when the register holds neither", () => {
    expect(nextSubject({ events: [], lessons: [], traces: [] })).toBe(undefined);
  });
});

describe("cutQuestion over a trace", () => {
  it("pins the trace as the receipt and names it by its own claim id", () => {
    const cut = cutQuestion({ events: [], nowIso: NOW, rows: [], sweepId: "tick-1", traces: [trace()] });
    expect(cut.question?.lessonId).toBe("t-0000000000000001");
    expect(cut.question?.fleet.kind).toBe("trace");
  });

  it("records an EMPTY row naming both halves of the register when neither can be asked about", () => {
    const cut = cutQuestion({ events: [], nowIso: NOW, rows: [], sweepId: "tick-2", traces: [] });
    expect(cut.question).toBe(undefined);
    expect(cut.write?.kind).toBe("empty");
  });
});

describe("parseQuizLine", () => {
  it("decodes a line written before traces were askable, whose fleet field is a bare lesson", () => {
    const line = JSON.stringify({
      fleet: lesson(),
      kind: "selected",
      lessonId: "l-0000000000000001",
      quizId: "q-0000000000000001",
      selectedAtIso: NOW,
      sweepId: "tick-old",
    });
    const event = parseQuizLine({ line });
    expect(event?.kind === "selected" ? event.fleet.kind : "not-selected").toBe("lesson");
  });

  it("decodes a trace line", () => {
    const line = JSON.stringify({
      fleet: { kind: "trace", trace: trace() },
      kind: "selected",
      lessonId: "t-0000000000000001",
      quizId: "q-0000000000000002",
      selectedAtIso: NOW,
      sweepId: "tick-new",
    });
    const event = parseQuizLine({ line });
    expect(event?.kind === "selected" ? event.fleet.kind : "not-selected").toBe("trace");
  });

  it("refuses a line whose pinned subject is neither shape", () => {
    const line = JSON.stringify({
      fleet: { kind: "trace", trace: { id: "t-1" } },
      kind: "selected",
      lessonId: "t-1",
      quizId: "q-1",
      selectedAtIso: NOW,
      sweepId: "tick-bad",
    });
    expect(parseQuizLine({ line })).toBe(undefined);
  });
});

describe("projectQuiz over a trace", () => {
  const question = ({ outcome }: { outcome: "paid" | "empty" }): ReturnType<typeof projectQuiz> =>
    projectQuiz({
      question: {
        fleet: { kind: "trace", trace: trace({ outcome }) },
        kind: "selected",
        lessonId: "t-0000000000000001",
        quizId: "q-0000000000000001",
        selectedAtIso: NOW,
        sweepId: "tick-1",
      },
    });

  it("asks whether to keep or re-open a place the fleet stopped looking", () => {
    expect(question({ outcome: "empty" })?.claim).toBe(
      "We stopped looking here for: why did the staging pool exhaust. Keep that, or re-open it?",
    );
  });

  it("asks whether a probe that paid is still where the owner would look", () => {
    expect(question({ outcome: "paid" })?.claim).toBe(
      "This probe paid for: why did the staging pool exhaust. Still where you would look?",
    );
  });

  it("carries the probe and the outcome, and no tier — a trace has no rung on the harm ladder", () => {
    const block = question({ outcome: "empty" });
    expect([block?.traceProbe, block?.traceOutcome, block?.tier]).toEqual([
      "slopweaver store probe k6 --source linear",
      "empty",
      undefined,
    ]);
  });

  it("carries what the emptiness does not prove into the fold", () => {
    expect(question({ outcome: "empty" })?.fleetCaveat).toBe(
      "Linear only; the load-test thread may name it another way",
    );
  });
});
