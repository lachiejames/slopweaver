import { describe, expect, it } from "vitest";

import { phaseRefusal } from "../../../cli/commands/handover/phaseRefusal.js";
import { stillRealLine } from "../../../cli/commands/handover/reconfirmRun.js";
import type { AskAction } from "../../../handover/askAction.js";
import { actionOptions } from "../../../handover/askActionOptions.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { ledgerLine, type RunEvent } from "../../../handover/ledger.js";
import { decodeLedgerLine } from "../../../handover/ledgerLineDecode.js";
import { inheritedQuestion, type OpenQuestion, openQuestionAfter } from "../../../handover/openQuestion.js";
import { rowEventIssues } from "../../../handover/rowEventSchema.js";

const QUESTION = "Delete the v2 work-console branch?";

const STARTED: RunEvent = { atIso: "2026-09-22T09:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" };

const ASKED: RunEvent = { atIso: "2026-09-22T10:00:00.000Z", kind: "question", question: QUESTION };

const RECONFIRMED: RunEvent = {
  atIso: "2026-09-23T15:00:00.000Z",
  kind: "question-reconfirmed",
  question: QUESTION,
  stillReal: "github read shows the branch still exists and no reply in the DM thread",
};

const ACTION: AskAction = {
  actor: "me",
  body: "<@U01ARI> ready for review.",
  destinations: [
    { channel: "C01SDLC", kind: "channel", label: "Post it to #delivery", tradeoff: "the channel sees it" },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

const OFFERED: RunEvent = {
  action: ACTION,
  atIso: "2026-09-23T16:00:00.000Z",
  kind: "question-offered",
  lean: "post it",
  options: actionOptions({ action: ACTION }),
  problem: "nobody has reviewed it",
  question: QUESTION,
};

/** The open question after a run of events, from nothing. */
function after({ events }: { events: readonly RunEvent[] }): OpenQuestion | undefined {
  return events.reduce<OpenQuestion | undefined>((open, event) => openQuestionAfter({ event, open }), undefined);
}

describe("openQuestionAfter over a reconfirm", () => {
  it("records the check and its instant on the question it names, leaving the asked instant alone", () => {
    const open = after({ events: [ASKED, RECONFIRMED] })!;

    expect(open.reconfirmed).toEqual({
      atIso: "2026-09-23T15:00:00.000Z",
      stillReal: "github read shows the branch still exists and no reply in the DM thread",
    });
    expect(open.askedIso).toBe("2026-09-22T10:00:00.000Z");
  });

  it("binds to nothing when it names a question that is not the one open", () => {
    const stray: RunEvent = { ...RECONFIRMED, question: "a question since answered" };

    expect(after({ events: [ASKED, stray] })!.reconfirmed).toBe(undefined);
  });

  it("survives a correction, which restates wording and re-checks nothing", () => {
    const corrected: RunEvent = {
      atIso: "2026-09-23T15:30:00.000Z",
      kind: "question-corrected",
      question: "Delete it?",
      why: "tidier",
    };

    expect(after({ events: [ASKED, RECONFIRMED, corrected] })!.reconfirmed!.atIso).toBe("2026-09-23T15:00:00.000Z");
  });

  it("is dropped by a later offer, which is itself the newer confirmation", () => {
    const open = after({ events: [ASKED, RECONFIRMED, OFFERED] })!;

    expect([open.reconfirmed, open.shapeIso]).toEqual([undefined, "2026-09-23T16:00:00.000Z"]);
  });

  it("never decorates a new question asked after an answer", () => {
    const answered: RunEvent = { answer: "yes", atIso: "2026-09-23T17:00:00.000Z", kind: "answered" };
    const next: RunEvent = { atIso: "2026-09-23T18:00:00.000Z", kind: "question", question: "Something else?" };

    expect(after({ events: [ASKED, RECONFIRMED, answered, next] })!.reconfirmed).toBe(undefined);
  });
});

describe("the reconfirm across a dead session", () => {
  const orphaned: RunEvent = {
    atIso: "2026-09-23T15:10:00.000Z",
    cycleEvents: 3,
    deadSessionId: "s1",
    kind: "orphaned",
    lastEventIso: "2026-09-23T15:00:00.000Z",
  };
  const restarted: RunEvent = { ...STARTED, atIso: "2026-09-23T15:20:00.000Z" };

  it("carries into the inherited question", () => {
    const inherited = inheritedQuestion({ events: [STARTED, ASKED, RECONFIRMED, orphaned, restarted] })!;

    expect(inherited.reconfirmed!.atIso).toBe("2026-09-23T15:00:00.000Z");
  });

  it("reaches the waiting-on-owner disposition a card reads", () => {
    const run = runDisposition({ events: [STARTED, ASKED, RECONFIRMED, orphaned, restarted], unreadableLines: [] });

    expect(run).toMatchObject({
      askedIso: "2026-09-22T10:00:00.000Z",
      kind: "waiting-on-owner",
      reconfirmed: { atIso: "2026-09-23T15:00:00.000Z" },
    });
  });
});

describe("the question-reconfirmed journal line", () => {
  it("round-trips through the ledger line and its decoder", () => {
    expect(decodeLedgerLine({ line: ledgerLine({ event: RECONFIRMED }) })).toEqual(RECONFIRMED);
  });

  it("is refused by the write schema without its check", () => {
    const bare = { atIso: RECONFIRMED.atIso, kind: "question-reconfirmed", question: QUESTION };

    expect(rowEventIssues({ event: bare }).join("\n")).toContain("stillReal");
    expect(rowEventIssues({ event: RECONFIRMED })).toEqual([]);
  });
});

describe("stillRealLine", () => {
  it("trims one line", () => {
    expect(stillRealLine({ value: "  checked it  " })).toBe("checked it");
  });

  it("refuses an absent, blank or multi-line value", () => {
    expect([
      stillRealLine({ value: undefined }),
      stillRealLine({ value: "  " }),
      stillRealLine({ value: "a\nb" }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("phaseRefusal for reconfirm", () => {
  it("refuses a run that is not waiting on the owner", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "open", verb: "reconfirm" })).toContain(
      "no open question to re-confirm",
    );
  });

  it("admits a run that is", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "waiting-on-owner", verb: "reconfirm" })).toBe(undefined);
  });
});
