import { describe, expect, it } from "vitest";

import type { AskAction } from "../../../handover/askAction.js";
import { actionOptions } from "../../../handover/askActionOptions.js";
import { type RunDisposition, runDisposition } from "../../../handover/boardTypes.js";
import type { DerivedRowState } from "../../../handover/derivedRowState.js";
import type { DocStatus } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { openQuestionAfter } from "../../../handover/openQuestion.js";
import { type OwnerWait, ownerWaitOf } from "../../../handover/ownerWait.js";
import { latestRulingEvent, type RulingEvidence } from "../../../handover/ruling.js";

const ASKED = "2026-09-16T03:04:38.747Z";

/** The disposition every case below starts from: parked on the owner, asked at {@link ASKED}. */
const WAITING: RunDisposition = {
  action: undefined,
  actionUnreadable: false,
  askedIso: ASKED,
  kind: "waiting-on-owner",
  question: "which option?",
  shape: undefined,
  shapeIso: undefined,
};

function derived({
  status = "ready",
  statusFrom = "authored",
  ruling,
}: {
  status?: DocStatus;
  statusFrom?: DerivedRowState["statusFrom"];
  ruling?: RulingEvidence;
} = {}): DerivedRowState {
  return {
    artifact: undefined,
    datedRulings: [],
    findingRuling: undefined,
    fromRegister: [],
    ruling,
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    status,
    statusFrom,
    statusSummary: undefined,
  };
}

function registerRuling({ decidedIso, words = "option C" }: { decidedIso: string; words?: string }): RulingEvidence {
  return {
    decidedIso,
    event: { anchor: "transcript:abc#def", atIso: decidedIso, decidedIso, kind: "ruling", ruling: words },
    from: "register",
  };
}

describe("ownerWaitOf", () => {
  it("is not-waiting when no question is open, whatever else the row carries", () => {
    const wait = ownerWaitOf({ derived: derived(), run: { kind: "active" } });

    expect(wait.kind).toBe("not-waiting");
  });

  it("calls a registered ask owner-held when the board parked it on the owner, with no run behind it", () => {
    const wait = ownerWaitOf({ derived: derived(), registered: { askedIso: ASKED }, run: { kind: "never-started" } });

    expect(wait).toEqual({ askedIso: ASKED, kind: "owner" });
  });

  it("is not-waiting on a run-less row the board did not park on the owner", () => {
    const wait = ownerWaitOf({ derived: derived(), registered: undefined, run: { kind: "never-started" } });

    expect(wait.kind).toBe("not-waiting");
  });

  it("calls an open question owner-held, carrying the instant it was asked", () => {
    const wait = ownerWaitOf({ derived: derived(), run: WAITING });

    expect(wait).toEqual({ askedIso: ASKED, kind: "owner" });
  });

  it("calls a settled row settled, and says which register decided it", () => {
    const wait = ownerWaitOf({
      derived: derived({ status: "done", statusFrom: "settlement" }),
      run: WAITING,
    });

    expect(wait).toEqual({ askedIso: ASKED, kind: "settled", statusFrom: "settlement" });
  });

  it("calls a cancelled row settled too — terminal is terminal, however it got there", () => {
    const wait = ownerWaitOf({
      derived: derived({ status: "cancelled", statusFrom: "abandoned-event" }),
      run: WAITING,
    });

    expect(wait).toEqual({ askedIso: ASKED, kind: "settled", statusFrom: "abandoned-event" });
  });

  it("calls a row the owner ruled on AFTER asking already-ruled, carrying both instants and their words", () => {
    const wait = ownerWaitOf({
      derived: derived({ ruling: registerRuling({ decidedIso: "2026-09-16T05:06:18.877Z" }) }),
      run: WAITING,
    });

    expect(wait).toEqual({
      askedIso: ASKED,
      kind: "already-ruled",
      ruledIso: "2026-09-16T05:06:18.877Z",
      words: "option C",
    });
  });

  it("calls a ruling decided at exactly the asked instant already-ruled — the boundary is inclusive", () => {
    const wait = ownerWaitOf({ derived: derived({ ruling: registerRuling({ decidedIso: ASKED }) }), run: WAITING });

    expect(wait.kind).toBe("already-ruled");
  });

  it("leaves a row whose ruling predates the question owner-held — the owner ruled on something else", () => {
    const wait = ownerWaitOf({
      derived: derived({ ruling: registerRuling({ decidedIso: "2026-09-15T12:05:00.000Z" }) }),
      run: WAITING,
    });

    expect(wait).toEqual({ askedIso: ASKED, kind: "owner" });
  });

  it("leaves a row whose only ruling is AUTHORED owner-held — a front-matter ruling can never date itself", () => {
    const wait = ownerWaitOf({
      derived: derived({ ruling: { anchor: "transcript:abc#def", from: "authored", words: "option C" } }),
      run: WAITING,
    });

    expect(wait).toEqual({ askedIso: ASKED, kind: "owner" });
  });

  it("keeps asking the owner when an instant will not parse, rather than taking a live ask off their list", () => {
    const wait = ownerWaitOf({
      derived: derived({ ruling: registerRuling({ decidedIso: "not a date" }) }),
      run: WAITING,
    });

    expect(wait).toEqual({ askedIso: ASKED, kind: "owner" });
  });

  it("calls a paused row not-runnable, and carries no elapsed time with it", () => {
    const wait = ownerWaitOf({ derived: derived({ status: "paused" }), run: WAITING });

    expect(wait).toEqual({ askedIso: ASKED, kind: "not-runnable" });
  });

  it("puts settled ahead of already-ruled, so a settled row never reads as owing execution", () => {
    const wait = ownerWaitOf({
      derived: derived({
        ruling: registerRuling({ decidedIso: "2026-09-16T05:06:18.877Z" }),
        status: "done",
        statusFrom: "settlement",
      }),
      run: WAITING,
    });

    expect(wait.kind).toBe("settled");
  });

  it("puts already-ruled ahead of not-runnable, because the ruling is the sharper fact", () => {
    const wait = ownerWaitOf({
      derived: derived({ ruling: registerRuling({ decidedIso: "2026-09-16T05:06:18.877Z" }), status: "paused" }),
      run: WAITING,
    });

    expect(wait.kind).toBe("already-ruled");
  });
});

describe("openQuestionAfter", () => {
  const ask: RunEvent = { atIso: ASKED, kind: "question", question: "which option?" };

  it("opens a question at the event's own instant", () => {
    expect(openQuestionAfter({ event: ask, open: undefined })).toEqual({
      action: undefined,
      actionUnreadable: false,
      askedIso: ASKED,
      question: "which option?",
      shape: undefined,
      shapeIso: undefined,
    });
  });

  it("keeps the ORIGINAL instant across a correction — a correction is not a re-ask — and marks its line", () => {
    const open = openQuestionAfter({ event: ask, open: undefined });
    const correction: RunEvent = {
      atIso: "2026-09-20T09:00:00.000Z",
      kind: "question-corrected",
      question: "which of A or C?",
      why: "stale",
    };

    const corrected = openQuestionAfter({ event: correction, open });

    expect(corrected).toEqual({
      action: undefined,
      actionUnreadable: false,
      askedIso: ASKED,
      question: "which of A or C?",
      restatedBy: correction,
      shape: undefined,
      shapeIso: undefined,
    });
  });

  it("ignores a correction when nothing is open", () => {
    const corrected = openQuestionAfter({
      event: {
        atIso: "2026-09-20T09:00:00.000Z",
        kind: "question-corrected",
        question: "which of A or C?",
        why: "stale",
      },
      open: undefined,
    });

    expect(corrected).toBe(undefined);
  });

  it("clears on an answer", () => {
    const open = openQuestionAfter({ event: ask, open: undefined });

    expect(
      openQuestionAfter({ event: { atIso: "2026-09-20T09:00:00.000Z", answer: "C", kind: "answered" }, open }),
    ).toBe(undefined);
  });

  it("leaves a ruling inert — a ruling is not an answer, and must not close the question it followed", () => {
    const open = openQuestionAfter({ event: ask, open: undefined });

    const after = openQuestionAfter({
      event: {
        anchor: "transcript:abc#def",
        atIso: "2026-09-16T05:06:18.877Z",
        kind: "ruling",
        ruling: "option C",
      },
      open,
    });

    expect(after).toEqual({
      action: undefined,
      actionUnreadable: false,
      askedIso: ASKED,
      question: "which option?",
      shape: undefined,
      shapeIso: undefined,
    });
  });
});

describe("ownerWaitOf after a reshape re-cut the question", () => {
  const started: RunEvent = { atIso: "2026-09-16T03:00:00.000Z", branch: "b", docHash: "h", kind: "started" };
  const asked: RunEvent = { atIso: ASKED, kind: "question", question: "three calls: window, accepter, term?" };
  const RESHAPED = "2026-09-29T10:00:06.000Z";
  const reshaped: RunEvent = {
    atIso: RESHAPED,
    kind: "question-shaped",
    lean: "180 days",
    options: [
      { letter: "A", option: "180 days", tradeoff: "half the renewal work" },
      { letter: "B", option: "90 days", tradeoff: "quarterly re-reads" },
    ],
    problem: "the term is the one call left",
    question: "which acceptance term?",
    replaces: "three calls: window, accepter, term?",
    stakes: { blastRadius: "one doc", risk: "the gate stays open", stillReal: "no reply" },
  };
  const ruled = ({ atIso, decidedIso, words }: { atIso: string; decidedIso: string; words: string }): RunEvent => ({
    anchor: "transcript:abc#def",
    atIso,
    decidedIso,
    kind: "ruling",
    ruling: words,
  });
  const window = ruled({ atIso: "2026-09-26T04:18:11.609Z", decidedIso: "2026-09-26T04:18:11.609Z", words: "30" });
  // The verdict over one journal, reading its standing ruling the way the board does.
  const verdict = ({ events }: { events: readonly RunEvent[] }): OwnerWait => {
    const event = latestRulingEvent({ events })!;
    return ownerWaitOf({
      derived: derived({ ruling: { decidedIso: event.decidedIso!, event, from: "register" } }),
      run: runDisposition({ events, unreadableLines: [] }),
    });
  };

  it("is owner-held again when every ruling came before the re-cut, and still dates the ask from when it was asked", () => {
    expect(verdict({ events: [started, asked, window, reshaped] })).toEqual({ askedIso: ASKED, kind: "owner" });
  });

  it("is already-ruled once the owner rules after the re-cut", () => {
    const term = ruled({ atIso: "2026-09-29T11:00:00.000Z", decidedIso: "2026-09-29T11:00:00.000Z", words: "90" });

    expect(verdict({ events: [started, asked, window, reshaped, term] })).toEqual({
      askedIso: ASKED,
      kind: "already-ruled",
      ruledIso: "2026-09-29T11:00:00.000Z",
      words: "90",
    });
  });

  it("counts a ruling decided before the re-cut but journalled after it, which the re-cut cannot have read", () => {
    const relayed = ruled({ atIso: "2026-09-29T10:30:00.000Z", decidedIso: "2026-09-29T09:30:00.000Z", words: "90" });

    expect(verdict({ events: [started, asked, reshaped, relayed] }).kind).toBe("already-ruled");
  });

  it("counts a ruling appended after the re-cut even when stamped before it, as a landing that scanned first is", () => {
    const landed = ruled({ atIso: "2026-09-29T10:00:05.000Z", decidedIso: "2026-09-29T10:00:00.000Z", words: "90" });

    expect(verdict({ events: [started, asked, reshaped, landed] }).kind).toBe("already-ruled");
  });

  it("answers from a ruling after the re-cut even when one it read was decided later", () => {
    const relayed = ruled({ atIso: "2026-09-29T10:30:00.000Z", decidedIso: "2026-09-20T09:00:00.000Z", words: "90" });

    expect(verdict({ events: [started, asked, window, reshaped, relayed] })).toEqual({
      askedIso: ASKED,
      kind: "already-ruled",
      ruledIso: "2026-09-20T09:00:00.000Z",
      words: "90",
    });
  });

  it("treats a ruling appended before the re-cut as read by it, whatever its own stamp says", () => {
    const early = ruled({ atIso: "2026-09-29T10:00:07.000Z", decidedIso: "2026-09-29T10:00:07.000Z", words: "90" });

    expect(verdict({ events: [started, asked, early, reshaped] })).toEqual({ askedIso: ASKED, kind: "owner" });
  });

  it("keeps the rulings the re-cut read across an orphaned cycle, so a reap does not drop the row off the owner's list", () => {
    const orphaned: RunEvent = {
      atIso: "2026-09-29T12:00:00.000Z",
      deadSessionId: "gone",
      kind: "orphaned",
      lastEventIso: RESHAPED,
    };
    const restarted: RunEvent = { ...started, atIso: "2026-09-29T13:00:00.000Z" };

    expect(verdict({ events: [started, asked, window, reshaped, orphaned, restarted] })).toEqual({
      askedIso: ASKED,
      kind: "owner",
    });
  });

  it("moves the boundary to a correction after the re-cut, the latest restatement winning", () => {
    const term = ruled({ atIso: "2026-09-29T11:00:00.000Z", decidedIso: "2026-09-29T11:00:00.000Z", words: "90" });
    const corrected: RunEvent = {
      atIso: "2026-09-29T12:00:00.000Z",
      kind: "question-corrected",
      question: "which acceptance term, now that 90 is out?",
      why: "folded the owner's 11:00Z ruling",
    };

    expect(verdict({ events: [started, asked, reshaped, term, corrected] })).toEqual({
      askedIso: ASKED,
      kind: "owner",
    });
  });
});

describe("ownerWaitOf after a correction or an offer restated the question", () => {
  const started: RunEvent = { atIso: "2026-10-19T10:49:55.043Z", branch: "b", docHash: "h", kind: "started" };
  const QUESTION = "What would you change in the onboarding-flow briefing?";
  const NAG_ASKED = "2026-10-19T11:05:14.856Z";
  const asked: RunEvent = { atIso: NAG_ASKED, kind: "question", question: QUESTION };
  const ruled = ({ atIso, decidedIso, words }: { atIso: string; decidedIso: string; words: string }): RunEvent => ({
    anchor: "talk-call:a0000048#turn",
    atIso,
    decidedIso,
    kind: "ruling",
    ruling: words,
  });
  const steer = ruled({
    atIso: "2026-10-19T11:10:18.557Z",
    decidedIso: "2026-10-19T11:10:18.557Z",
    words: "react to it first",
  });
  const corrected: RunEvent = {
    atIso: "2026-10-19T11:11:15.659Z",
    kind: "question-corrected",
    question: "What would you change in the onboarding-flow briefing? Talk it through and I'll do one pass.",
    why: "folded the owner's 11:10Z ruling",
  };
  const ACTION: AskAction = {
    actor: "me",
    body: "<@U0SYNTOBIAS> the onboarding-flow briefing is ready.",
    destinations: [{ channel: "C01ISO", kind: "channel", label: "Post it to #iso", tradeoff: "the group sees it" }],
    mentions: [{ label: "Tobias", userId: "U0SYNTOBIAS" }],
    version: 1,
  };
  const offered: RunEvent = {
    action: ACTION,
    atIso: "2026-10-19T11:30:00.000Z",
    kind: "question-offered",
    lean: "post it",
    options: actionOptions({ action: ACTION }),
    problem: "the briefing is ready for the group",
    question: QUESTION,
  };
  const verdict = ({ events }: { events: readonly RunEvent[] }): OwnerWait => {
    const event = latestRulingEvent({ events })!;
    return ownerWaitOf({
      derived: derived({ ruling: { decidedIso: event.decidedIso!, event, from: "register" } }),
      run: runDisposition({ events, unreadableLines: [] }),
    });
  };

  it("is owner-held again when the ruling it folded came before the correction, still dated from the first ask", () => {
    expect(verdict({ events: [started, asked, steer, corrected] })).toEqual({ askedIso: NAG_ASKED, kind: "owner" });
  });

  it("is already-ruled once the owner rules after the correction", () => {
    const answer = ruled({
      atIso: "2026-10-19T11:20:00.000Z",
      decidedIso: "2026-10-19T11:20:00.000Z",
      words: "cut the Session section",
    });

    expect(verdict({ events: [started, asked, steer, corrected, answer] })).toEqual({
      askedIso: NAG_ASKED,
      kind: "already-ruled",
      ruledIso: "2026-10-19T11:20:00.000Z",
      words: "cut the Session section",
    });
  });

  it("counts a ruling stamped before the correction but appended after it, which the correction cannot have read", () => {
    const landed = ruled({
      atIso: "2026-10-19T11:11:14.000Z",
      decidedIso: "2026-10-19T11:11:10.000Z",
      words: "cut the Session section",
    });

    expect(verdict({ events: [started, asked, corrected, landed] }).kind).toBe("already-ruled");
  });

  it("keeps the boundary a correction set across an orphaned cycle", () => {
    const orphaned: RunEvent = {
      atIso: "2026-10-19T12:00:00.000Z",
      deadSessionId: "gone",
      kind: "orphaned",
      lastEventIso: "2026-10-19T11:11:15.659Z",
    };
    const restarted: RunEvent = { ...started, atIso: "2026-10-19T13:00:00.000Z" };

    expect(verdict({ events: [started, asked, steer, corrected, orphaned, restarted] })).toEqual({
      askedIso: NAG_ASKED,
      kind: "owner",
    });
  });

  it("is owner-held again when the owner ruled before an offer drafted the message their ruling asked for", () => {
    expect(verdict({ events: [started, asked, steer, offered] })).toEqual({ askedIso: NAG_ASKED, kind: "owner" });
  });

  it("is already-ruled once the owner rules after the offer", () => {
    const send = ruled({ atIso: "2026-10-19T11:40:00.000Z", decidedIso: "2026-10-19T11:40:00.000Z", words: "send it" });

    expect(verdict({ events: [started, asked, offered, send] }).kind).toBe("already-ruled");
  });

  it("leaves the boundary where it was when an offer names a question no longer held", () => {
    const stale: RunEvent = { ...offered, question: "a question since corrected away" };

    expect(verdict({ events: [started, asked, corrected, steer, stale] }).kind).toBe("already-ruled");
  });
});
