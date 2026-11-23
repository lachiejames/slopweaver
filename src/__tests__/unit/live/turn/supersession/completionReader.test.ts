/*
 * The completion log, projected into the answers a correction may supersede.
 *
 * Every fixture here is built with the REAL `turnCompletionEventLine`, never a hand-written JSON string: the
 * projection's whole job is to agree with what the writer emits, and a test that writes its own line proves
 * only that two hand-written shapes match each other.
 *
 * The rejection cases feed a log that is not empty — one good row beside each bad one — so "returned
 * nothing" can never pass for "read the file". A `not.toContain` over an input that carries nothing is the
 * silence `.claude/rules/testing.md` names as evidence of nothing.
 */
import { describe, expect, it } from "vitest";

import { turnCompletionEventLine } from "../../../../../live/turn/completionLog.js";
import type { TurnCompletion } from "../../../../../live/turn/envelope.js";
import { answeredPredecessors, predecessorAt } from "../../../../../live/turn/supersession/completionReader.js";

const ASK = { channel: "C_THREAD", messageTs: "1790049834.166409", threadTs: "1790048427.171609" };

/** One real completion, answered, with every field the envelope's own guard requires. */
function answered({
  answerTs,
  turnId = "turn-1790049846181",
  ask = ASK,
}: {
  answerTs: string;
  turnId?: string;
  ask?: { channel: string; messageTs: string; threadTs: string };
}): TurnCompletion {
  return {
    askIdentity: ask,
    primary: { answerTs, kind: "answered" },
    provenance: { modelId: "claude-opus-5" },
    secondaryFailures: [],
    turnId,
    workingTs: "1790049840.000100",
  };
}

/** One real completion that did NOT answer — the arm the projection must drop. */
function failed({ turnId = "turn-failed" }: { turnId?: string } = {}): TurnCompletion {
  return {
    askIdentity: ASK,
    primary: { kind: "failed", reason: "the door held it" },
    provenance: { modelId: "claude-opus-5" },
    secondaryFailures: [],
    turnId,
    workingTs: "1790049840.000200",
  };
}

/** A log built from real lines, in the order given. */
function logOf({ lines }: { lines: readonly string[] }): string {
  return `${lines.join("\n")}\n`;
}

/** One real appended line for a completion. */
function line({ completion, tsIso }: { completion: TurnCompletion; tsIso: string }): string {
  return turnCompletionEventLine({ event: { completion, kind: "turn-completed", tsIso } });
}

describe("answeredPredecessors", () => {
  it("reads an answered turn back with its identity, its turn and the instant it was recorded", () => {
    const text = logOf({
      lines: [line({ completion: answered({ answerTs: "1790054484.916599" }), tsIso: "2026-09-22T06:01:24.000Z" })],
    });

    expect(answeredPredecessors({ text })).toEqual([
      {
        answerTs: "1790054484.916599",
        askIdentity: ASK,
        recordedIso: "2026-09-22T06:01:24.000Z",
        turnId: "turn-1790049846181",
      },
    ]);
  });

  it("is the empty list for a home with no completed turns at all", () => {
    expect(answeredPredecessors({ text: "" })).toEqual([]);
  });

  it("drops a turn that did not answer, and keeps the answered one beside it", () => {
    const text = logOf({
      lines: [
        line({ completion: failed(), tsIso: "2026-09-22T05:00:00.000Z" }),
        line({ completion: answered({ answerTs: "1790054484.916599" }), tsIso: "2026-09-22T06:01:24.000Z" }),
      ],
    });

    const found = answeredPredecessors({ text });
    expect(found.length).toBe(1);
    expect(found[0]!.answerTs).toBe("1790054484.916599");
  });

  it("drops a row whose ask identity is incomplete, keeping the good row in the same log", () => {
    const incomplete = JSON.stringify({
      completion: { ...answered({ answerTs: "1790000000.000001" }), askIdentity: { channel: "C_THREAD" } },
      kind: "turn-completed",
      schemaVersion: 1,
      tsIso: "2026-09-22T05:00:00.000Z",
    });
    const text = logOf({
      lines: [
        incomplete,
        line({ completion: answered({ answerTs: "1790054484.916599" }), tsIso: "2026-09-22T06:01:24.000Z" }),
      ],
    });

    expect(answeredPredecessors({ text }).map((entry) => entry.answerTs)).toEqual(["1790054484.916599"]);
  });

  it("drops a row whose answerTs is not Slack-shaped", () => {
    const text = logOf({
      lines: [
        line({ completion: answered({ answerTs: "not-a-timestamp" }), tsIso: "2026-09-22T05:00:00.000Z" }),
        line({ completion: answered({ answerTs: "1790054484.916599" }), tsIso: "2026-09-22T06:01:24.000Z" }),
      ],
    });

    expect(answeredPredecessors({ text }).map((entry) => entry.answerTs)).toEqual(["1790054484.916599"]);
  });

  it("drops a row whose recorded instant cannot be placed in time", () => {
    const text = logOf({
      lines: [
        line({ completion: answered({ answerTs: "1790000000.000001" }), tsIso: "the other day" }),
        line({ completion: answered({ answerTs: "1790054484.916599" }), tsIso: "2026-09-22T06:01:24.000Z" }),
      ],
    });

    expect(answeredPredecessors({ text }).map((entry) => entry.answerTs)).toEqual(["1790054484.916599"]);
  });
});

describe("predecessorAt", () => {
  const predecessors = answeredPredecessors({
    text: logOf({
      lines: [
        line({ completion: answered({ answerTs: "1790000000.000001" }), tsIso: "2026-09-22T05:00:00.000Z" }),
        line({ completion: answered({ answerTs: "1790054484.916599" }), tsIso: "2026-09-22T06:01:24.000Z" }),
      ],
    }),
  });

  it("finds the answer recorded at one exact timestamp", () => {
    expect(predecessors.length).toBe(2);
    expect(predecessorAt({ answerTs: "1790054484.916599", predecessors })!.recordedIso).toBe(
      "2026-09-22T06:01:24.000Z",
    );
  });

  it("is undefined for a timestamp nothing recorded, rather than the nearest row", () => {
    expect(predecessorAt({ answerTs: "1790054484.916600", predecessors })).toBe(undefined);
  });

  it("takes the LAST row when two name one timestamp", () => {
    const duplicated = answeredPredecessors({
      text: logOf({
        lines: [
          line({
            completion: answered({ answerTs: "1790054484.916599", turnId: "turn-first" }),
            tsIso: "2026-09-22T06:01:24.000Z",
          }),
          line({
            completion: answered({ answerTs: "1790054484.916599", turnId: "turn-second" }),
            tsIso: "2026-09-22T06:02:00.000Z",
          }),
        ],
      }),
    });

    expect(predecessorAt({ answerTs: "1790054484.916599", predecessors: duplicated })!.turnId).toBe("turn-second");
  });
});
