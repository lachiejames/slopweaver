import { describe, expect, it } from "vitest";

import { NOTHING_STALE_SECTION_MAX_BYTES, projectNothingStale } from "../../../briefing/nothingStale.js";
import {
  NothingStaleSectionErrors,
  type NothingStaleSectionOverBudgetError,
} from "../../../briefing/nothingStaleErrors.js";
import { currentOnly, judgeDocumentFreshness } from "../../../briefing/nothingStaleFreshness.js";
import { sectionTextBytes } from "../../../briefing/nothingStaleRender.js";
import type {
  CycleBriefingDocument,
  DocumentInput,
  LandingBriefingDocument,
  LandingRowView,
  NothingStaleInputs,
  RunReceipt,
  SweepBriefingCandidate,
} from "../../../briefing/nothingStaleTypes.js";
import { CYCLE_STANDING_BOUNDS } from "../../../cycle/types.js";
import type { RunPhase } from "../../../handover/ledger.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type SlackOwedDocument, slackOwedDocument } from "../../../live/slack/owedDocument.js";
import type { BriefingContent, BriefingSection } from "../../../outbound/briefing/types.js";
import type { DispatchVerdict } from "../../../review/landingDispatch.js";
import type { SlackThread } from "../../../sessionStart/slackLeg.js";
import { type SweepBoardCensus, sweepBoardCensus } from "../../../sweep/census.js";

const NOW = "2026-09-26T08:00:00.000Z";
/** Every fifteen minutes: whole-quarter-hour firings in every real timezone, so no case depends on the machine's. */
const CADENCE = "*/15 * * * *";

const available = <T>({
  document,
  observedAtIso = NOW,
}: {
  document: T;
  observedAtIso?: string;
}): DocumentInput<T> => ({
  kind: "available",
  value: { cadence: CADENCE, document, observedAtIso },
});

const unseen = <T>({ reason }: { reason: string }): DocumentInput<T> => ({ kind: "could-not-see", reason });

const row = (over: Partial<LandingRowView> = {}): LandingRowView => ({
  action: "spawn-ci",
  blockedOn: [],
  boardRowSlug: undefined,
  dispatch: { kind: "act", verdict: "merge-now", why: "green and approved" },
  headOid: "abcdef1234567890",
  latestAskRecipients: [],
  number: 1,
  queueKind: "not-queued",
  repoSlug: "org/repo",
  title: "A change",
  url: "https://github.com/org/repo/pull/1",
  ...over,
});

/** A landing read whose open list, unless given, carries every row and press it holds — all still open. */
const landing = (over: Partial<LandingBriefingDocument> = {}): LandingBriefingDocument => {
  const { rows = [], presses = [] } = over;
  const open = [...rows, ...presses].map((entry) => ({ author: "me", isDraft: false, number: entry.number }));
  return {
    census: [{ kind: "read", pullRequests: open, repo: "org/repo", viewer: "me" }],
    people: {},
    presses,
    residue: [],
    rows,
    selection: { author: "@me", includeDrafts: true, repos: ["org/repo"] },
    ...over,
  };
};

const cycle = (over: Partial<CycleBriefingDocument> = {}): CycleBriefingDocument => ({
  couldNotSee: [...CYCLE_STANDING_BOUNDS],
  proposals: [],
  ...over,
});

const thread = (over: Partial<SlackThread> = {}): SlackThread => ({
  channelId: "C0SYNCHANNEL1",
  channelName: "#a-channel",
  lastAuthorIsHuman: true,
  lastAuthorIsSelf: false,
  lastAuthorName: "Alex",
  lastIso: "2026-09-25T03:04:05.000Z",
  lastNamesAnybody: false,
  lastText: "can you look?",
  mentionsOwner: false,
  ownerLastIso: "2026-09-24T22:10:00.000Z",
  ownerLatestTagsLastAuthor: false,
  ownerStartedThread: false,
  permalink: "https://example.slack.com/archives/C0SYNCHANNEL1/p1790305445000100",
  threadTs: "1790300000.000100",
  ...over,
});

const owed = ({
  status = "complete",
  threads = [],
}: { status?: "complete" | "incomplete" | "unavailable"; threads?: readonly SlackThread[] } = {}): SlackOwedDocument =>
  slackOwedDocument({
    nowIso: NOW,
    read: {
      couldNotSee: ["the corpus's own copy"],
      movedWithoutOwner: threads.length,
      movementThreads: [...threads],
      status,
      taggedWithoutOwner: 0,
      threadsSpokenIn: threads.length,
      windowDays: 14,
    },
  });

const census = ({ unwitnessed }: { unwitnessed: number }): SweepBoardCensus => {
  const built = sweepBoardCensus({ candidates: [], findingLines: [], scanned: 1 });
  return { ...built, census: { ...built.census, UNWITNESSED: unwitnessed }, swept: unwitnessed };
};

/** Every input available and empty — a clean morning — unless a case overrides one. */
const inputs = (over: Partial<NothingStaleInputs> = {}): NothingStaleInputs => ({
  board: available<readonly SweepBriefingCandidate[]>({ document: [] }),
  boardCensus: available({ document: census({ unwitnessed: 0 }) }),
  followedThreads: available({ document: owed() }),
  linearCycle: available({ document: cycle() }),
  pullRequests: available({ document: landing() }),
  runs: new Map(),
  ...over,
});

/** One run journal's receipt, by the phase it folds to. */
const phase = ({ of }: { of: RunPhase }): RunReceipt => ({ kind: "phase", phase: of });

const textOf = ({ content }: { content: BriefingContent }): string => content.map((run) => run.text).join("");

const project = ({ over = {} }: { over?: Partial<NothingStaleInputs> } = {}): BriefingSection =>
  unwrap(projectNothingStale({ inputs: inputs(over), nowIso: NOW }));

/** One note's headline and the text of every block of its fold, nested folds as `summary: [lines]`. */
const noteOf = ({ section, index }: { section: BriefingSection; index: number }) => {
  const note = section.notes[index]!;
  return {
    blocks: note.detail!.blocks.map((block) => {
      if (block.kind === "list") {
        return block.items.map((content) => textOf({ content }));
      }
      if (block.kind === "para") {
        return textOf({ content: block.content });
      }
      if (block.kind === "fold") {
        const inner = block.fold.blocks[0]!;
        return { [block.fold.summary]: inner.kind === "list" ? inner.items.map((content) => textOf({ content })) : [] };
      }
      return block.kind;
    }),
    headline: textOf({ content: note.headline }),
  };
};

/** The bounds a complete owed read states on every morning, as the caveat fold lists them. */
const OWED_BOUNDS = owed().coverage.residue.map((bound) => `followed threads: ${bound}`);

const CLEAN_STALE_BLOCKS = [
  "Nothing here at this read.",
  "Board: 0 rows unproven, count only.",
  {
    "What each read says it can never see, on any morning": [
      ...CYCLE_STANDING_BOUNDS.map((bound) => `Linear: ${bound}`),
      ...OWED_BOUNDS,
    ],
  },
];

/** The moving note's first block, pointing at the autonomy ledger rather than re-counting it. */
const DONE_POINTER =
  "What the fleet finished without asking is the autonomy ledger's, under done for you, without asking. " +
  "This lists only what is in flight, each with the receipt that proves it.";

/** The section's note indexes, in the order they stand. */
const STALE = 0;
const MOVING = 1;
const WAITING = 2;
const NEEDS_WORD = 3;

describe("projectNothingStale — the section's frame", () => {
  it("carries a board count of unproven rows on the headline, never only inside a fold", () => {
    const section = project({ over: { boardCensus: available({ document: census({ unwitnessed: 12 }) }) } });
    expect(section.summary).toBe("Nothing stale · all five surfaces seen · 12 unproven");
  });

  it("counts the unseen surfaces rather than naming them when the named line would pass the summary cap", () => {
    const section = project({
      over: {
        board: unseen({ reason: "not there" }),
        boardCensus: available({ document: census({ unwitnessed: Number.MAX_SAFE_INTEGER }) }),
        followedThreads: unseen({ reason: "not there" }),
        linearCycle: unseen({ reason: "not there" }),
        pullRequests: unseen({ reason: "not there" }),
      },
    });
    expect(section.summary).toBe("0 known stale; not an all-clear — 5 surfaces unseen · 9007199254740991 unproven");
  });

  it("reads a clean morning as Nothing stale with every surface seen, in exactly four notes", () => {
    const section = project();
    expect(section.id).toBe("nothing-stale");
    expect(section.summary).toBe("Nothing stale · all five surfaces seen");
    expect(section.notes.map((note) => textOf({ content: note.headline }))).toStrictEqual([
      "Nobody has it — 0",
      "Done for you — 0 moving",
      "Waiting on a named person — 0",
      "Needs your word — 0",
    ]);
    expect(section.notes.map((note) => note.lane)).toStrictEqual(["quoted", "quoted", "quoted", "quoted"]);
    expect(noteOf({ index: STALE, section }).blocks).toStrictEqual(CLEAN_STALE_BLOCKS);
    expect(noteOf({ index: MOVING, section }).blocks).toStrictEqual([DONE_POINTER, "Nothing here at this read."]);
  });

  it("never reads zero stale over a missing document as an all-clear, naming every surface it could not see", () => {
    const missing = unseen<never>({ reason: "not there" });
    const section = project({
      over: {
        board: missing,
        boardCensus: missing,
        followedThreads: missing,
        linearCycle: missing,
        pullRequests: missing,
      },
    });
    expect(section.summary).toBe(
      "0 known stale; not an all-clear — could not see pull requests, tickets, projects, threads, board, unproven count",
    );
    expect(section.summary.length).toBeLessThanOrEqual(120);
    expect(noteOf({ index: STALE, section }).blocks).toStrictEqual([
      "Nothing here at this read.",
      {
        "Could not see pull requests, tickets, projects, threads, board, unproven count — why, for each": [
          "pull requests: not there",
          "tickets: not there",
          "projects: not there",
          "threads: not there",
          "board: not there",
          "unproven count: not there",
        ],
      },
    ]);
  });
});

describe("projectNothingStale — pull requests", () => {
  it("says moving for a press, once, and never repeats the pressed row", () => {
    const pressed = row({ number: 7, title: "Pressed one", url: "https://github.com/org/repo/pull/7" });
    const document = landing({
      presses: [
        {
          detail: "enqueued",
          number: 7,
          outcome: "pressed",
          repoSlug: "org/repo",
          url: "https://github.com/org/repo/pull/7",
        },
        {
          detail: "dry run",
          number: 8,
          outcome: "would-press",
          repoSlug: "org/repo",
          url: "https://github.com/org/repo/pull/8",
        },
      ],
      rows: [pressed],
    });
    const section = project({ over: { pullRequests: available({ document }) } });
    expect(noteOf({ index: MOVING, section })).toStrictEqual({
      blocks: [
        DONE_POINTER,
        [
          "org/repo#7 Pressed one — pressed into the merge queue in the landing read published 2026-09-26T08:00:00.000Z. enqueued",
        ],
      ],
      headline: "Done for you — 1 moving",
    });
  });

  it("says moving only on a receipt: the merge queue, the stack's bottom, or an open run on either journal", () => {
    const document = landing({
      rows: [
        row({ dispatch: { kind: "waiting", why: "in the queue" }, number: 2, queueKind: "queued" }),
        row({ action: "stacked", dispatch: { kind: "waiting", why: "its base is a branch" }, number: 3 }),
        row({ dispatch: { kind: "act", verdict: "rebase-and-fix", why: "behind main" }, number: 4 }),
        row({
          action: "draft",
          boardRowSlug: "a-seat-finishing-it",
          dispatch: { kind: "waiting", why: "that seat finishes it" },
          number: 5,
        }),
      ],
    });
    const runs = new Map([
      ["land-org-repo-4-abcdef1", phase({ of: "open" })],
      ["a-seat-finishing-it", phase({ of: "open" })],
    ]);
    const section = project({ over: { pullRequests: available({ document }), runs } });
    expect(section.summary).toBe("Nothing stale · all five surfaces seen");
    expect(noteOf({ index: MOVING, section })).toStrictEqual({
      blocks: [
        DONE_POINTER,
        [
          "org/repo#2 A change — GitHub's merge queue held it in the landing read published 2026-09-26T08:00:00.000Z. in the queue",
          "org/repo#3 A change — the bottom of its stack carried the act in the landing read published 2026-09-26T08:00:00.000Z. its base is a branch",
          "org/repo#4 A change — run `land-org-repo-4-abcdef1` is open. behind main",
          "org/repo#5 A change — run `a-seat-finishing-it` is open. that seat finishes it",
        ],
      ],
      headline: "Done for you — 4 moving",
    });
  });

  it("counts a named act stale when its run never started or already closed", () => {
    const document = landing({
      rows: [
        row({ dispatch: { kind: "act", verdict: "rebase-and-fix", why: "behind main" }, number: 6 }),
        row({ dispatch: { kind: "act", verdict: "rebase-and-fix", why: "behind main" }, number: 7 }),
      ],
    });
    const runs = new Map([["land-org-repo-7-abcdef1", phase({ of: "closed" })]]);
    const section = project({ over: { pullRequests: available({ document }), runs } });
    expect(section.summary).toBe("2 known stale · all five surfaces seen");
    expect(noteOf({ index: STALE, section }).blocks[0]).toStrictEqual([
      "org/repo#6 A change — rebase-and-fix named, and no open run holds it (`land-org-repo-6-abcdef1`): behind main",
      "org/repo#7 A change — rebase-and-fix named, and no open run holds it (`land-org-repo-7-abcdef1`): behind main",
    ]);
  });

  it("asks the owner through the Queue when a row's run holds a question for them", () => {
    const document = landing({
      rows: [row({ dispatch: { kind: "act", verdict: "merge-now", why: "green" }, number: 8 })],
    });
    const runs = new Map([["land-org-repo-8-abcdef1", phase({ of: "waiting-on-owner" })]]);
    const section = project({ over: { pullRequests: available({ document }), runs } });
    expect(noteOf({ index: NEEDS_WORD, section }).blocks[0]).toStrictEqual([
      "org/repo#8 A change — run `land-org-repo-8-abcdef1` holds a question for you on the Queue. green",
    ]);
  });

  it("names a row whose run journal could not be read as unseen, never as moving or stale", () => {
    const document = landing({ rows: [row({ number: 9 })] });
    const runs = new Map<string, RunReceipt>([
      ["land-org-repo-9-abcdef1", { kind: "unreadable", reason: "line(s) 3 could not be decoded" }],
    ]);
    const section = project({ over: { pullRequests: available({ document }), runs } });
    expect(section.summary).toBe("0 known stale; not an all-clear — could not see pull requests");
    expect(noteOf({ index: STALE, section }).blocks[2]).toStrictEqual({
      "Could not see pull requests — why, for each": [
        "pull requests: org/repo#9: its run journal `land-org-repo-9-abcdef1` could not be read: line(s) 3 could not be decoded",
      ],
    });
  });

  it("counts every verdict the fleet owns stale without a receipt — each one, so a new verdict cannot slip in unclassified", () => {
    const fleetOwned = {
      "coderabbit-loop": true,
      "draft-first-review-ask": true,
      "finish-or-card-close": true,
      "merge-now": true,
      "rebase-and-fix": true,
      "resolve-then-bump": true,
      "resolve-then-merge": true,
    } satisfies Record<Exclude<DispatchVerdict, "needs-owner-judgment">, true>;
    const verdicts = Object.keys(fleetOwned);
    const document = landing({
      rows: verdicts.map((verdict, index) => row({ dispatch: { kind: "act", verdict, why: "w" }, number: index + 1 })),
    });
    const section = project({ over: { pullRequests: available({ document }) } });
    expect(verdicts.length).toBe(7);
    expect(noteOf({ index: STALE, section }).blocks[0]).toStrictEqual(
      verdicts.map(
        (verdict, index) =>
          `org/repo#${String(index + 1)} A change — ${verdict} named, and no open run holds it ` +
          `(\`land-org-repo-${String(index + 1)}-abcdef1\`): w`,
      ),
    );
  });

  it("asks the owner `decide` for the one verdict reserved for their judgement, without counting it stale", () => {
    const document = landing({
      rows: [row({ dispatch: { kind: "act", verdict: "needs-owner-judgment", why: "owners disagree" }, number: 4 })],
    });
    const section = project({ over: { pullRequests: available({ document }) } });
    expect(section.summary).toBe("Nothing stale · all five surfaces seen");
    expect(noteOf({ index: NEEDS_WORD, section }).blocks[0]).toStrictEqual([
      "org/repo#4 A change — reply `decide`: owners disagree",
    ]);
  });

  it("puts a wait on a named person in the waiting note: a code owner, then an asked person the roster names", () => {
    const document = landing({
      people: { U0SYNADA0001: "Ada" },
      rows: [
        row({
          blockedOn: ["@org/team", "@bea"],
          dispatch: { kind: "waiting", why: "review asked" },
          latestAskRecipients: ["U0SYNADA0001", "U0SYNNOBODY1"],
          number: 5,
        }),
      ],
    });
    const section = project({ over: { pullRequests: available({ document }) } });
    expect(noteOf({ index: WAITING, section })).toStrictEqual({
      blocks: [["org/repo#5 A change — waiting on @bea, Ada: review asked"]],
      headline: "Waiting on a named person — 1",
    });
  });

  it("counts a wait on nobody named, and a row outside the set with nobody named, as known stale", () => {
    const document = landing({
      rows: [
        row({ blockedOn: ["@org/team"], dispatch: { kind: "waiting", why: "team owes a review" }, number: 6 }),
        row({ dispatch: { kind: "outside-the-set", why: "no merge queue" }, number: 9 }),
      ],
    });
    const section = project({ over: { pullRequests: available({ document }) } });
    expect(section.summary).toBe("2 known stale · all five surfaces seen");
    expect(noteOf({ index: STALE, section }).blocks[0]).toStrictEqual([
      "org/repo#6 A change — waiting, on nobody named: team owes a review",
      "org/repo#9 A change — outside-the-set, on nobody named: no merge queue",
    ]);
    expect(textOf({ content: section.notes[STALE]!.headline })).toBe("Nobody has it — 2");
  });

  it("names an unread row as unseen pull requests, classifies it nowhere, and keeps the read's bounds as caveats", () => {
    const document = landing({
      residue: ["reviews may be missing"],
      rows: [row({ dispatch: { kind: "unread", why: "checks unreadable" }, number: 10 })],
    });
    const section = project({ over: { pullRequests: available({ document }) } });
    expect(section.summary).toBe("0 known stale; not an all-clear — could not see pull requests");
    expect(noteOf({ index: STALE, section }).blocks).toStrictEqual([
      "Nothing here at this read.",
      "Board: 0 rows unproven, count only.",
      {
        "Could not see pull requests — why, for each": [
          "pull requests: org/repo#10 could not be decided: checks unreadable",
        ],
      },
      {
        "What each read says it can never see, on any morning": [
          "pull requests: reviews may be missing",
          ...CYCLE_STANDING_BOUNDS.map((bound) => `Linear: ${bound}`),
          ...OWED_BOUNDS,
        ],
      },
    ]);
  });
});

describe("projectNothingStale — Linear, threads and the board", () => {
  it("splits ticket and project proposals into their own surfaces, keeping each one's exact replies and draft", () => {
    const document = cycle({
      proposals: [
        {
          action: "close-with-comment",
          evidence: [{ fact: "state is Merged" }, { fact: "PR merged" }],
          headline: "ABC-1 already shipped.",
          oneWordReplies: ["close", "keep", "later"],
          subject: "ABC-1",
          title: "Do it",
          url: "https://linear.app/x/issue/ABC-1",
        },
        {
          action: "project-update",
          draft: "On track.",
          evidence: [{ fact: "no update in 9 days" }],
          headline: "Project X is overdue an update.",
          oneWordReplies: ["post", "skip"],
          subject: "project-x",
          url: "https://linear.app/x/project/project-x",
        },
      ],
    });
    const section = project({ over: { linearCycle: available({ document }) } });
    expect(noteOf({ index: NEEDS_WORD, section }).blocks[0]).toStrictEqual([
      "ABC-1 Do it — close-with-comment; reply `close` / `keep` / `later`: ABC-1 already shipped. Evidence: state is Merged; PR merged.",
      "project-x — project-update; reply `post` / `skip`: Project X is overdue an update. Evidence: no update in 9 days. Draft: On track.",
    ]);
  });

  it("names both Linear surfaces as unseen for a cycle line that is not one of its standing bounds", () => {
    const document = cycle({ couldNotSee: [...CYCLE_STANDING_BOUNDS, "Linear refused the project read"] });
    const section = project({ over: { linearCycle: available({ document }) } });
    expect(section.summary).toBe("0 known stale; not an all-clear — could not see tickets, projects");
  });

  it("asks `reply` for an owed thread that asks the owner a question, lists none that asks nothing, and keeps the bounds", () => {
    const asking = thread({ lastText: "@ada can you look?", mentionsOwner: true, threadTs: "1790300000.000200" });
    const section = project({
      over: { followedThreads: available({ document: owed({ threads: [thread(), asking] }) }) },
    });
    expect(section.summary).toBe("Nothing stale · all five surfaces seen");
    expect(noteOf({ index: NEEDS_WORD, section }).blocks[0]).toStrictEqual([
      "Alex in #a-channel — reply `reply`: addressed; their last word 2026-09-25T03:04:05.000Z, yours " +
        '2026-09-24T22:10:00.000Z: "@ada can you look?"',
    ]);
  });

  it("keeps the threads an incomplete read did see, and names threads as unseen beside them", () => {
    const document = owed({ status: "incomplete", threads: [thread({ mentionsOwner: true })] });
    const section = project({ over: { followedThreads: available({ document }) } });
    expect(section.summary).toBe("0 known stale; not an all-clear — could not see threads");
    expect(textOf({ content: section.notes[NEEDS_WORD]!.headline })).toBe("Needs your word — 1");
  });

  it("claims no thread at all from an unavailable read", () => {
    const document = owed({ status: "unavailable", threads: [thread({ mentionsOwner: true })] });
    const section = project({ over: { followedThreads: available({ document }) } });
    expect(section.summary).toBe("0 known stale; not an all-clear — could not see threads");
    expect(textOf({ content: section.notes[NEEDS_WORD]!.headline })).toBe("Needs your word — 0");
  });

  it("asks the owner only about an ORPHANED board row, and counts every other finding stale as the fleet's", () => {
    const document: readonly SweepBriefingCandidate[] = [
      { act: "close", slug: "a-dead-leaf", verdict: "ORPHANED", witness: "nobody holds its run" },
      { act: "settle", slug: "an-answered-ask", verdict: "SHIPPED", witness: "the ask was answered" },
      { act: "none", slug: "a-contradiction", verdict: "CONTRADICTED", witness: "its probe says done" },
    ];
    const section = project({
      over: { board: available({ document }), boardCensus: available({ document: census({ unwitnessed: 657 }) }) },
    });
    expect(section.summary).toBe("2 known stale · all five surfaces seen · 657 unproven");
    expect(noteOf({ index: NEEDS_WORD, section }).blocks[0]).toStrictEqual([
      "a-dead-leaf — ORPHANED; reply `close` / `keep`: nobody holds its run",
    ]);
    expect(noteOf({ index: STALE, section }).blocks.slice(0, 2)).toStrictEqual([
      [
        "an-answered-ask — SHIPPED, act `settle` not applied: the ask was answered",
        "a-contradiction — CONTRADICTED, act `none` not applied: its probe says done",
      ],
      "Board: 657 rows unproven, count only.",
    ]);
  });

  it("asks the owner why as well when an ORPHANED row's act is a decline, which sweep apply takes only with their reason", () => {
    const document: readonly SweepBriefingCandidate[] = [
      { act: "settle", slug: "can-never-run", verdict: "ORPHANED", witness: "blockedBy reaches a-dead-leaf" },
    ];
    const section = project({
      over: { board: available({ document }), boardCensus: available({ document: census({ unwitnessed: 0 }) }) },
    });
    expect(noteOf({ index: NEEDS_WORD, section }).blocks[0]).toStrictEqual([
      "can-never-run — ORPHANED; reply `settle` / `keep` (if settle, say why): blockedBy reaches a-dead-leaf",
    ]);
  });
});

describe("the freshness rule", () => {
  it("holds a document current until the next firing and stale from that firing, to the millisecond", () => {
    const at = ({ nowIso }: { nowIso: string }) =>
      judgeDocumentFreshness({ cadence: CADENCE, label: "doc", nowIso, observedAtIso: "2026-09-26T08:05:00.000Z" });
    expect(at({ nowIso: "2026-09-26T08:14:59.999Z" })).toStrictEqual({ fresh: true });
    expect(at({ nowIso: "2026-09-26T08:15:00.000Z" })).toStrictEqual({
      fresh: false,
      reason:
        "doc last landed 2026-09-26T08:05:00.000Z, and 1 firing(s) of `*/15 * * * *` have passed since " +
        "(the latest 2026-09-26T08:15:00.000Z) without replacing it",
    });
  });

  it("never reads an unschedulable cadence or an unreadable instant as fresh", () => {
    expect(
      judgeDocumentFreshness({ cadence: CADENCE, label: "doc", nowIso: NOW, observedAtIso: "yesterday" }),
    ).toStrictEqual({
      fresh: false,
      reason: "doc carries no readable instant (yesterday)",
    });
    const bad = judgeDocumentFreshness({ cadence: "not cron", label: "doc", nowIso: NOW, observedAtIso: NOW });
    expect(bad.fresh).toBe(false);
  });

  it("turns a stale document into the gap naming why, and passes a current one through untouched", () => {
    const current = available({ document: 1 });
    expect(currentOnly({ input: current, label: "doc", nowIso: NOW })).toBe(current);
    const old = available({ document: 1, observedAtIso: "2026-09-26T07:00:00.000Z" });
    expect(currentOnly({ input: old, label: "doc", nowIso: NOW })).toStrictEqual({
      kind: "could-not-see",
      reason:
        "doc last landed 2026-09-26T07:00:00.000Z, and 4 firing(s) of `*/15 * * * *` have passed since " +
        "(the latest 2026-09-26T08:00:00.000Z) without replacing it",
    });
  });

  it("names a surface whose document went stale as unseen, never as its old answer", () => {
    const document = landing({ rows: [row({ dispatch: { kind: "outside-the-set", why: "x" } })] });
    const section = project({
      over: { pullRequests: available({ document, observedAtIso: "2026-09-26T07:00:00.000Z" }) },
    });
    expect(section.summary).toBe("0 known stale; not an all-clear — could not see pull requests");
  });
});

describe("projectNothingStale — refusals", () => {
  it("withholds every list whole over its byte budget, keeping the counts, and never trims one", () => {
    const document = landing({
      rows: [row({ number: 1 }), row({ number: 2 }), row({ number: 3 })],
    });
    const over = { pullRequests: available({ document }) };
    const whole = project({ over });
    const bytes = sectionTextBytes({ section: whole });
    const cap = bytes - 1;
    const withheld = unwrap(projectNothingStale({ cap, inputs: inputs(over), nowIso: NOW }));
    expect({
      headlines: withheld.notes.map((note) => note.headline.map((run) => run.text).join("")),
      stale: noteOf({ index: STALE, section: withheld }).blocks[0],
      summary: withheld.summary,
    }).toStrictEqual({
      headlines: [
        "Nobody has it — 3",
        "Done for you — 0 moving",
        "Waiting on a named person — 0",
        "Needs your word — 0",
      ],
      stale:
        `3 row(s), withheld whole: every list in this section came to ${String(bytes)} bytes against its ` +
        `${String(cap)}-byte cap, and none is ever cut to fit.`,
      summary: whole.summary,
    });
    expect(unwrap(projectNothingStale({ cap: bytes, inputs: inputs(over), nowIso: NOW }))).toStrictEqual(whole);
  });

  it("refuses only a section over its budget even as counts, naming the items that never fitted", () => {
    const document = landing({ rows: [row({ number: 1 })] });
    const refusal = unwrapErr(
      projectNothingStale({ cap: 10, inputs: inputs({ pullRequests: available({ document }) }), nowIso: NOW }),
    );
    const { bytes } = refusal as NothingStaleSectionOverBudgetError;
    expect(bytes).toBeGreaterThan(10);
    expect(refusal).toStrictEqual(
      NothingStaleSectionErrors.sectionOverBudget({
        bytes,
        cap: 10,
        overflowIdentities: ["pull-request:org/repo#1"],
      }),
    );
  });

  it("renders a pull request whose stored address will not parse, rather than refusing the morning", () => {
    const document = landing({ rows: [row({ url: "not a url" })] });
    const section = unwrap(
      projectNothingStale({ inputs: inputs({ pullRequests: available({ document }) }), nowIso: NOW }),
    );
    expect(section.summary).toBe("1 known stale · all five surfaces seen");
  });

  it("carries a measured budget, not a placeholder", () => {
    expect(NOTHING_STALE_SECTION_MAX_BYTES).toBe(65_536);
  });
});
