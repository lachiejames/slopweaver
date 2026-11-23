/**
 * The completion envelope — folding a pre-envelope `TurnHandlerOutcome` into the durable `TurnCompletion`,
 * and reading it back off the log. Pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { AskIdentity } from "../../../../live/ask/identity.js";
import { parseTurnCompletionLog, turnCompletionEventLine } from "../../../../live/turn/completionLog.js";
import {
  type TurnCompletion,
  type TurnCompletionEvent,
  type TurnHandlerOutcome,
  type TurnProvenance,
  turnCompletionFromOutcome,
} from "../../../../live/turn/envelope.js";
import { turnErrorLines } from "../../../../live/turn/turnErrors.js";

const ASK_IDENTITY: AskIdentity = { channel: "C1", messageTs: "2.2", threadTs: "1.1" };
const PROVENANCE: TurnProvenance = { modelId: "claude-sonnet-5" };

/** A minimal `TurnHandlerOutcome`, with per-test overrides. */
function outcome(over: Readonly<Partial<TurnHandlerOutcome>> = {}): TurnHandlerOutcome {
  return { answered: false, workingTs: "1712345678.000300", ...over };
}

const fold = (over: Readonly<Partial<TurnHandlerOutcome>> = {}) =>
  turnCompletionFromOutcome({
    askIdentity: ASK_IDENTITY,
    outcome: outcome(over),
    provenance: PROVENANCE,
    turnId: "turn-1",
  });

describe("turnCompletionFromOutcome — answered", () => {
  it("folds an answered outcome into an answered primary carrying its answerTs", () => {
    const result = fold({ answered: true, answerTs: "1712345678.000500" });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.primary : "not folded").toEqual({
      answerTs: "1712345678.000500",
      kind: "answered",
    });
  });

  it("refuses answered:true missing its answerTs", () => {
    const result = fold({ answered: true });

    expect(result.isOk()).toBe(false);
    expect(turnErrorLines({ error: unwrapErr(result) })).toEqual(["an answered turn requires answerTs"]);
  });

  it("refuses answered:true combined with a failure", () => {
    const result = fold({ answered: true, answerTs: "1712345678.000500", failure: "boom" });

    expect(result.isOk()).toBe(false);
    expect(turnErrorLines({ error: unwrapErr(result) })).toEqual([
      "answered:true cannot combine with a failure or a withheld reply",
    ]);
  });

  it("refuses answered:true combined with a withheld reply", () => {
    const result = fold({
      answered: true,
      answerTs: "1712345678.000500",
      withheld: { code: "E1", id: "row-1", reason: "no whitelist" },
    });

    expect(result.isOk()).toBe(false);
    expect(turnErrorLines({ error: unwrapErr(result) })).toEqual([
      "answered:true cannot combine with a failure or a withheld reply",
    ]);
  });
});

describe("turnCompletionFromOutcome — withheld", () => {
  it("folds a withheld outcome into a withheld primary, its answerTs becoming the notice timestamp", () => {
    const result = fold({
      answerTs: "1712345678.000500",
      withheld: { code: "E1", id: "row-1", reason: "no whitelist" },
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.primary : "not folded").toEqual({
      held: { code: "E1", id: "row-1", reason: "no whitelist" },
      kind: "withheld",
      noticeTs: "1712345678.000500",
    });
  });

  it("refuses a withheld outcome missing its notice timestamp", () => {
    const result = fold({ withheld: { code: "E1", id: "row-1", reason: "no whitelist" } });

    expect(result.isOk()).toBe(false);
    expect(turnErrorLines({ error: unwrapErr(result) })).toEqual([
      "a withheld turn requires its notice timestamp as answerTs",
    ]);
  });

  it("refuses a turn that is both withheld and failed", () => {
    const result = fold({
      answerTs: "1712345678.000500",
      failure: "boom",
      withheld: { code: "E1", id: "row-1", reason: "no whitelist" },
    });

    expect(result.isOk()).toBe(false);
    expect(turnErrorLines({ error: unwrapErr(result) })).toEqual(["a turn cannot be both withheld and failed"]);
  });
});

describe("turnCompletionFromOutcome — failed", () => {
  it("folds a failed outcome into a failed primary carrying its reason", () => {
    const result = fold({ answerTs: "1712345678.000500", failure: "the query threw" });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.primary : "not folded").toEqual({
      kind: "failed",
      noticeTs: "1712345678.000500",
      reason: "the query threw",
    });
  });

  /**
   * The notice timestamp used to be REQUIRED here, which read as "a failed turn always managed to post a
   * card saying so". It does not: the failure card goes through the admit door like every other write, and a
   * turn the door refused can have its notice refused too. Refusing the completion then threw out of
   * `runTurn`, so the ask got no terminal event at all and every sweep went on counting it as working —
   * which is the defect `live/turn/indicators.ts` exists to close, one layer down.
   */
  it("folds a failed outcome whose notice could NOT be posted, rather than refusing the whole completion", () => {
    const result = fold({ failure: "the admit door refused to post the turn's answer" });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.primary : "not folded").toEqual({
      kind: "failed",
      reason: "the admit door refused to post the turn's answer",
    });
  });

  it("refuses an unanswered, non-withheld outcome with no failure reason at all", () => {
    const result = fold({});

    expect(result.isOk()).toBe(false);
    expect(turnErrorLines({ error: unwrapErr(result) })).toEqual([
      "an unanswered, non-withheld turn requires a failure reason",
    ]);
  });
});

/**
 * The fourth arm. `answerLost` is set by exactly one caller — `live/turn/run.ts`'s delivery-path catch,
 * where the query has already returned an answer — so folding it apart from `failed` is what stops a
 * destroyed answer being recorded as a question nobody could answer (measured).
 */
describe("turnCompletionFromOutcome — answer-lost", () => {
  it("folds an answerLost outcome into an answer-lost primary rather than a failed one", () => {
    const result = fold({
      answerLost: true,
      answerTs: "1712345678.000500",
      failure: "Command failed: git rev-parse --show-toplevel",
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.primary : "not folded").toEqual({
      kind: "answer-lost",
      noticeTs: "1712345678.000500",
      reason: "Command failed: git rev-parse --show-toplevel",
    });
  });

  it("folds an answerLost outcome whose failure card could not be posted either", () => {
    const result = fold({ answerLost: true, failure: "the send threw" });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.primary : "not folded").toEqual({
      kind: "answer-lost",
      reason: "the send threw",
    });
  });

  it("stays failed when the break happened before an answer existed", () => {
    const result = fold({ answerLost: false, failure: "the query threw" });

    expect(result.isOk() ? result.value.primary : "not folded").toEqual({
      kind: "failed",
      reason: "the query threw",
    });
  });
});

describe("turnCompletionFromOutcome — universal requirements", () => {
  it("refuses any outcome missing workingTs, before checking anything else", () => {
    const result = turnCompletionFromOutcome({
      askIdentity: ASK_IDENTITY,
      outcome: { answered: true, answerTs: "1712345678.000500" },
      provenance: PROVENANCE,
      turnId: "turn-1",
    });

    expect(result.isOk()).toBe(false);
    expect(turnErrorLines({ error: unwrapErr(result) })).toEqual([
      "a completion requires workingTs — the working message always exists before a turn settles",
    ]);
  });

  it("carries askIdentity, provenance, turnId and workingTs through untouched", () => {
    const result = fold({ answered: true, answerTs: "1712345678.000500" });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? { ...result.value, primary: undefined } : "not folded").toEqual({
      askIdentity: ASK_IDENTITY,
      primary: undefined,
      provenance: PROVENANCE,
      secondaryFailures: [],
      turnId: "turn-1",
      workingTs: "1712345678.000300",
    });
  });

  /**
   * The fold never reads some fields (`answerTs`, `failure`,
   * `withheld`) more than once while deciding and then building an arm — a time-of-check/time-of-use gap.
   * An `answerTs` getter that returns a DIFFERENT string on its second read than its first would let the
   * value the fold VALIDATED (its first read) diverge from the value it actually EMBEDS in the completion
   * (a later read) — unless every field is read exactly once. This asserts the read count directly, so a
   * regression that re-introduces a second read is caught even if that second read happens to return the
   * same value in some other test.
   */
  it("reads answerTs exactly once, never re-deriving it between validation and construction", () => {
    let reads = 0;
    const mutatingOutcome: { answered: boolean; workingTs: string; answerTs?: string } = {
      answered: true,
      workingTs: "working-A",
    };
    Object.defineProperty(mutatingOutcome, "answerTs", {
      get: () => {
        reads += 1;
        return reads === 1 ? "first-read" : "second-read";
      },
    });

    const result = turnCompletionFromOutcome({
      askIdentity: ASK_IDENTITY,
      outcome: mutatingOutcome,
      provenance: PROVENANCE,
      turnId: "turn-1",
    });

    expect(reads).toBe(1);
    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.primary : "not folded").toEqual({ answerTs: "first-read", kind: "answered" });
  });

  /**
   * The same defect, from the withheld/failed side: a `failure`/`withheld` getter that answers `undefined`
   * on its first read and a real value thereafter must not let a LATER, incidental read of the same field
   * (mid-fold, or by the caller after the fold returns) retroactively change which arm was already chosen.
   */
  it("decides the arm from one snapshot, never re-reading failure/withheld after deciding", () => {
    const mutatingOutcome: {
      answered: boolean;
      answerTs?: string;
      workingTs?: string;
      failure?: string;
      withheld?: { id: string; code: string; reason: string };
    } = { answered: true, answerTs: "answer-A", workingTs: "working-A" };
    Object.defineProperty(mutatingOutcome, "failure", {
      configurable: true,
      get: () => {
        Object.defineProperty(mutatingOutcome, "failure", { configurable: true, enumerable: true, value: "boom" });
        return undefined;
      },
    });
    Object.defineProperty(mutatingOutcome, "withheld", {
      configurable: true,
      get: () => {
        Object.defineProperty(mutatingOutcome, "withheld", {
          configurable: true,
          enumerable: true,
          value: { code: "withhold.reply", id: "row-B", reason: "held" },
        });
        return undefined;
      },
    });

    const result = turnCompletionFromOutcome({
      askIdentity: ASK_IDENTITY,
      outcome: mutatingOutcome,
      provenance: PROVENANCE,
      turnId: "turn-1",
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.primary : "not folded").toEqual({ answerTs: "answer-A", kind: "answered" });
  });
});

describe("turnCompletionFromOutcome — secondary failures", () => {
  it("carries no secondary failures when none happened", () => {
    const result = fold({ answered: true, answerTs: "1712345678.000500" });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.secondaryFailures : "not folded").toEqual([]);
  });

  it("orders title, then every status failure, then checklist — regardless of which fired", () => {
    const result = fold({
      answered: true,
      answerTs: "1712345678.000500",
      checklistFailure: "could not resolve to a terminal frame",
      statusFailure: ["failed to set", "failed to clear"],
      titleFailure: "channels.setTopic refused",
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.secondaryFailures : "not folded").toEqual([
      { kind: "title", reason: "channels.setTopic refused" },
      { kind: "status", reason: "failed to set" },
      { kind: "status", reason: "failed to clear" },
      { kind: "checklist", reason: "could not resolve to a terminal frame" },
    ]);
  });

  it("puts every earlier card an answered turn could not reap LAST, one entry per card", () => {
    const folded = unwrap(
      fold({
        answered: true,
        answerTs: "1712345678.000500",
        checklistFailure: "could not resolve to a terminal frame",
        reapFailure: ["card 1712345670.000100 still stands", "card 1712345671.000200 still stands"],
      }),
    );

    expect(folded.secondaryFailures).toEqual([
      { kind: "checklist", reason: "could not resolve to a terminal frame" },
      { kind: "reap", reason: "card 1712345670.000100 still stands" },
      { kind: "reap", reason: "card 1712345671.000200 still stands" },
    ]);
  });

  it("puts a supersession that did not settle LAST of all, after the reaps", () => {
    const folded = unwrap(
      fold({
        answered: true,
        answerTs: "1712345678.000500",
        reapFailure: ["card 1712345670.000100 still stands"],
        supersessionFailure: "the answer this turn superseded in C1 (ts 1790054484.916599) is still standing",
      }),
    );

    expect(folded.secondaryFailures).toEqual([
      { kind: "reap", reason: "card 1712345670.000100 still stands" },
      {
        kind: "supersession",
        reason: "the answer this turn superseded in C1 (ts 1790054484.916599) is still standing",
      },
    ]);
  });

  it("carries a single status failure without losing the other slots", () => {
    const result = fold({ answered: true, answerTs: "1712345678.000500", statusFailure: ["failed to clear"] });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value.secondaryFailures : "not folded").toEqual([
      { kind: "status", reason: "failed to clear" },
    ]);
  });
});

/** A well-formed completion, for the event-line and log-parsing tests below. */
function completion(over: Readonly<Partial<TurnCompletion>> = {}): TurnCompletion {
  return {
    askIdentity: ASK_IDENTITY,
    primary: { answerTs: "1712345678.000500", kind: "answered" },
    provenance: PROVENANCE,
    secondaryFailures: [],
    turnId: "turn-1",
    workingTs: "1712345678.000300",
    ...over,
  };
}

describe("turnCompletionEventLine / parseTurnCompletionLog — round trip", () => {
  it("round-trips an answered completion through one JSONL line", () => {
    const event: TurnCompletionEvent = {
      completion: completion(),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    const parsed = parseTurnCompletionLog({ text: turnCompletionEventLine({ event }) });

    expect(parsed).toEqual({ events: [event], unreadable: [] });
  });

  it("round-trips a withheld completion, including its held record", () => {
    const event: TurnCompletionEvent = {
      completion: completion({
        primary: {
          held: { code: "E1", id: "row-1", reason: "no whitelist" },
          kind: "withheld",
          noticeTs: "1712345678.000500",
        },
      }),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    const parsed = parseTurnCompletionLog({ text: turnCompletionEventLine({ event }) });

    expect(parsed).toEqual({ events: [event], unreadable: [] });
  });

  it("round-trips secondary failures in order", () => {
    const event: TurnCompletionEvent = {
      completion: completion({
        secondaryFailures: [
          { kind: "title", reason: "refused" },
          { kind: "status", reason: "failed" },
        ],
      }),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    const parsed = parseTurnCompletionLog({ text: turnCompletionEventLine({ event }) });

    expect(parsed.events[0]?.completion.secondaryFailures).toEqual([
      { kind: "title", reason: "refused" },
      { kind: "status", reason: "failed" },
    ]);
  });

  it("round-trips a reap failure rather than marking the whole line unreadable", () => {
    const event: TurnCompletionEvent = {
      completion: completion({ secondaryFailures: [{ kind: "reap", reason: "card 1712345670.000100 still stands" }] }),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };

    expect(parseTurnCompletionLog({ text: turnCompletionEventLine({ event }) })).toEqual({
      events: [event],
      unreadable: [],
    });
  });

  it("round-trips a supersession failure, so an old reader is never what widened the vocabulary", () => {
    const event: TurnCompletionEvent = {
      completion: completion({
        secondaryFailures: [{ kind: "supersession", reason: "NOT_WARRANTED: the reviewer called it additive" }],
      }),
      kind: "turn-completed",
      tsIso: "2026-09-22T06:25:01.000Z",
    };

    expect(parseTurnCompletionLog({ text: turnCompletionEventLine({ event }) })).toEqual({
      events: [event],
      unreadable: [],
    });
  });

  it("reads multiple lines, in file order", () => {
    const first: TurnCompletionEvent = {
      completion: completion(),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    const second: TurnCompletionEvent = {
      completion: completion({ turnId: "turn-2" }),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:01.000Z",
    };
    const text = [turnCompletionEventLine({ event: first }), turnCompletionEventLine({ event: second })].join("\n");

    expect(parseTurnCompletionLog({ text })).toEqual({ events: [first, second], unreadable: [] });
  });
});

describe("parseTurnCompletionLog — tolerance", () => {
  it("reads an empty log as no events and nothing unreadable", () => {
    expect(parseTurnCompletionLog({ text: "" })).toEqual({ events: [], unreadable: [] });
  });

  it("skips blank lines without marking them unreadable", () => {
    const event: TurnCompletionEvent = {
      completion: completion(),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    const text = `\n${turnCompletionEventLine({ event })}\n\n`;

    expect(parseTurnCompletionLog({ text })).toEqual({ events: [event], unreadable: [] });
  });

  it("marks a line that is not JSON as unreadable by its 1-indexed line number, without losing the rest", () => {
    const event: TurnCompletionEvent = {
      completion: completion(),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    const text = `not json at all\n${turnCompletionEventLine({ event })}`;

    expect(parseTurnCompletionLog({ text })).toEqual({ events: [event], unreadable: [1] });
  });

  it("marks a line missing schemaVersion as unreadable", () => {
    const line = JSON.stringify({
      completion: completion(),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    });

    expect(parseTurnCompletionLog({ text: line })).toEqual({ events: [], unreadable: [1] });
  });

  it("marks a line whose completion is malformed as unreadable", () => {
    const line = JSON.stringify({
      completion: { ...completion(), workingTs: undefined },
      kind: "turn-completed",
      schemaVersion: 1,
      tsIso: "2026-08-01T00:00:00.000Z",
    });

    expect(parseTurnCompletionLog({ text: line })).toEqual({ events: [], unreadable: [1] });
  });
});
