/*
 * A run's `question-shot` line: the picture the parked question's card shows, bound to that question's exact text, so a
 * re-ask or a reshape leaves it behind rather than lending it to a different question.
 */
import { describe, expect, it } from "vitest";

import type { HandShot } from "../../../hand/shot.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { ledgerLine, type RunEvent } from "../../../handover/ledger.js";
import { decodeLedgerLine } from "../../../handover/ledgerLineDecode.js";
import { inheritedQuestion, type OpenQuestion, openQuestionAfter } from "../../../handover/openQuestion.js";
import { rowEventIssues } from "../../../handover/rowEventSchema.js";

const QUESTION = "Is running OpenTelemetry beside dd-trace worth a second agent?";

const SHOT: HandShot = {
  boxes: [{ height: 40, label: "empty on every trace", width: 300, x: 120, y: 80 }],
  height: 900,
  sha256: "c".repeat(64),
  width: 1440,
};

const STARTED: RunEvent = { atIso: "2026-10-05T09:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" };

const ASKED: RunEvent = { atIso: "2026-10-05T10:00:00.000Z", kind: "question", question: QUESTION };

const PICTURED: RunEvent = { atIso: "2026-10-05T11:00:00.000Z", kind: "question-shot", question: QUESTION, shot: SHOT };

/** The open question after a run of events, from nothing. */
function after({ events }: { events: readonly RunEvent[] }): OpenQuestion | undefined {
  return events.reduce<OpenQuestion | undefined>((open, event) => openQuestionAfter({ event, open }), undefined);
}

describe("openQuestionAfter over a question-shot", () => {
  it("attaches the picture to the question it names, leaving the asked instant alone", () => {
    const open = after({ events: [ASKED, PICTURED] })!;

    expect([open.shot, open.askedIso]).toEqual([SHOT, "2026-10-05T10:00:00.000Z"]);
  });

  it("binds to nothing when it names a question that is not the one open", () => {
    const stray: RunEvent = { ...PICTURED, question: "a question since answered?" };

    expect(after({ events: [ASKED, stray] })!.shot).toBe(undefined);
  });

  it("is replaced whole by a later one", () => {
    const relabelled: HandShot = { ...SHOT, boxes: [{ ...SHOT.boxes[0]!, label: "stale" }] };
    const again: RunEvent = { ...PICTURED, atIso: "2026-10-05T12:00:00.000Z", shot: relabelled };

    expect(after({ events: [ASKED, PICTURED, again] })!.shot).toEqual(relabelled);
  });

  it("survives a correction, which restates wording and moves no picture", () => {
    const corrected: RunEvent = {
      atIso: "2026-10-05T12:00:00.000Z",
      kind: "question-corrected",
      question: "Is a second tracing agent worth it?",
      why: "tidier",
    };

    expect(after({ events: [ASKED, PICTURED, corrected] })!.shot).toEqual(SHOT);
  });

  it("is never inherited by a new question asked over it", () => {
    const reasked: RunEvent = { atIso: "2026-10-05T12:00:00.000Z", kind: "question", question: "Another one?" };

    expect(after({ events: [ASKED, PICTURED, reasked] })!.shot).toBe(undefined);
  });

  it("is gone once the question is answered", () => {
    const answered: RunEvent = { answer: "no", atIso: "2026-10-05T12:00:00.000Z", kind: "answered" };

    expect(after({ events: [ASKED, PICTURED, answered] })).toBe(undefined);
  });
});

describe("a picture across a dead session's carry", () => {
  const orphaned: RunEvent = {
    atIso: "2026-10-05T11:10:00.000Z",
    cycleEvents: 3,
    deadSessionId: "s1",
    kind: "orphaned",
    lastEventIso: "2026-10-05T11:00:00.000Z",
  };
  const restarted: RunEvent = { ...STARTED, atIso: "2026-10-05T11:20:00.000Z" };
  const events = [STARTED, ASKED, PICTURED, orphaned, restarted];

  it("carries into the inherited question", () => {
    expect(inheritedQuestion({ events })!.shot).toEqual(SHOT);
  });

  it("reaches the waiting-on-owner disposition a card reads", () => {
    expect(runDisposition({ events, unreadableLines: [] })).toMatchObject({ kind: "waiting-on-owner", shot: SHOT });
  });
});

describe("the question-shot journal line", () => {
  it("round-trips through the ledger line and its decoder", () => {
    expect(decodeLedgerLine({ line: ledgerLine({ event: PICTURED }) })).toEqual(PICTURED);
  });

  it("is refused by the write schema with no box, and passes whole", () => {
    const unboxed = { ...PICTURED, shot: { ...SHOT, boxes: [] } };

    expect(rowEventIssues({ event: unboxed }).join("\n")).toContain("carries 1 to 9 boxes");
    expect(rowEventIssues({ event: PICTURED })).toEqual([]);
  });

  // `shot` is a field-level `z.unknown()`, which Zod treats as optional — so an absent key must still reach the rule.
  it("is refused by the write schema with no picture at all", () => {
    const bare = { atIso: PICTURED.atIso, kind: "question-shot", question: QUESTION };

    expect(rowEventIssues({ event: bare }).join("\n")).toContain("shot is missing");
  });
});
