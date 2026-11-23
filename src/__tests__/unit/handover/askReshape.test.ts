import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runAskReshape, unshapedHeldQuestion } from "../../../cli/commands/handover/askReshape.js";
import { runHandoverAsk } from "../../../cli/commands/handover/lifecycleRun.js";
import { resolve } from "../../../cli/commands/handover/lifecycleRunCore.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import type { AskStakes } from "../../../handover/askShape.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { heldQuestion } from "../../../handover/heldQuestion.js";
import { ledgerLine, type RunEvent, runStateOf } from "../../../handover/ledger.js";
import { decodeLedgerLine } from "../../../handover/ledgerLineDecode.js";
import { inheritedQuestion } from "../../../handover/openQuestion.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { rowEventIssues } from "../../../handover/rowEventSchema.js";
import { appendRunEvent, readRunJournal } from "../../../handover/runStore.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../supervisor/session.js";

const SLUG = "reshape-me";
const OLD = "the base branch is ambiguous, and the run is paused until someone says which";
const NEW = "Which base branch should this run use?";
const ASKED_ISO = "2026-09-20T10:00:02.000Z";

const STAKES: AskStakes = {
  blastRadius: "this one doc and whichever run picks it up",
  risk: "a run starts on the wrong base and its diff is unreviewable",
  stillReal: "re-read the doc at 21:40Z: it still cites both branches",
};

const STARTED: RunEvent = { atIso: "2026-09-20T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" };
const ASKED: RunEvent = { atIso: ASKED_ISO, kind: "question", question: OLD };

const SHAPED: RunEvent = {
  atIso: "2026-09-29T09:00:00.000Z",
  kind: "question-shaped",
  lean: "main — the one citation reads like a typo",
  options: [
    { letter: "A", option: "main", tradeoff: "every other run is on it" },
    { letter: "B", option: "the release branch", tradeoff: "this doc cites it once" },
  ],
  problem: "the base branch is not derivable from the doc",
  question: NEW,
  replaces: OLD,
  stakes: STAKES,
};

/** The same question, recorded WITH a shape — the one a reshape must never replace. */
const ASKED_SHAPED: RunEvent = {
  atIso: ASKED_ISO,
  kind: "question",
  lean: "hold",
  options: [
    { letter: "A", option: "go", tradeoff: "fast" },
    { letter: "B", option: "hold", tradeoff: "slow" },
  ],
  problem: "already shaped",
  question: OLD,
};

describe("a reshape over the held question", () => {
  it("replaces an unshaped question's text and shape, keeping the instant it was first asked", () => {
    const held = heldQuestion({ events: [STARTED, ASKED, SHAPED] })!;

    expect([held.question, held.askedIso, held.shapeIso]).toEqual([NEW, ASKED_ISO, "2026-09-29T09:00:00.000Z"]);
    expect(held.shape).toEqual({
      lean: "main — the one citation reads like a typo",
      options: [
        { letter: "A", option: "main", tradeoff: "every other run is on it" },
        { letter: "B", option: "the release branch", tradeoff: "this doc cites it once" },
      ],
      problem: "the base branch is not derivable from the doc",
      stakes: STAKES,
    });
    expect(runStateOf({ events: [STARTED, ASKED, SHAPED] }).openQuestion).toBe(NEW);
  });

  it("leaves a question that already carries a shape exactly as it was, in both folds", () => {
    const held = heldQuestion({ events: [STARTED, ASKED_SHAPED, SHAPED] })!;

    expect([held.question, held.shape!.problem]).toEqual([OLD, "already shaped"]);
    expect(runStateOf({ events: [STARTED, ASKED_SHAPED, SHAPED] }).openQuestion).toBe(OLD);
  });

  it("binds to nothing when it names a question that is not the one waiting", () => {
    const stray: RunEvent = { ...SHAPED, replaces: "a question since answered" };

    expect(heldQuestion({ events: [STARTED, ASKED, stray] })!.question).toBe(OLD);
    expect(runStateOf({ events: [STARTED, ASKED, stray] }).openQuestion).toBe(OLD);
  });

  it("survives a reap: the next cycle inherits the shaped text with its original asked instant", () => {
    const orphaned: RunEvent = {
      atIso: "2026-09-29T10:00:00.000Z",
      deadSessionId: "gone",
      kind: "orphaned",
      lastEventIso: "2026-09-29T09:00:00.000Z",
    };
    const restarted: RunEvent = { ...STARTED, atIso: "2026-09-29T11:00:00.000Z" };
    const events = [STARTED, ASKED, SHAPED, orphaned, restarted];

    expect(inheritedQuestion({ events })!.question).toBe(NEW);
    const disposition = runDisposition({ events, unreadableLines: [] });
    expect(disposition).toMatchObject({
      askedIso: ASKED_ISO,
      kind: "waiting-on-owner",
      question: NEW,
      shapeIso: "2026-09-29T09:00:00.000Z",
    });
  });
});

describe("which waiting question a shaped ask may replace", () => {
  /** The three fields the verb reads, derived from `events` the way the run context derives them. */
  const context = ({ events, unreadable = [] }: { events: readonly RunEvent[]; unreadable?: readonly number[] }) => ({
    events,
    run: runStateOf({ events }),
    unreadable,
  });

  it("names the unshaped question a waiting run holds", () => {
    expect(unshapedHeldQuestion({ context: context({ events: [STARTED, ASKED] }) })).toBe(OLD);
  });

  it("names nothing once that question carries a shape, or on an open run", () => {
    expect([
      unshapedHeldQuestion({ context: context({ events: [STARTED, ASKED_SHAPED] }) }),
      unshapedHeldQuestion({ context: context({ events: [STARTED, ASKED, SHAPED] }) }),
      unshapedHeldQuestion({ context: context({ events: [STARTED] }) }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("fails closed on a journal holding a line this build cannot read", () => {
    expect(unshapedHeldQuestion({ context: context({ events: [STARTED, ASKED], unreadable: [4] }) })).toBe(undefined);
  });
});

describe("the question-shaped line", () => {
  it("round-trips through the journal decoder unchanged", () => {
    expect(decodeLedgerLine({ line: ledgerLine({ event: SHAPED }) })).toEqual(SHAPED);
  });

  it("is unreadable without its stakes, never a reshape drawing two thirds of a card", () => {
    const { stakes: _dropped, ...partial } = SHAPED;

    expect(decodeLedgerLine({ line: JSON.stringify(partial) })).toBe(undefined);
  });

  it("is refused at the write schema without its stakes", () => {
    const { stakes: _dropped, ...partial } = SHAPED;

    expect(rowEventIssues({ event: SHAPED })).toEqual([]);
    expect(rowEventIssues({ event: partial }).length).toBeGreaterThan(0);
  });
});

const homes: string[] = [];
const savedSession = process.env[CLAUDE_CODE_SESSION_ID_ENV];

afterEach(() => {
  if (savedSession === undefined) {
    delete process.env[CLAUDE_CODE_SESSION_ID_ENV];
  } else {
    process.env[CLAUDE_CODE_SESSION_ID_ENV] = savedSession;
  }
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** A real board and journal whose run is waiting on `asked`, or open when `asked` is absent. */
function board({ asked }: { asked: RunEvent | undefined }): { home: string; runsDir: string } {
  process.env[CLAUDE_CODE_SESSION_ID_ENV] = "the-one-session";
  const home = mkdtempSync(join(tmpdir(), "slopweaver-reshape-"));
  homes.push(home);
  const handovers = join(home, "handovers");
  const runsDir = join(home, "runs");
  mkdirSync(handovers, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    join(handovers, `${SLUG}.md`),
    ["---", `slug: ${SLUG}`, "summary: reshape an ask", "status: in-progress", "---", "", "# Reshape me", ""].join(
      "\n",
    ),
  );
  const claimed: RunEvent = {
    atIso: "2026-09-20T10:00:01.000Z",
    host: "claude-code",
    kind: "claimed",
    pid: process.pid,
    sessionId: "the-one-session",
    why: "the test owns it",
    worktree: process.cwd(),
  };
  for (const event of asked === undefined ? [STARTED, claimed] : [STARTED, claimed, asked]) {
    appendRunEvent({ event, runsDir, slug: SLUG });
  }
  return { home, runsDir };
}

/** The one concrete scene every ask here leads with. */
const SCENE = "You open the run's PR and it sits on the release branch. Should it be on main?";

/** Real argv for a fully shaped `handover ask`. */
function askArgv({ home, extra = [] }: { home: string; extra?: readonly string[] }): string[] {
  return [
    "node",
    "cli",
    "handover",
    "ask",
    SLUG,
    "--home",
    home,
    "--problem",
    "the base branch is not derivable from the doc",
    "--options",
    "main :: every other run is on it\nthe release branch :: this doc cites it once",
    "--lean",
    "main — the one citation reads like a typo",
    "--risk",
    STAKES.risk,
    "--blast-radius",
    STAKES.blastRadius,
    "--still-real",
    STAKES.stillReal,
    "--example",
    SCENE,
    "--question",
    NEW,
    ...extra,
  ];
}

/** The journal's event kinds, in order. */
function kinds({ runsDir }: { runsDir: string }): readonly string[] {
  return readRunJournal({ runsDir, slug: SLUG })
    ._unsafeUnwrap()
    .events.map((event) => event.kind);
}

describe("handover ask on a run already waiting", () => {
  it("shapes an unshaped question in place, so the card ages it from when it was first asked", async () => {
    const { home, runsDir } = board({ asked: ASKED });

    expect(await runHandoverAsk(askArgv({ home }))).toBe(EXIT_OK);

    const events = readRunJournal({ runsDir, slug: SLUG })._unsafeUnwrap().events;
    expect(events.map((event) => event.kind)).toEqual(["started", "claimed", "question", "question-shaped"]);
    // The scene rides the reshape's OWN line, so no failed second append can leave the ask without it.
    expect(events.at(-1)).toMatchObject({ examples: [SCENE], kind: "question-shaped" });
    expect(runDisposition({ events, unreadableLines: [] })).toMatchObject({
      askedIso: ASKED_ISO,
      kind: "waiting-on-owner",
      question: NEW,
      shape: { problem: "the base branch is not derivable from the doc", stakes: STAKES },
    });
  });

  it("refuses to replace a question that already carries a shape, and writes nothing", async () => {
    const { home, runsDir } = board({ asked: ASKED_SHAPED });

    expect(await runHandoverAsk(askArgv({ home }))).not.toBe(EXIT_OK);

    expect(kinds({ runsDir })).toEqual(["started", "claimed", "question"]);
  });

  it("refuses a draft on the reshape, which is handover offer's to record, and writes nothing", async () => {
    const { home, runsDir } = board({ asked: ASKED });
    const action = JSON.stringify({
      actor: "me",
      body: "which base?",
      destinations: [{ channel: "C01SDLC", kind: "channel", label: "Post it to #delivery", tradeoff: "loud" }],
      mentions: [],
      version: 1,
    });
    const args = askArgv({ home }).filter(
      (_, index, all) => all[index - 1] !== "--options" && all[index] !== "--options",
    );

    expect(await runHandoverAsk([...args, "--action", action])).toBe(EXIT_USAGE);

    expect(kinds({ runsDir })).toEqual(["started", "claimed", "question"]);
  });

  it("refuses, writing nothing, when the row is settled after the verb resolved it and before the reshape appends", async () => {
    const { home, runsDir } = board({ asked: ASKED });
    const path = join(home, "handovers", `${SLUG}.md`);
    // An ask row, the only kind a settle can land on.
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace("status: in-progress\n", "kind: ask\nstatus: in-progress\n"),
    );
    const resolved = resolve({ argv: askArgv({ home }), verb: "ask" });
    if (typeof resolved === "number") {
      throw new Error(`resolve refused with exit ${resolved}`);
    }
    // A settle landing mid-ask: the doc on disk now carries a settlement the resolved copy does not.
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        "status: in-progress\n",
        "status: in-progress\nsettlement: answered\nsettlementWitness: w\nsettledIso: 2026-09-20T10:00:03.000Z\n",
      ),
    );

    const exit = await runAskReshape({
      examples: { examples: [SCENE], kind: "examples" },
      question: NEW,
      readOwnerWords: [],
      replaces: unshapedHeldQuestion({ context: resolved.context })!,
      resolved,
    });

    expect(exit).toBe(EXIT_ERROR);
    expect(kinds({ runsDir })).toEqual(["started", "claimed", "question"]);
  });
});

describe("handover ask on an open run", () => {
  it("records the stakes it requires on the question, where the card reads them", async () => {
    const { home, runsDir } = board({ asked: undefined });

    expect(await runHandoverAsk(askArgv({ home }))).toBe(EXIT_OK);

    const events = readRunJournal({ runsDir, slug: SLUG })._unsafeUnwrap().events;
    expect(events.at(-1)).toMatchObject({ examples: [SCENE], kind: "question", question: NEW, stakes: STAKES });
  });
});

describe("the row write guard", () => {
  it("refuses a reshape over a question that already carries a shape, whoever wrote it", () => {
    const { runsDir } = board({ asked: ASKED_SHAPED });

    const written = applyRowEvent({ event: SHAPED, runsDir, slug: SLUG });

    expect(written._unsafeUnwrapErr().code).toBe("FORBIDDEN_TRANSITION");
    expect(kinds({ runsDir })).toEqual(["started", "claimed", "question"]);
  });

  it("refuses a reshape over a journal holding a line this build cannot read, which may be the question's draft", () => {
    const { runsDir } = board({ asked: ASKED });
    appendFileSync(
      join(runsDir, `${SLUG}.jsonl`),
      `${JSON.stringify({ atIso: "2026-09-21T00:00:00.000Z", kind: "question-offered-v2", question: OLD })}\n`,
    );

    const written = applyRowEvent({ event: SHAPED, runsDir, slug: SLUG });

    expect(written._unsafeUnwrapErr().code).toBe("JOURNAL_INCOMPLETE");
    expect(heldQuestion({ events: readRunJournal({ runsDir, slug: SLUG })._unsafeUnwrap().events })!.question).toBe(
      OLD,
    );
  });
});
