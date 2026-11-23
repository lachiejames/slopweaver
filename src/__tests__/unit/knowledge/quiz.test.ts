/**
 * One question per sweep: how it is selected, why the selection is idempotent, and what the owner said about it.
 *
 * The falsifiable claim under most of this file is that the SELECTION is mechanical and deterministic —
 * two runs of one sweep cut the same question, and the rotation cannot be pinned by a question the owner ignores.
 */
import { describe, expect, it } from "vitest";

import { buildQuizAnswer, cutQuestion } from "../../../knowledge/quiz/cut.js";
import {
  answerTo,
  excludedByVerdict,
  latestFleetLessons,
  nextLesson,
  parseQuizLine,
} from "../../../knowledge/quiz/select.js";
import { QUIZ_ANSWER_MAX, type QuizEvent } from "../../../knowledge/quiz/types.js";
import type { LessonRow } from "../../../knowledge/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const AT = "2026-09-12T01:00:00.000Z";
const LATER = "2026-09-12T02:00:00.000Z";

/** One fleet lesson, varying only what a test overrides. */
const lesson = (over: Partial<LessonRow> = {}): LessonRow => ({
  claim: "APM adaptive sampling sits upstream of retention filters",
  domain: "datadog",
  evidence: "a 100%-error filter kept 0 of 412 traces over 7d",
  id: "l-0000000000000001",
  learner: "fleet",
  recordedAtIso: AT,
  run: "ad-hoc",
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

/** The question one sweep cuts against a given register and ledger. */
const cut = ({
  rows,
  events = [],
  sweepId = "tick-1",
}: {
  rows: readonly LessonRow[];
  events?: readonly QuizEvent[];
  sweepId?: string;
}) => cutQuestion({ events, nowIso: LATER, rows, sweepId, traces: [] });

describe("latestFleetLessons", () => {
  it("keeps the newest recording of each claim, because that is what the fleet currently believes", () => {
    const rows = [lesson(), lesson({ recordedAtIso: LATER, verdict: "refuted" })];

    expect(latestFleetLessons({ rows }).map((row) => row.verdict)).toEqual(["refuted"]);
  });

  it("drops the owner's rows before folding, so one of their answers cannot become its own reference answer", () => {
    const rows = [lesson(), lesson({ learner: "owner", verdict: "refuted" })];
    const folded = latestFleetLessons({ rows });

    expect(folded.length).toBe(1);
    expect(folded[0]?.verdict).toBe("confirmed");
  });
});

describe("nextLesson", () => {
  it("asks about a confirmed or refuted lesson", () => {
    expect(nextLesson({ events: [], rows: [lesson()] })?.id).toBe("l-0000000000000001");
    expect(nextLesson({ events: [], rows: [lesson({ verdict: "refuted" })] })?.id).toBe("l-0000000000000001");
  });

  it("refuses every verdict that supplies no unambiguous answer", () => {
    expect(nextLesson({ events: [], rows: [lesson({ verdict: "changed" })] })).toBe(undefined);
    expect(nextLesson({ events: [], rows: [lesson({ verdict: "untestable" })] })).toBe(undefined);
    expect(nextLesson({ events: [], rows: [lesson({ verdict: "unsettled" })] })).toBe(undefined);
  });

  it("puts the worse tier first, because that is where the owner being wrong costs most", () => {
    const rows = [lesson({ id: "l-0000000000000002", tier: 4 }), lesson({ id: "l-0000000000000001", tier: 1 })];

    expect(nextLesson({ events: [], rows })?.id).toBe("l-0000000000000001");
  });

  it("rotates: a lesson already asked about sinks below one that never was", () => {
    const asked = unwrap2(cut({ rows: [lesson()] }));
    const rows = [lesson(), lesson({ id: "l-0000000000000002", tier: 1 })];

    expect(nextLesson({ events: [asked], rows })?.id).toBe("l-0000000000000002");
  });

  it("rotates on times ASKED rather than answered, so a question the owner ignores cannot pin the quiz", () => {
    const asked = unwrap2(cut({ rows: [lesson()] }));
    const rows = [lesson(), lesson({ id: "l-0000000000000002", tier: 4 })];

    // No `answered` event anywhere: the owner never replied, and the rotation still moves on.
    expect(nextLesson({ events: [asked], rows })?.id).toBe("l-0000000000000002");
  });

  it("breaks a tie on the id, so two runs of one sweep cut the same question", () => {
    const rows = [lesson({ id: "l-0000000000000011" }), lesson({ id: "l-0000000000000010" })];

    expect(nextLesson({ events: [], rows })?.id).toBe("l-0000000000000010");
  });
});

describe("excludedByVerdict", () => {
  it("counts what the narrowing cost, so it is reportable rather than silent", () => {
    const rows = [lesson({ verdict: "unsettled" }), lesson({ id: "l-2", verdict: "changed" }), lesson({ id: "l-3" })];

    expect([...excludedByVerdict({ rows }).entries()].toSorted((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ["changed", 1],
      ["unsettled", 1],
    ]);
  });
});

describe("cutQuestion", () => {
  it("cuts one question and hands back the row to write", () => {
    const result = cut({ rows: [lesson()] });

    expect(result.question?.lessonId).toBe("l-0000000000000001");
    expect(result.write?.kind).toBe("selected");
  });

  it("pins the fleet's recording as a receipt, so the question stays the question the owner was asked", () => {
    const result = cut({ rows: [lesson()] });

    expect(result.question?.fleet.kind === "lesson" ? result.question.fleet.lesson.verdict : undefined).toBe(
      "confirmed",
    );
    expect(result.question?.fleet.kind === "lesson" ? result.question.fleet.lesson.evidence : undefined).toBe(
      "a 100%-error filter kept 0 of 412 traces over 7d",
    );
  });

  it("returns the sweep's EXISTING question rather than selecting again", () => {
    const first = unwrap2(cut({ rows: [lesson()] }));
    const second = cut({ events: [first], rows: [lesson(), lesson({ id: "l-0000000000000002", tier: 1 })] });

    expect(second.question?.quizId).toBe(first.quizId);
    expect(second.write).toBe(undefined);
  });

  it("records an EMPTY row when nothing is eligible, so the next render does not re-cut", () => {
    const result = cut({ rows: [lesson({ verdict: "unsettled" })] });

    expect(result.question).toBe(undefined);
    expect(result.write?.kind).toBe("empty");
  });

  it("writes nothing a second time for a sweep that already recorded an empty", () => {
    const first = cut({ rows: [lesson({ verdict: "unsettled" })] });
    const second = cut({ events: [first.write!], rows: [lesson({ verdict: "unsettled" })] });

    expect(second.write).toBe(undefined);
    expect(second.question).toBe(undefined);
  });

  it("gives two sweeps two different ids for the same lesson", () => {
    const one = unwrap2(cut({ rows: [lesson()], sweepId: "tick-1" }));
    const two = unwrap2(cut({ rows: [lesson()], sweepId: "tick-2" }));

    expect(one.quizId === two.quizId).toBe(false);
  });
});

describe("buildQuizAnswer", () => {
  const question = unwrap2(cut({ rows: [lesson()] }));
  const valid = { answeredAtIso: LATER, quizId: question.quizId, run: "half-kept-ledger-a" } as const;

  it("records the owner's words against the question", () => {
    const row = unwrap(buildQuizAnswer({ ...valid, events: [question], words: "no, only on the read replica" }));

    expect(row.kind).toBe("answered");
    expect(row.words).toBe("no, only on the read replica");
  });

  it("records no grade, because whether the owner is right is an assessment a session makes", () => {
    const row = unwrap(buildQuizAnswer({ ...valid, events: [question], words: "yes" }));

    expect(Object.keys(row).toSorted()).toEqual(["answeredAtIso", "kind", "quizId", "run", "words"]);
  });

  it("refuses an id the ledger never cut", () => {
    const error = unwrapErr(
      buildQuizAnswer({ ...valid, events: [question], quizId: "q-ffffffffffffffff", words: "yes" }),
    );

    expect(error.code).toBe("QUIZ_NOT_FOUND");
  });

  it("refuses a second answer, so what the owner said first is never overwritten", () => {
    const first = unwrap(buildQuizAnswer({ ...valid, events: [question], words: "yes" }));
    const error = unwrapErr(buildQuizAnswer({ ...valid, events: [question, first], words: "actually no" }));

    expect(error.code).toBe("QUIZ_ALREADY_ANSWERED");
  });

  it("refuses an empty answer, because the row carries the owner's words", () => {
    const error = unwrapErr(buildQuizAnswer({ ...valid, events: [question], words: "   " }));

    expect(error.code).toBe("QUIZ_FIELD");
    expect(error.message).toBe("answer is empty");
  });

  it("refuses an answer over its cap, so a pasted transcript is not one reply", () => {
    const error = unwrapErr(buildQuizAnswer({ ...valid, events: [question], words: "x".repeat(QUIZ_ANSWER_MAX + 1) }));

    expect(error.code).toBe("QUIZ_FIELD");
  });

  it("round-trips through the ledger's own decoder", () => {
    const row = unwrap(buildQuizAnswer({ ...valid, events: [question], words: "yes, measured it myself" }));

    expect(parseQuizLine({ line: JSON.stringify(row) })).toEqual(row);
  });
});

describe("answerTo", () => {
  const question = unwrap2(cut({ rows: [lesson()] }));

  it("finds what the owner said about one question", () => {
    const row = unwrap(
      buildQuizAnswer({ answeredAtIso: LATER, events: [question], quizId: question.quizId, run: "r", words: "yes" }),
    );

    expect(answerTo({ events: [question, row], quizId: question.quizId })?.words).toBe("yes");
  });

  it("is undefined for a question the owner has not answered", () => {
    expect(answerTo({ events: [question], quizId: question.quizId })).toBe(undefined);
  });
});

describe("parseQuizLine", () => {
  it("round-trips a selected row, receipt and all", () => {
    const question = unwrap2(cut({ rows: [lesson()] }));

    expect(parseQuizLine({ line: JSON.stringify(question) })).toEqual(question);
  });

  it("round-trips an empty row, which is a real answer to what a sweep asked", () => {
    const empty = cut({ rows: [lesson({ verdict: "unsettled" })] }).write!;

    expect(parseQuizLine({ line: JSON.stringify(empty) })).toEqual(empty);
  });

  it("refuses a selected row whose pinned recording is not a lesson", () => {
    const line = JSON.stringify({
      fleet: { id: "l-1" },
      kind: "selected",
      lessonId: "l-1",
      quizId: "q-1",
      selectedAtIso: AT,
      sweepId: "tick-1",
    });

    expect(parseQuizLine({ line })).toBe(undefined);
  });

  it("refuses a line that is not JSON at all", () => {
    expect(parseQuizLine({ line: "not json" })).toBe(undefined);
  });
});

/** The question a cut produced, which every test here builds against. */
function unwrap2(result: ReturnType<typeof cutQuestion>): Extract<QuizEvent, { kind: "selected" }> {
  return result.question!;
}
