import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { phaseRefusal } from "../../../cli/commands/handover/phaseRefusal.js";
import { runHandoverWithdraw } from "../../../cli/commands/handover/withdrawRun.js";
import { EXIT_USAGE } from "../../../cli/exitCodes.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { ledgerLine, type RunEvent, runStateOf } from "../../../handover/ledger.js";
import { decodeLedgerLine } from "../../../handover/ledgerLineDecode.js";
import { inheritedQuestion, type OpenQuestion, openQuestionAfter } from "../../../handover/openQuestion.js";
import { rowEventIssues } from "../../../handover/rowEventSchema.js";
import { openQuestion as boardLegOpenQuestion } from "../../../sessionStart/boardLeg.js";

const QUESTION = "Will you rotate the Nx Cloud token, or ask platform?";

const STARTED: RunEvent = { atIso: "2026-10-02T00:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" };

const ASKED: RunEvent = { atIso: "2026-10-02T00:46:00.000Z", kind: "question", question: QUESTION };

const WITHDRAWN: RunEvent = {
  atIso: "2026-10-02T02:54:00.000Z",
  kind: "question-withdrawn",
  question: QUESTION,
  why: "the last three branch-pr.yml runs are green with no Nx Cloud 401",
};

const ORPHANED: RunEvent = {
  atIso: "2026-10-02T01:10:00.000Z",
  cycleEvents: 2,
  deadSessionId: "s1",
  kind: "orphaned",
  lastEventIso: "2026-10-02T00:46:00.000Z",
};

const RESTARTED: RunEvent = { ...STARTED, atIso: "2026-10-02T01:20:00.000Z" };

/** The open question after a run of events, from nothing. */
function after({ events }: { events: readonly RunEvent[] }): OpenQuestion | undefined {
  return events.reduce<OpenQuestion | undefined>((open, event) => openQuestionAfter({ event, open }), undefined);
}

describe("openQuestionAfter over a withdrawal", () => {
  it("settles the question it names", () => {
    expect(after({ events: [ASKED, WITHDRAWN] })).toBe(undefined);
  });

  it("settles nothing when it names a question that is not the one open", () => {
    const stray: RunEvent = { ...WITHDRAWN, question: "a question since answered" };

    expect(after({ events: [ASKED, stray] })!.question).toBe(QUESTION);
  });

  it("settles a corrected question by its corrected text", () => {
    const corrected: RunEvent = {
      atIso: "2026-10-02T01:00:00.000Z",
      kind: "question-corrected",
      question: "Rotate the token?",
      why: "shorter",
    };
    const withdrawn: RunEvent = { ...WITHDRAWN, question: "Rotate the token?" };

    expect(after({ events: [ASKED, corrected, withdrawn] })).toBe(undefined);
  });

  it("leaves a new question asked after it waiting", () => {
    const next: RunEvent = { atIso: "2026-10-02T03:00:00.000Z", kind: "question", question: "Something else?" };

    expect(after({ events: [ASKED, WITHDRAWN, next] })!.question).toBe("Something else?");
  });
});

describe("the run state after a withdrawal", () => {
  it("is open, with no question and no answer on the journal", () => {
    const events: readonly RunEvent[] = [STARTED, ASKED, WITHDRAWN];
    const state = runStateOf({ events });

    expect([state.phase, state.openQuestion]).toEqual(["open", undefined]);
    expect(events.filter((event) => event.kind === "answered")).toEqual([]);
  });

  it("stays waiting when the withdrawal names another question", () => {
    const stray: RunEvent = { ...WITHDRAWN, question: "a question since answered" };

    expect(runStateOf({ events: [STARTED, ASKED, stray] }).phase).toBe("waiting-on-owner");
  });

  it("reads as active on the board, so the Queue card is gone", () => {
    expect(runDisposition({ events: [STARTED, ASKED, WITHDRAWN], unreadableLines: [] })).toEqual({ kind: "active" });
  });

  it("drops out of the session-start board leg", () => {
    expect(boardLegOpenQuestion({ events: [STARTED, ASKED, WITHDRAWN] })).toBe(undefined);
  });
});

describe("a withdrawal across a dead session", () => {
  it("settles an inherited question in the new cycle", () => {
    const events = [STARTED, ASKED, ORPHANED, RESTARTED, { ...WITHDRAWN, atIso: "2026-10-02T02:00:00.000Z" }];

    expect(runStateOf({ events }).phase).toBe("open");
    expect(runDisposition({ events, unreadableLines: [] })).toEqual({ kind: "active" });
  });

  it("is never carried forward once the cycle that withdrew it is reaped", () => {
    const withdrawn: RunEvent = { ...WITHDRAWN, atIso: "2026-10-02T00:50:00.000Z" };
    const reaped: RunEvent = { ...ORPHANED, cycleEvents: 3, lastEventIso: "2026-10-02T00:50:00.000Z" };

    expect(inheritedQuestion({ events: [STARTED, ASKED, withdrawn, reaped, RESTARTED] })).toBe(undefined);
  });
});

describe("the question-withdrawn journal line", () => {
  it("round-trips through the ledger line and its decoder", () => {
    expect(decodeLedgerLine({ line: ledgerLine({ event: WITHDRAWN }) })).toEqual(WITHDRAWN);
  });

  it("is refused by the write schema without its why", () => {
    const bare = { atIso: WITHDRAWN.atIso, kind: "question-withdrawn", question: QUESTION };

    expect(rowEventIssues({ event: bare }).join("\n")).toContain("why");
    expect(rowEventIssues({ event: WITHDRAWN })).toEqual([]);
  });
});

describe("runHandoverWithdraw before it writes", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const dir of homes.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A throwaway home whose one row has a started run and no question. */
  function openRunHome(): string {
    const home = mkdtempSync(join(tmpdir(), "withdraw-unit-"));
    homes.push(home);
    mkdirSync(join(home, "handovers"));
    mkdirSync(join(home, "runs"));
    writeFileSync(
      join(home, "handovers", "a-row.md"),
      ["---", "slug: a-row", "summary: a row", "status: ready", "---", "", "# A row", ""].join("\n"),
    );
    writeFileSync(join(home, "runs", "a-row.jsonl"), ledgerLine({ event: STARTED }));
    return home;
  }

  it("refuses a missing --why as a usage error, and journals nothing", async () => {
    const home = openRunHome();
    const argv = ["node", "cli", "handover", "withdraw", "a-row", "--home", home];

    expect(await runHandoverWithdraw(argv)).toBe(EXIT_USAGE);
    expect(readFileSync(join(home, "runs", "a-row.jsonl"), "utf8")).toBe(ledgerLine({ event: STARTED }));
  });

  it("refuses a multi-line --why, which is not the one check it names", async () => {
    const home = openRunHome();
    const argv = ["node", "cli", "handover", "withdraw", "a-row", "--home", home, "--why", "a\nb"];

    expect(await runHandoverWithdraw(argv)).toBe(EXIT_USAGE);
  });
});

describe("phaseRefusal for withdraw", () => {
  it("refuses a run that is not waiting on the owner", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "open", verb: "withdraw" })).toContain(
      "no open question to withdraw",
    );
  });

  it("admits a run that is", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "waiting-on-owner", verb: "withdraw" })).toBe(undefined);
  });
});
