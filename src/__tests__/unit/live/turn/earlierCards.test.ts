/**
 * Which messages an ask published before its answer — pure, so every source and every exclusion is a plain call.
 * `live/turn/earlierCards.ts` carries the owner ruling and the incident.
 */
import { describe, expect, it } from "vitest";

import type { AskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import { earlierCardsOf } from "../../../../live/turn/earlierCards.js";
import type { TurnCompletion } from "../../../../live/turn/envelope.js";

const ASK = { channel: "C1", messageTs: "1712345000.000100", threadTs: "1712340000.000100" } as const;
const OTHER_ASK = { ...ASK, messageTs: "1712345999.000900" } as const;

/** A completion on {@link ASK} unless the override says otherwise. */
function completion(over: Readonly<Partial<TurnCompletion>>): TurnCompletion {
  return {
    askIdentity: ASK,
    primary: { kind: "failed", noticeTs: "1712345002.000000", reason: "refused" },
    provenance: { modelId: "m" },
    secondaryFailures: [],
    turnId: "turn-1",
    workingTs: "1712345001.000000",
    ...over,
  };
}

const T = "2026-09-07T08:00:00.000Z";

describe("earlierCardsOf", () => {
  it("names a refused turn's checklist AND its failure card — the measured pair", () => {
    expect(earlierCardsOf({ askEvents: [], askIdentity: ASK, completions: [completion({})] })).toEqual([
      { channel: "C1", ts: "1712345001.000000" },
      { channel: "C1", ts: "1712345002.000000" },
    ]);
  });

  it("names a withheld turn's held notice and an answer-lost turn's notice", () => {
    const withheld = completion({
      primary: { held: { code: "W", id: "q-1", reason: "held" }, kind: "withheld", noticeTs: "1712345004.000000" },
      turnId: "turn-2",
      workingTs: "1712345003.000000",
    });
    const lost = completion({
      primary: { kind: "answer-lost", noticeTs: "1712345006.000000", reason: "threw" },
      turnId: "turn-3",
      workingTs: "1712345005.000000",
    });

    expect(
      earlierCardsOf({ askEvents: [], askIdentity: ASK, completions: [withheld, lost] }).map((card) => card.ts),
    ).toEqual(["1712345003.000000", "1712345004.000000", "1712345005.000000", "1712345006.000000"]);
  });

  /**
   * THE 24 AUG 2026 SUPERSEDED FAILURE NOTICE — the shape the handover
   * `superseded-failure-notice-is-never-withdrawn` was filed for, pinned so it cannot regress.
   *
   * Channel `C0SYN000012`, ask `1787540563.699759`, turn `turn-1787540564944`. It has TWO completions in
   * `ledgers/turn-completions.jsonl` under ONE `turnId`: `primary.kind: failed` with
   * `noticeTs 1787541719.972659` at 03:21:59.944Z, then `primary.kind: answered` with
   * `answerTs 1787542293.740089` at 03:31:37.450Z. So a card reading "I could not answer — the turn did not
   * complete" stood 9m34s above the card answering the same ask, and the owner read the pair as a double
   * answer.
   *
   * The handover's premise — *"`noticeTs` is read back by nothing"* — was true when it was filed and stopped
   * being true when `live/turn/earlierCards.ts` landed. This is the witness for that: the notice is named as
   * a card to reap and the answer is protected, from the same two rows the ledger actually held. Every
   * timestamp below is the real one.
   */
  it("reaps the notice of a turn that FAILED and then ANSWERED under one turnId — C0SYN000012", () => {
    const supersededAsk = {
      channel: "C0SYN000012",
      messageTs: "1787540563.699759",
      threadTs: "1787539401.542749",
    } as const;
    const failed = completion({
      askIdentity: supersededAsk,
      primary: { kind: "failed", noticeTs: "1787541719.972659", reason: "ANSWER_CLAIM_UNRESOLVED" },
      turnId: "turn-1787540564944",
      workingTs: "1787540565.567269",
    });
    const answered = completion({
      askIdentity: supersededAsk,
      primary: { answerTs: "1787542293.740089", kind: "answered" },
      turnId: "turn-1787540564944",
      workingTs: "1787540565.567269",
    });

    const reaped = earlierCardsOf({
      askEvents: [],
      askIdentity: supersededAsk,
      completions: [failed, answered],
    }).map((card) => card.ts);

    // The working card the two turns shared, then the superseded notice — and never the answer.
    expect(reaped).toEqual(["1787540565.567269", "1787541719.972659"]);
    expect(reaped).not.toContain("1787542293.740089");
  });

  it("names a failed turn whose own notice never posted by its checklist alone", () => {
    const noNotice = completion({ primary: { kind: "failed", reason: "the notice was refused too" } });

    expect(earlierCardsOf({ askEvents: [], askIdentity: ASK, completions: [noNotice] })).toEqual([
      { channel: "C1", ts: "1712345001.000000" },
    ]);
  });

  it("never names an earlier REAL answer — a re-answered ask keeps it standing", () => {
    const earlierAnswer = completion({ primary: { answerTs: "1712345002.000000", kind: "answered" } });
    const answeredEvent: AskLifecycleEvent = { ...ASK, answerTs: "1712345010.000000", kind: "answered", tsIso: T };
    const blockedTagSameTs: AskLifecycleEvent = {
      ...ASK,
      kind: "blocked-on-human",
      need: "sign-in",
      stepText: "s",
      tagTs: "1712345010.000000",
      tsIso: T,
      what: "w",
    };

    expect(
      earlierCardsOf({ askEvents: [answeredEvent, blockedTagSameTs], askIdentity: ASK, completions: [earlierAnswer] }),
    ).toEqual([{ channel: "C1", ts: "1712345001.000000" }]);
  });

  it("never names a posted PLAN — a first answer stands when the final answer reaps, only its checklist goes", () => {
    const plan = completion({
      primary: {
        answerDigest: "digest-of-the-plan",
        answerTs: "1712345002.000000",
        followThrough: { owes: "pull-requests", what: "open the two pull requests" },
        kind: "first-answered",
      },
    });
    const planEvent: AskLifecycleEvent = {
      ...ASK,
      answerDigest: "digest-of-the-plan",
      answerTs: "1712345002.000000",
      kind: "first-answered",
      leaseExpiresAt: "2026-09-07T10:00:00.000Z",
      owes: "pull-requests",
      tsIso: T,
      what: "open the two pull requests",
    };
    const tagOnThePlanTs: AskLifecycleEvent = {
      ...ASK,
      kind: "blocked-on-human",
      need: "sign-in",
      stepText: "s",
      tagTs: "1712345002.000000",
      tsIso: T,
      what: "w",
    };

    expect(earlierCardsOf({ askEvents: [planEvent, tagOnThePlanTs], askIdentity: ASK, completions: [plan] })).toEqual([
      { channel: "C1", ts: "1712345001.000000" },
    ]);
  });

  it("names the capture-time checklist and a blocked-on-human tag from the ask log", () => {
    const events: readonly AskLifecycleEvent[] = [
      { ...ASK, kind: "checklist-posted", tsIso: T, turnId: "turn-0", workingTs: "1712345000.500000" },
      {
        ...ASK,
        kind: "blocked-on-human",
        need: "sign-in",
        stepText: "s",
        tagTs: "1712345007.000000",
        tsIso: T,
        what: "w",
      },
    ];

    expect(earlierCardsOf({ askEvents: events, askIdentity: ASK, completions: [] }).map((card) => card.ts)).toEqual([
      "1712345000.500000",
      "1712345007.000000",
    ]);
  });

  it("ignores every record of a different ask in the same thread", () => {
    const events: readonly AskLifecycleEvent[] = [
      { ...OTHER_ASK, kind: "checklist-posted", tsIso: T, turnId: "turn-9", workingTs: "1712345900.000000" },
    ];

    expect(
      earlierCardsOf({ askEvents: events, askIdentity: ASK, completions: [completion({ askIdentity: OTHER_ASK })] }),
    ).toEqual([]);
  });

  it("names a card two records share once, in timestamp order", () => {
    const events: readonly AskLifecycleEvent[] = [
      { ...ASK, kind: "checklist-posted", tsIso: T, turnId: "turn-1", workingTs: "1712345001.000000" },
    ];
    const later = completion({
      turnId: "turn-2",
      workingTs: "1712345011.000000",
      primary: { kind: "failed", reason: "r" },
    });

    expect(
      earlierCardsOf({ askEvents: events, askIdentity: ASK, completions: [later, completion({})] }).map(
        (card) => card.ts,
      ),
    ).toEqual(["1712345001.000000", "1712345002.000000", "1712345011.000000"]);
  });

  it("names nothing for an ask with no records", () => {
    expect(earlierCardsOf({ askEvents: [], askIdentity: ASK, completions: [] })).toEqual([]);
  });
});
