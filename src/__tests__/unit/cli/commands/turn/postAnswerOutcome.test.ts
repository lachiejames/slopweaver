/**
 * `outcomeReport` — what `turn answer` SAYS about a settled turn, and the exit code it earns. Pure, so every
 * arm is a plain call with no seam to inject.
 *
 * The arm that matters most here is `answer-lost`. It shares its shape with `failed` and means the opposite:
 * an operator reading `turn did not answer` goes looking for whether the ask was answerable at all, when in the measured case
 * it had been answered, reviewed and returned verdict-clean before the send threw.
 */
import { describe, expect, it } from "vitest";
import { outcomeReport } from "../../../../../cli/commands/turn/answerOutcome.js";
import type { AskIdentity } from "../../../../../live/ask/identity.js";
import type { Mention } from "../../../../../live/listen/mention.js";
import type { TurnCompletion } from "../../../../../live/turn/envelope.js";

const ASK_IDENTITY: AskIdentity = { channel: "C1", messageTs: "2.2", threadTs: "1.1" };

const MENTION: Mention = {
  channel: "C1",
  messageTs: "2.2",
  surface: "channel",
  text: "why did the pool exhaust",
  threadTs: "1.1",
  userId: "U1",
};

/** A minimal settled `TurnCompletion`, with the primary outcome under test. */
function completion(primary: TurnCompletion["primary"]): TurnCompletion {
  return {
    askIdentity: ASK_IDENTITY,
    primary,
    provenance: { modelId: "claude-opus-5" },
    secondaryFailures: [],
    turnId: "turn-1",
    workingTs: "1712345678.000300",
  };
}

/** The report for one primary outcome. */
function reportFor(primary: TurnCompletion["primary"]): ReturnType<typeof outcomeReport> {
  return outcomeReport({ completion: completion(primary), mention: MENTION });
}

describe("outcomeReport", () => {
  it("reports an answered turn on stdout with a zero exit code, naming both timestamps", () => {
    const report = reportFor({ answerTs: "1712345678.000500", kind: "answered" });

    expect(report.code).toBe(0);
    expect(report.stream).toBe("out");
    expect(report.line).toBe("answered in C1 thread 1.1 — working 1712345678.000300, answer 1712345678.000500");
  });

  it("reports a FIRST answer as posted with the turn still open, naming what the worker still owes", () => {
    const report = reportFor({
      answerDigest: "digest-of-the-plan",
      answerTs: "1712345678.000500",
      followThrough: { owes: "pull-requests", what: "open the two pull requests the plan names" },
      kind: "first-answered",
    });

    expect(report.code).toBe(0);
    expect(report.stream).toBe("out");
    expect(report.line).toBe(
      "first answer posted in C1 thread 1.1 — answer 1712345678.000500; this workspace stays open and the " +
        "dispatch is still yours; you still owe: open the two pull requests the plan names",
    );
  });

  it("reports a withheld turn on stdout with a zero exit code and both queue commands", () => {
    const report = reportFor({
      held: { code: "owner-review", id: "q1", reason: "sensitive topic" },
      kind: "withheld",
      noticeTs: "1712345678.000700",
    });

    expect(report.code).toBe(0);
    expect(report.stream).toBe("out");
    expect(report.line).toContain("slopweaver queue show q1");
    expect(report.line).toContain("slopweaver queue release q1");
  });

  it("reports a failed turn as one that never answered", () => {
    const report = reportFor({ kind: "failed", reason: "the model call timed out" });

    expect(report.code).toBe(1);
    expect(report.stream).toBe("error");
    expect(report.line).toBe("turn did not answer: the model call timed out");
  });

  it("reports an answer-lost turn as an answer destroyed in delivery, and says to re-run it", () => {
    const report = reportFor({ kind: "answer-lost", reason: "fatal: not a git repository" });

    expect(report.code).toBe(1);
    expect(report.stream).toBe("error");
    expect(report.line).toBe(
      "turn composed an answer and lost it on the way out — re-run the turn: fatal: not a git repository",
    );
  });

  it("never tells an answer-lost operator the turn did not answer", () => {
    expect(reportFor({ kind: "answer-lost", reason: "the send threw" }).line).not.toContain("did not answer");
  });
});
