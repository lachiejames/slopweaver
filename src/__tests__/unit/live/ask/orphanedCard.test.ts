/**
 * `orphanedCardVerdict` — the pure judgement behind `turn retire-card`. Every refusal is a way a card could
 * still be somebody's, so each case below builds the one log that should trip it and asserts the exact code.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { AskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import { OrphanedCardErrors, orphanedCardVerdict } from "../../../../live/ask/orphanedCard.js";

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };
const SUB = { channel: "C1", messageTs: "1785000000.000300", threadTs: "1785000000.000100" };
const FIRST_CARD = "1785000001.000100";
const SECOND_CARD = "1785000002.000100";

const captured = ({ ask = ASK }: { ask?: typeof ASK } = {}): AskLifecycleEvent => ({
  ...ask,
  kind: "captured",
  surface: "channel",
  tsIso: "2026-08-05T13:26:00.000Z",
  userId: "U1",
});

const posted = ({
  ask = ASK,
  turnId,
  workingTs,
}: {
  ask?: typeof ASK;
  turnId: string;
  workingTs: string;
}): AskLifecycleEvent => ({
  ...ask,
  kind: "checklist-posted",
  tsIso: "2026-08-05T13:26:01.000Z",
  turnId,
  workingTs,
});

const triaged = ({ ask = ASK }: { ask?: typeof ASK } = {}): AskLifecycleEvent => ({
  ...ask,
  kind: "triaged-no-response",
  reason: "nothing owed",
  tsIso: "2026-08-05T13:30:00.000Z",
});

const failed: AskLifecycleEvent = { ...ASK, kind: "failed", reason: "worker broke", tsIso: "2026-08-05T13:30:00.000Z" };

/** The incident shape: two cards on one ask, the later one current, then an ending that settled only it. */
const TWO_CARDS_THEN_TRIAGED: readonly AskLifecycleEvent[] = [
  captured(),
  posted({ turnId: "turn-first", workingTs: FIRST_CARD }),
  posted({ turnId: "turn-second", workingTs: SECOND_CARD }),
  triaged(),
];

describe("orphanedCardVerdict", () => {
  it("clears the EARLIER card of an ended ask, carrying the turn id it was posted under", () => {
    const verdict = orphanedCardVerdict({ askIdentity: ASK, events: TWO_CARDS_THEN_TRIAGED, workingTs: FIRST_CARD });

    expect(verdict.isOk()).toBe(true);
    expect(unwrap(verdict)).toEqual({ turnId: "turn-first", workingTs: FIRST_CARD });
  });

  it("refuses the ask's CURRENT card — the one `startedRefForAsk` names", () => {
    const verdict = orphanedCardVerdict({ askIdentity: ASK, events: TWO_CARDS_THEN_TRIAGED, workingTs: SECOND_CARD });

    expect(unwrapErr(verdict).code).toBe("CARD_IS_CURRENT");
  });

  it("refuses a ts this ask never posted a card on", () => {
    const verdict = orphanedCardVerdict({
      askIdentity: ASK,
      events: TWO_CARDS_THEN_TRIAGED,
      workingTs: "1785000099.000100",
    });

    expect(unwrapErr(verdict).code).toBe("NOT_THIS_ASKS_CARD");
  });

  it("refuses the ask's SOLE card when it was logged before the capture, which the fold never applied", () => {
    const events = [posted({ turnId: "turn-first", workingTs: FIRST_CARD }), captured(), triaged()];

    const verdict = orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD });

    expect(unwrapErr(verdict).code).toBe("CARD_IS_CURRENT");
  });

  it("refuses a card logged twice whose LATER recording is the ask's latest card", () => {
    const events = [
      posted({ turnId: "turn-first", workingTs: FIRST_CARD }),
      posted({ turnId: "turn-second", workingTs: SECOND_CARD }),
      posted({ turnId: "turn-third", workingTs: FIRST_CARD }),
      captured(),
      triaged(),
    ];

    const verdict = orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD });

    expect(unwrapErr(verdict).code).toBe("CARD_IS_CURRENT");
  });

  it("refuses when the only ending was logged before the capture, since the fold never applied it", () => {
    const events = [
      posted({ turnId: "turn-first", workingTs: FIRST_CARD }),
      posted({ turnId: "turn-second", workingTs: SECOND_CARD }),
      triaged(),
      captured(),
    ];

    const verdict = orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD });

    expect(unwrapErr(verdict).code).toBe("ASK_NOT_TERMINAL");
  });

  it("refuses an ask that was never captured", () => {
    const verdict = orphanedCardVerdict({ askIdentity: ASK, events: [], workingTs: FIRST_CARD });

    expect(unwrapErr(verdict).code).toBe("ASK_NOT_CAPTURED");
  });

  it("refuses an ask that has not ended — a failed turn may still be re-dispatched", () => {
    const events = [...TWO_CARDS_THEN_TRIAGED.slice(0, 3), failed];

    const verdict = orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD });

    expect(unwrapErr(verdict).code).toBe("ASK_NOT_TERMINAL");
  });

  it("refuses an ask a later event reopened after its ending, naming that event", () => {
    const events = [...TWO_CARDS_THEN_TRIAGED, posted({ turnId: "turn-third", workingTs: "1785000003.000100" })];

    const verdict = orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD });

    const error = unwrapErr(verdict);
    expect(error.code).toBe("ASK_REOPENED");
    expect(error.message).toContain("`checklist-posted`");
  });

  it("refuses even a redelivered capture after the ending, because the fold reopens the ask on one", () => {
    const events = [...TWO_CARDS_THEN_TRIAGED, captured()];

    const verdict = orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD });

    expect(unwrapErr(verdict)).toEqual(
      OrphanedCardErrors.askReopened({ reopenedBy: "captured", subject: `C1/${ASK.messageTs}` }),
    );
  });

  it("refuses a card an unfinished sub-ask rode, naming the holder", () => {
    const events = [
      ...TWO_CARDS_THEN_TRIAGED,
      captured({ ask: SUB }),
      posted({ ask: SUB, turnId: "turn-first", workingTs: FIRST_CARD }),
    ];

    const verdict = orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD });

    const error = unwrapErr(verdict);
    expect(error.code).toBe("CARD_HELD_BY_OPEN_ASK");
    expect(error.message).toContain(`C1/${SUB.messageTs}`);
  });

  it("refuses a card held by a sub-ask whose latest event is a FAILED attempt, which a re-dispatch may resume", () => {
    const events = [
      ...TWO_CARDS_THEN_TRIAGED,
      captured({ ask: SUB }),
      posted({ ask: SUB, turnId: "turn-first", workingTs: FIRST_CARD }),
      { ...failed, messageTs: SUB.messageTs },
    ];

    const verdict = orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD });

    expect(unwrapErr(verdict).code).toBe("CARD_HELD_BY_OPEN_ASK");
  });

  it("clears a card once the sub-ask that rode it has ended too", () => {
    const events = [
      ...TWO_CARDS_THEN_TRIAGED,
      captured({ ask: SUB }),
      posted({ ask: SUB, turnId: "turn-first", workingTs: FIRST_CARD }),
      triaged({ ask: SUB }),
    ];

    const verdict = orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD });

    expect(unwrap(verdict)).toEqual({ turnId: "turn-first", workingTs: FIRST_CARD });
  });

  const T = "2026-08-05T13:30:00.000Z";
  const TERMINALS: readonly AskLifecycleEvent[] = [
    { ...ASK, answerTs: "1785000009.000100", kind: "answered", tsIso: T },
    { ...ASK, kind: "triaged-no-response", reason: "nothing owed", tsIso: T },
    { ...ASK, kind: "left-for-a-human", reason: "a person owes it", tsIso: T },
    { ...ASK, answeredByTs: "1785000009.000100", kind: "satisfied-elsewhere", reason: "covered", tsIso: T },
  ];

  it.each(TERMINALS.map((ending) => [ending.kind, ending] as const))(
    "clears the earlier card after a %s ending",
    (_kind, ending) => {
      const events = [...TWO_CARDS_THEN_TRIAGED.slice(0, 3), ending];

      expect(unwrap(orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD }))).toEqual({
        turnId: "turn-first",
        workingTs: FIRST_CARD,
      });
    },
  );

  const NON_ENDINGS: readonly AskLifecycleEvent[] = [
    failed,
    { ...ASK, kind: "dispatch-failed", reason: "no session", tsIso: T },
    { ...ASK, kind: "lease-expired", tsIso: T },
    { ...ASK, kind: "blocked-on-human", need: "sign-in", stepText: "sign in", tsIso: T, what: "sign in" },
    // A withheld answer can still be released, and `turn watch` keeps ticking over one.
    { ...ASK, code: "HELD", kind: "withheld", queueId: "q-1", reason: "held", tsIso: T },
  ];

  it.each(NON_ENDINGS.map((event) => [event.kind, event] as const))(
    "refuses an ask whose last outcome is %s, which is not an ending",
    (_kind, event) => {
      const events = [...TWO_CARDS_THEN_TRIAGED.slice(0, 3), event];

      expect(unwrapErr(orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD })).code).toBe(
        "ASK_NOT_TERMINAL",
      );
    },
  );

  const REOPENERS: readonly AskLifecycleEvent[] = [
    { ...ASK, kind: "redispatched", reason: "stranded", strandedAs: "failed", tsIso: T },
    { ...ASK, kind: "unblocked", lifted: { need: "sign-in", what: "sign in" }, note: "signed in", tsIso: T },
    { ...ASK, kind: "dispatch-failed", reason: "no session", tsIso: T },
  ];

  it.each(REOPENERS.map((event) => [event.kind, event] as const))(
    "refuses an ask a %s event followed after its ending",
    (kind, event) => {
      const error = unwrapErr(
        orphanedCardVerdict({ askIdentity: ASK, events: [...TWO_CARDS_THEN_TRIAGED, event], workingTs: FIRST_CARD }),
      );

      expect(error).toEqual(expect.objectContaining({ code: "ASK_REOPENED", reopenedBy: kind }));
    },
  );

  it("judges by the LAST ending when a failed attempt sits between two", () => {
    const events = [...TWO_CARDS_THEN_TRIAGED, failed, triaged()];

    expect(unwrap(orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD })).workingTs).toBe(FIRST_CARD);
  });

  it("does not count an ask in ANOTHER channel naming the same ts as a holder", () => {
    const elsewhere = { ...SUB, channel: "C2" };
    const events = [
      ...TWO_CARDS_THEN_TRIAGED,
      captured({ ask: elsewhere }),
      posted({ ask: elsewhere, turnId: "turn-x", workingTs: FIRST_CARD }),
    ];

    expect(unwrap(orphanedCardVerdict({ askIdentity: ASK, events, workingTs: FIRST_CARD })).workingTs).toBe(FIRST_CARD);
  });

  it("refuses an unknown card before judging the ask unfinished", () => {
    const events = [...TWO_CARDS_THEN_TRIAGED.slice(0, 3), failed];

    expect(unwrapErr(orphanedCardVerdict({ askIdentity: ASK, events, workingTs: "1785000099.000100" })).code).toBe(
      "NOT_THIS_ASKS_CARD",
    );
  });

  it("refuses the current card before judging the ask unfinished", () => {
    const events = [...TWO_CARDS_THEN_TRIAGED.slice(0, 3), failed];

    expect(unwrapErr(orphanedCardVerdict({ askIdentity: ASK, events, workingTs: SECOND_CARD })).code).toBe(
      "CARD_IS_CURRENT",
    );
  });
});
