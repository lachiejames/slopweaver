import { describe, expect, it } from "vitest";

import type { AskAction } from "../../../handover/askAction.js";
import { actionOptions } from "../../../handover/askActionOptions.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { ledgerLine, type RunEvent } from "../../../handover/ledger.js";
import { decodeLedgerLine } from "../../../handover/ledgerLineDecode.js";
import { inheritedQuestion, type OpenQuestion, openQuestionAfter } from "../../../handover/openQuestion.js";

/** The draft an offer attaches. */
const ACTION: AskAction = {
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is ready for review.",
  destinations: [
    {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are asking",
    },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

const QUESTION = "Do you want to post this into #delivery?";

/** The question the offer attaches to. */
const ASKED: RunEvent = { atIso: "2026-09-22T11:00:00.000Z", kind: "question", question: QUESTION };

/**
 * The offer itself, as `handover offer` appends one.
 *
 * Its options come from {@link actionOptions} rather than being written out here, because that is what both
 * the verb and the decoder do — a restated copy went stale against `HOLD_OPTION`'s own trade-off the first
 * time this fixture was written, which is the whole class the derivation exists to close.
 */
const OFFERED: RunEvent = {
  action: ACTION,
  atIso: "2026-09-22T11:30:00.000Z",
  kind: "question-offered",
  lean: "take A, because #delivery is where a review gets picked up",
  options: actionOptions({ action: ACTION }),
  problem: "the E2E switch-over has sat unreviewed for four days",
  question: QUESTION,
};

/** The open question after a run of events, from nothing. */
function after({ events }: { events: readonly RunEvent[] }): OpenQuestion | undefined {
  return events.reduce<OpenQuestion | undefined>((open, event) => openQuestionAfter({ event, open }), undefined);
}

describe("openQuestionAfter over an offer", () => {
  it("leaves a plain ask carrying no action, which is most of them", () => {
    expect(after({ events: [ASKED] })).toEqual({
      action: undefined,
      actionUnreadable: false,
      askedIso: "2026-09-22T11:00:00.000Z",
      question: QUESTION,
      shape: undefined,
    });
  });

  it("attaches the action and the whole shape together, keeping when the question was ASKED", () => {
    expect(after({ events: [ASKED, OFFERED] })).toEqual({
      action: ACTION,
      actionUnreadable: false,
      askedIso: "2026-09-22T11:00:00.000Z",
      question: QUESTION,
      restatedBy: OFFERED,
      shape: { lean: OFFERED.lean, options: OFFERED.options, problem: OFFERED.problem, stakes: undefined },
      shapeIso: OFFERED.atIso,
    });
  });

  it("records the action on the question itself when `handover ask --action` carried one", () => {
    const asked: RunEvent = { ...ASKED, action: ACTION };
    expect(after({ events: [asked] })!.action).toEqual(ACTION);
  });

  it("ignores an offer naming a question nobody is holding any more", () => {
    const other: RunEvent = { ...OFFERED, question: "a different ask entirely" };
    expect(after({ events: [ASKED, other] })).toEqual({
      action: undefined,
      actionUnreadable: false,
      askedIso: "2026-09-22T11:00:00.000Z",
      question: QUESTION,
      shape: undefined,
    });
  });

  it("keeps the action across a correction, which only changes the words", () => {
    const corrected: RunEvent = {
      atIso: "2026-09-22T12:00:00.000Z",
      kind: "question-corrected",
      question: "Post this into #delivery, or DM Ari?",
      why: "the first reading was ambiguous",
    };
    expect(after({ events: [ASKED, OFFERED, corrected] })).toEqual({
      action: ACTION,
      actionUnreadable: false,
      askedIso: "2026-09-22T11:00:00.000Z",
      question: "Post this into #delivery, or DM Ari?",
      restatedBy: corrected,
      shape: { lean: OFFERED.lean, options: OFFERED.options, problem: OFFERED.problem, stakes: undefined },
      shapeIso: OFFERED.atIso,
    });
  });

  it("never inherits a draft onto the NEXT ask, which is a decision about something else", () => {
    const answered: RunEvent = { answer: "post it", atIso: "2026-09-22T13:00:00.000Z", kind: "answered" };
    const again: RunEvent = { atIso: "2026-09-22T14:00:00.000Z", kind: "question", question: "And the follow-up?" };
    expect(after({ events: [ASKED, OFFERED, answered, again] })!.action).toBeUndefined();
  });

  it("settles on an answer, offer and all", () => {
    const answered: RunEvent = { answer: "post it", atIso: "2026-09-22T13:00:00.000Z", kind: "answered" };
    expect(after({ events: [ASKED, OFFERED, answered] })).toBeUndefined();
  });
});

describe("inheritedQuestion over an offer", () => {
  it("carries the offer across a cycle whose session died holding it", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
      ASKED,
      OFFERED,
      {
        atIso: "2026-09-22T12:00:00.000Z",
        deadSessionId: "s1",
        kind: "orphaned",
        lastEventIso: "2026-09-22T11:30:00.000Z",
      },
      { atIso: "2026-09-22T13:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
    ];
    const carried = inheritedQuestion({ events });
    expect(carried!.question).toBe(QUESTION);
    expect(carried!.action).toEqual(ACTION);
  });

  it("does not carry an offer that named a question the cycle had already replaced", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
      ASKED,
      { atIso: "2026-09-22T11:10:00.000Z", kind: "question", question: "A newer ask" },
      OFFERED,
      {
        atIso: "2026-09-22T12:00:00.000Z",
        deadSessionId: "s1",
        kind: "orphaned",
        lastEventIso: "2026-09-22T11:30:00.000Z",
      },
      { atIso: "2026-09-22T13:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
    ];
    const carried = inheritedQuestion({ events });
    expect(carried!.question).toBe("A newer ask");
    expect(carried!.action).toBeUndefined();
  });
});

describe("the offer through the journal", () => {
  it("round-trips whole — a line written by this build reads back as the same event", () => {
    expect(decodeLedgerLine({ line: ledgerLine({ event: OFFERED }) })).toEqual(OFFERED);
  });

  it("round-trips a question that carried its action from the start", () => {
    const asked: RunEvent = { ...ASKED, action: ACTION, options: actionOptions({ action: ACTION }) };
    expect(decodeLedgerLine({ line: ledgerLine({ event: asked }) })).toEqual(asked);
  });

  // The journal is a shared, hand-editable file, so the write-side refusal of `--options` beside `--action`
  // is only half the guarantee. A line naming a DM the draft does not offer reads back as the derived pair,
  // so no card can print their choice over a different message.
  it("re-derives the options of a hand-edited line rather than reading the list it stored", () => {
    const line = ledgerLine({ event: OFFERED }).replace(
      '"option":"Post it to #delivery"',
      '"option":"DM Tobias instead"',
    );

    expect(decodeLedgerLine({ line })).toEqual(OFFERED);
    expect(line).toContain("DM Tobias instead");
  });

  it("drops an offer whose action a hand-edit broke, rather than decoding a half of it", () => {
    const line = ledgerLine({ event: OFFERED }).replace('"actor":"me"', '"actor":"bot"');
    expect(decodeLedgerLine({ line })).toBeUndefined();
  });
});

describe("openQuestionAfter — the stakes and the instant they were confirmed", () => {
  const STAKES = { blastRadius: "one PR", risk: "the review lapses again", stillReal: "the PR is still open" };
  const SHAPED: RunEvent = {
    ...ASKED,
    lean: OFFERED.lean,
    options: OFFERED.options,
    problem: OFFERED.problem,
    stakes: STAKES,
  };

  it("dates the still-real check to the question that stated it", () => {
    const open = after({ events: [SHAPED] })!;

    expect(open.shape!.stakes).toEqual(STAKES);
    expect(open.shapeIso).toBe(SHAPED.atIso);
  });

  it("carries no instant for a free-text ask, which has no check to date", () => {
    expect(after({ events: [ASKED] })!.shapeIso).toBeUndefined();
  });

  it("drops the held stakes when an offer states none, because an offer replaces the shape whole", () => {
    const open = after({ events: [SHAPED, OFFERED] })!;

    expect(open.shape!.stakes).toBeUndefined();
    expect(open.shapeIso).toBe(OFFERED.atIso);
  });

  it("takes the stakes and the instant of an offer that states its own", () => {
    const restaked = { ...STAKES, stillReal: "re-read the PR at the offer" };
    const offered: RunEvent = { ...OFFERED, stakes: restaked };
    const open = after({ events: [SHAPED, offered] })!;

    expect(open.shape!.stakes).toEqual(restaked);
    expect(open.shapeIso).toBe(OFFERED.atIso);
  });

  it("keeps the instant across a correction, which changes the words and not the check", () => {
    const corrected: RunEvent = {
      atIso: "2026-09-22T12:00:00.000Z",
      kind: "question-corrected",
      question: "Post it, or hold?",
      why: "clearer",
    };

    expect(after({ events: [SHAPED, corrected] })!.shapeIso).toBe(SHAPED.atIso);
  });
});

describe("runDisposition — the still-real instant across a dead session", () => {
  const cycleAfterDeath = ({ offer }: { offer: boolean }): readonly RunEvent[] => [
    { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
    { ...ASKED, lean: OFFERED.lean, options: OFFERED.options, problem: OFFERED.problem },
    ...(offer ? [OFFERED] : []),
    {
      atIso: "2026-09-22T12:00:00.000Z",
      cycleEvents: 3,
      deadSessionId: "s1",
      kind: "orphaned",
      lastEventIso: "2026-09-22T11:30:00.000Z",
    },
    { atIso: "2026-09-22T13:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
  ];

  it("dates an inherited offer's check to the offer, not to the older question it attached to", () => {
    const run = runDisposition({ events: cycleAfterDeath({ offer: true }), unreadableLines: [] });

    expect(run).toMatchObject({ kind: "waiting-on-owner", shapeIso: OFFERED.atIso });
  });

  it("dates an inherited question with no offer to the question itself", () => {
    const run = runDisposition({ events: cycleAfterDeath({ offer: false }), unreadableLines: [] });

    expect(run).toMatchObject({ kind: "waiting-on-owner", shapeIso: ASKED.atIso });
  });
});
