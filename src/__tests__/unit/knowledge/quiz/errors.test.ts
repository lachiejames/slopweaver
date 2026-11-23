/**
 * The quiz ledger's five failures, built through their factory: a field error that reads as one sentence, a
 * missing question and an answered one that each say what to do next, a corrupt line by number, and an
 * unreadable ledger that keeps its cause rather than reading as empty.
 */
import { describe, expect, it } from "vitest";

import { QuizErrors } from "../../../../knowledge/quiz/errors.js";

describe("QuizErrors", () => {
  it("field is QUIZ_FIELD, joining the field name to why it was refused", () => {
    expect(QuizErrors.field({ field: "answer", why: "is empty" })).toEqual({
      code: "QUIZ_FIELD",
      field: "answer",
      message: "answer is empty",
    });
  });

  it("notFound is QUIZ_NOT_FOUND, saying where the id comes from and how to cut a question", () => {
    expect(QuizErrors.notFound({ quizId: "q-42" })).toEqual({
      code: "QUIZ_NOT_FOUND",
      message:
        "the ledger holds no question q-42. Read the id off the briefing's quiz block, or run " +
        "`slopweaver knowledge quiz --sweep <tick-id>` to cut this sweep's question first",
      quizId: "q-42",
    });
  });

  it("alreadyAnswered is QUIZ_ALREADY_ANSWERED, saying the answer is never overwritten", () => {
    expect(QuizErrors.alreadyAnswered({ quizId: "q-42" })).toEqual({
      code: "QUIZ_ALREADY_ANSWERED",
      message:
        "question q-42 has already been answered, and what they said is never overwritten. The next sweep " +
        "asks the next question",
      quizId: "q-42",
    });
  });

  it("corrupt is QUIZ_CORRUPT, naming the line", () => {
    expect(QuizErrors.corrupt({ lineNumber: 7 })).toEqual({
      code: "QUIZ_CORRUPT",
      lineNumber: 7,
      message: "line 7 of the quiz ledger is not a decodable row",
    });
  });

  it("unreadable is QUIZ_UNREADABLE, keeping the cause and refusing to read as empty", () => {
    const cause = new Error("EACCES");

    const error = QuizErrors.unreadable({ cause, path: "/h/knowledge/quiz.jsonl" });

    expect(error).toEqual({
      cause,
      code: "QUIZ_UNREADABLE",
      message: "could not read the quiz ledger at /h/knowledge/quiz.jsonl — refusing rather than reporting it empty",
      path: "/h/knowledge/quiz.jsonl",
    });
    expect(error.cause).toBe(cause);
  });
});
