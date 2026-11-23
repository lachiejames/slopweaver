/*
 * A hand step that is a DECISION, from the three documents the queue reads to the one row it draws.
 *
 * A card must say what the owner is being asked, point somewhere for more context, and propose options that make
 * sense. Each step below opened a shaped ask the queue never listed (parked on nobody), so the card fell back to the
 * note's own buttons and the Open link landed on nothing. The fixtures are two such records
 * (`hand:steer-16676-post` and its sibling), driven through the real readers.
 */

import { describe, expect, it } from "vitest";

import { readBoard, readHandSteps } from "../../components/live/read";
import { readAutonomy } from "../../components/live/readAutonomy";
import { readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { cardAddresses } from "../../lib/cardAddresses";
import { rowForOpen } from "../../lib/queueOpen";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { shownInContext } from "../../lib/workspacePlacementContext";
import { ACME_PLACER, FIXTURE_SELF_REPOSITORY } from "../organisationFixture";
import { stepOf } from "./cardKind";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-25T13:40:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

const PR_16672 = "https://github.com/acme/acme-admin/pull/16672";

/** `hand:steer-16676-post` as `hand list --json` prints it. */
const STEP = {
  context: "work",
  id: "steer-16676-post",
  opened: undefined,
  postedBy: "workspace:93",
  postedIso: "2026-09-25T10:41:02.458Z",
  unaddressed: undefined,
  unblocks: "the team hearing the opt-in PR description verb exists",
  url: "http://localhost:3000/queue?open=ask%3Aacme-post-16676-description-form",
  what: "Post the 16676 PR description announcement to #dev-team now, or hold it until 16672 lands",
  where: "the queue page",
  witness: "slopweaver hand done steer-16676-post --did 'picked one'",
};

/** The ask it opens, as `handover list --json` printed it: shaped, and parked on nobody. */
const ASK = {
  anchor: "transcript:a0000032-0000-4000-8000-000000000035#3caaf3bf-bd06-420d-9364-bf047fe993e5",
  blastRadius: "one top-level message in #dev-team, nobody tagged",
  hisWords: {
    anchor: "transcript:a0000032-0000-4000-8000-000000000035#3caaf3bf-bd06-420d-9364-bf047fe993e5",
    cut: "none",
    atIso: "2026-09-25T02:10:00.000Z",
    where: "session",
    words: "post the PR description form to the team",
  },
  kind: "ask",
  lean: "post now; it's opt-in with no CI check, which answers the two objections from the earlier thread",
  options: [
    {
      letter: "A",
      option: "post draft sd-e8ecf199 to #dev-team now",
      tradeoff: "the room from the earlier thread reads it before 16672 lands",
    },
    {
      letter: "B",
      option: "hold until 16672 (the plugin package) merges",
      tradeoff: "nobody hears about it until a dx reviewer ticks 16672",
    },
    { letter: "C", option: "reword first", tradeoff: "you tell me what's off and I redraft" },
  ],
  ownerWait: "not-waiting",
  prUrls: [PR_16672],
  priority: "p2",
  problem: "16676 has never been announced, so the team doesn't know the opt-in PR description verb exists",
  reason: "declared ready",
  repo: "/Users/someone/dev/acme-admin",
  risk: "the verb refuses an over-long section, so someone may raise caps again",
  section: "RUN NOW",
  slug: "acme-post-16676-description-form",
  status: "ready",
  stillReal: "slopweaver slack draft show sd-e8ecf199 shows it parked",
  stillRealIso: "2026-09-25T10:22:59.022Z",
  summary: "16676 (render a PR description from a Zod form): no standalone post went out.",
};

/** The draft option A names, held, and one it does not name. */
const PARKED = {
  items: [
    {
      draft: {
        advisory: [],
        authorId: "U0SYN000001",
        channel: "C0SYN000002",
        channelName: "dev-team",
        digest: "5acbeeefe63addb229c5ba34d65b8731",
        mentions: [],
        payload: { text: "made a thing where claude or codex writes a PR description through a form" },
        shape: "top-level",
        tsIso: "2026-09-25T10:22:45.429Z",
        why: "16676 announcement",
      },
      id: "sd-e8ecf199",
      release: {
        command: "slopweaver slack post --as me --draft sd-e8ecf199 --approve 5acbeeefe63addb229c5ba34d65b8731",
        kind: "send",
      },
      state: "held",
    },
    {
      draft: {
        advisory: [],
        authorId: "U0SYN000001",
        channel: "C0SYN000002",
        digest: "0000",
        mentions: [],
        payload: { text: "an unrelated post" },
        shape: "top-level",
        tsIso: "2026-09-25T10:00:00.000Z",
        why: "something else",
      },
      id: "sd-00000001",
      release: { command: "slopweaver slack post --as me --draft sd-00000001 --approve 0000", kind: "send" },
      state: "held",
    },
  ],
  people: [],
};

function rowsFor({
  steps = [STEP],
  asks = [ASK],
  parked = PARKED,
}: {
  steps?: readonly unknown[];
  asks?: readonly unknown[];
  parked?: unknown;
}): readonly QueueRow[] {
  return rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: ready({ value: readBoard({ rows: asks, unresolved: 0 })! }),
    drafts: LOADING,
    hands: ready({ value: readHandSteps(steps)! }),
    landing: LOADING,
    placer: ACME_PLACER,
    posts: ready({ value: readParkedDrafts(parked)! }),
    reviews: LOADING,
    imports: LOADING,
  });
}

function handRowOf({ rows }: { rows: readonly QueueRow[] }): QueueRow {
  return rows.find((row) => row.key === "hand:steer-16676-post")!;
}

type HandRecord = Extract<QueueRow["record"], { kind: "hand" }>;

/** The hand row's own record, asserted to be one first so the narrowing is a checked fact rather than a cast. */
function handRecordOf({ row }: { row: QueueRow }): HandRecord {
  expect(row.record.kind).toBe("hand");
  return row.record as HandRecord;
}

describe("a decision hand step draws the ask it opens", () => {
  it("draws the ask's problem, recorded options with trade-offs, lean and stakes — nothing composed around them", () => {
    const row = handRowOf({ rows: rowsFor({}) });
    const card = stepOf({ card: row.card });
    const decision = card.decision!;
    expect(card.question).toBe(
      "Post the 16676 PR description announcement to #dev-team now, or hold it until 16672 lands",
    );
    expect(decision.problem).toBe(ASK.problem);
    expect(decision.lean).toBe(ASK.lean);
    expect(decision.options).toEqual([
      {
        letter: "A",
        sentence: "post draft sd-e8ecf199 to #dev-team now",
        tradeoff: "the room from the earlier thread reads it before 16672 lands",
      },
      {
        letter: "B",
        sentence: "hold until 16672 (the plugin package) merges",
        tradeoff: "nobody hears about it until a dx reviewer ticks 16672",
      },
      { letter: "C", sentence: "reword first", tradeoff: "you tell me what's off and I redraft" },
    ]);
    expect(handRecordOf({ row }).form).toEqual({ kind: "drawn" });
    expect(decision.stakes).toEqual({
      blastRadius: ASK.blastRadius,
      checkedIso: ASK.stillRealIso,
      kind: "stated",
      risk: ASK.risk,
      stillReal: ASK.stillReal,
    });
    expect(card.subject).toBe("acme-post-16676-description-form");
    expect(decision.summary).toBe(ASK.summary);
  });

  it("stays the hand row, answers to the ask's key, and draws the ask no second row", () => {
    const rows = rowsFor({ asks: [{ ...ASK, ownerWait: "owner", question: "Post it now, or hold it?" }] });
    const row = handRowOf({ rows });
    expect(row.kind).toBe("hand");
    // The held draft its ask names is its own to send, so the draft's post card is absorbed too.
    expect(row.aliases).toEqual(["ask:acme-post-16676-description-form", "post:sd-e8ecf199"]);
    expect(rows.filter((one) => one.key === "post:sd-e8ecf199")).toEqual([]);
    expect(rows.filter((one) => one.key === "ask:acme-post-16676-description-form")).toEqual([]);
    expect(rowForOpen({ open: "ask:acme-post-16676-description-form", rows })!.key).toBe("hand:steer-16676-post");
  });

  it("carries the held draft its option names, and no other", () => {
    const record = handRecordOf({ row: handRowOf({ rows: rowsFor({}) }) });
    expect(record.drafts.map((named) => [named.kind, named.id])).toEqual([["held", "sd-e8ecf199"]]);
    expect(record.decision!.ask.slug).toBe("acme-post-16676-description-form");
  });

  it("carries a draft a plain step names, with no shaped ask to join", () => {
    const plain = { ...STEP, id: "plain", url: undefined, what: "Post draft sd-e8ecf199 when you are happy with it" };
    const row = rowsFor({ asks: [], steps: [plain] }).find((one) => one.key === "hand:plain")!;
    const record = handRecordOf({ row });
    expect(record.decision).toBe(undefined);
    expect(record.drafts.map((named) => [named.kind, named.id])).toEqual([["held", "sd-e8ecf199"]]);
  });

  it("resolves the ask's pull requests as the card's addresses", () => {
    expect(cardAddresses({ row: handRowOf({ rows: rowsFor({}) }) })).toContain(PR_16672);
  });

  it("leaves a second step opening the same ask without the alias, so a link opens one row", () => {
    const rows = rowsFor({ steps: [STEP, { ...STEP, id: "steer-16676-post-again" }] });
    expect(rows.filter((row) => row.kind === "hand").map((row) => [row.aliases, row.record.form.kind])).toEqual([
      [["ask:acme-post-16676-description-form", "post:sd-e8ecf199"], "drawn"],
      // …and is refused, since the draft it would draw is already the first step's (one card per held draft).
      [[], "refused"],
    ]);
  });

  it("still draws the step's literal as the card's copy block, beside the ask's options", () => {
    const literal = "slopweaver slack post --as me --draft sd-e8ecf199";
    const card = stepOf({ card: handRowOf({ rows: rowsFor({ steps: [{ ...STEP, literal }] }) }).card });
    expect(card.decision!.problem).toBe(ASK.problem);
    expect(card.copy).toBe(literal);
  });
});

describe("the join drops only the ask it absorbed", () => {
  it("keeps a second board row sharing the slug, which it never joined", () => {
    const other = { ...ASK, lean: undefined, options: [], ownerWait: "owner", problem: undefined, question: "Which?" };
    const rows = rowsFor({ asks: [ASK, other] });
    expect(
      rows.filter((row) => row.key === "ask:acme-post-16676-description-form").map((row) => row.card.question),
    ).toEqual(["Which?"]);
    expect(rowForOpen({ open: "ask:acme-post-16676-description-form", rows })!.kind).toBe("ask");
    // …and the hand row gives the key up, so a context filter hiding the ask row can never let the alias shadow it.
    expect(rows.find((row) => row.key === "hand:steer-16676-post")!.aliases).toEqual(["post:sd-e8ecf199"]);
  });
});

describe("a board that could not be read leaves every row that joins it a finding", () => {
  const stderr = "handover list timed out\n    at readBoard (/srv/app/board.ts:12:5)";
  const unread = { phase: "not-measured", why: stderr } as const;
  // The board read's raw reason is the warning beside the finding, byte for byte, never inside its hover.
  const unplaced = {
    kind: "unplaced",
    warning: { lead: "The board it joins could not be read", subject: "the board it joins", why: stderr },
    why: "the board it joins could not be read, so a row stating its workspace may be hidden (NOT MEASURED)",
  };

  it("does not place a hand step by the Slopweaver pull request it cites while the ask it opens is unread", () => {
    const { context: _dropped, ...unstated } = STEP;
    const rows = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: LOADING,
      board: unread,
      drafts: LOADING,
      hands: ready({
        value: readHandSteps([{ ...unstated, cites: [`https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/1`] }])!,
      }),
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    expect(handRowOf({ rows }).placement).toStrictEqual(unplaced);
  });

  it("does not place an act by its own subject while the board its run joins is unread", () => {
    const acts = readAutonomy([
      {
        action: {
          actionId: "a1",
          doneIso: "2026-09-25T10:00:00.000Z",
          kind: "edit-pr-description",
          subject: `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/1`,
          why: "stale description",
        },
      },
    ])!;
    const rows = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: ready({ value: acts }),
      board: unread,
      drafts: LOADING,
      hands: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    expect(rows.find((row) => row.key === "act:a1")!.placement).toStrictEqual(unplaced);
  });
});

describe("a join never hides the finding the ask it opens is", () => {
  const unplaced = { ...ASK, ownerWait: "owner", prUrls: [], question: "Post it now, or hold it?" };

  it("keeps an unplaced ask its own row beside a hand step its --context places", () => {
    const rows = rowsFor({ asks: [unplaced] });
    const hand = handRowOf({ rows });
    expect(hand.placement).toEqual({
      by: [{ source: "stated", value: "team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    });
    expect(hand.aliases).toEqual(["post:sd-e8ecf199"]);
    expect(
      rows.filter((row) => row.key === "ask:acme-post-16676-description-form").map((row) => row.placement.kind),
    ).toEqual(["unplaced"]);
    expect(rowForOpen({ open: "ask:acme-post-16676-description-form", rows })!.kind).toBe("ask");
  });

  it("refuses the unjoined ask when it names the held draft the hand step already draws — one card per draft", () => {
    const rows = rowsFor({ asks: [unplaced] });
    const ask = rows.find((row) => row.key === "ask:acme-post-16676-description-form")!;
    expect(ask.record.form).toEqual({
      kind: "refused",
      why:
        "This card would draw held Slack draft sd-e8ecf199 (already on hand:steer-16676-post), so it is refused rather " +
        "than asking the owner about one draft on two Queue cards. That is a defect in whatever recorded this card, which " +
        "should name the draft only where it is asked.",
    });
  });

  it("keeps an ask stating team its own row beside a hand step in the Slopweaver context", () => {
    const rows = rowsFor({
      asks: [{ ...unplaced, workspace: "team" }],
      steps: [{ ...STEP, context: "slopweaver" }],
    });
    expect(handRowOf({ rows }).placement.kind).toBe("placed");
    expect(handRowOf({ rows }).aliases).toEqual(["post:sd-e8ecf199"]);
    expect(
      rows
        .filter((row) => row.key === "ask:acme-post-16676-description-form")
        .map((row) => shownInContext({ context: "work", placement: row.placement })),
    ).toEqual([true]);
  });

  it("still absorbs an ask placed where the hand step is", () => {
    const rows = rowsFor({ asks: [{ ...unplaced, workspace: "team" }] });
    expect(handRowOf({ rows }).aliases).toEqual(["ask:acme-post-16676-description-form", "post:sd-e8ecf199"]);
    expect(rows.filter((row) => row.key === "ask:acme-post-16676-description-form")).toEqual([]);
  });

  it("keeps an unplaced ask its own row beside a conflicting hand step, so its own mark stays drawn", () => {
    const cites = ["https://github.com/acme/acme-admin/pull/1", `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/2`];
    const rows = rowsFor({ asks: [unplaced], steps: [{ ...STEP, cites, context: undefined }] });
    expect(handRowOf({ rows }).placement.kind).toBe("conflict");
    expect(handRowOf({ rows }).aliases).toEqual(["post:sd-e8ecf199"]);
    expect(
      rows.filter((row) => row.key === "ask:acme-post-16676-description-form").map((row) => row.placement.kind),
    ).toEqual(["unplaced"]);
  });

  it("keeps an unplaced ask its own row beside a hand step that is an unplaced finding too, so both marks stay", () => {
    const rows = rowsFor({ asks: [unplaced], steps: [{ ...STEP, context: undefined }] });
    expect(handRowOf({ rows }).placement.kind).toBe("unplaced");
    expect(handRowOf({ rows }).aliases).toEqual(["post:sd-e8ecf199"]);
    expect(
      rows.filter((row) => row.key === "ask:acme-post-16676-description-form").map((row) => row.placement.kind),
    ).toEqual(["unplaced"]);
  });
});

describe("a joined hand card cites the page its ask published, through the real join", () => {
  const PAGE = "file:///Users/someone/.slopweaver/pages/sd-e8ecf199-preview/index.html";

  it("leads its chips with the ask's artifact, answers the ask's link and is drawn", () => {
    const row = handRowOf({ rows: rowsFor({ asks: [{ ...ASK, artifact: PAGE }] }) });
    expect(stepOf({ card: row.card }).pages).toEqual([{ slug: "sd-e8ecf199-preview", url: PAGE }]);
    expect(row.aliases).toEqual(["ask:acme-post-16676-description-form", "post:sd-e8ecf199"]);
    expect(handRecordOf({ row }).form).toEqual({ kind: "drawn" });
  });

  it("is refused, quoting none of it, when the ask's artifact is no address a chip can open", () => {
    const row = handRowOf({ rows: rowsFor({ asks: [{ ...ASK, artifact: "javascript:alert(1)" }] }) });
    expect(stepOf({ card: row.card }).pages).toEqual([]);
    expect(handRecordOf({ row }).form).toEqual({
      kind: "refused",
      why:
        "This card's row records its answer at no web or file address a chip can open, so it is refused rather " +
        "than drawn with the voice reading a place the owner cannot follow.",
    });
  });

  it("reads the page off the same row the decision joins when two rows share the slug", () => {
    const row = handRowOf({ rows: rowsFor({ asks: [ASK, { ...ASK, artifact: PAGE }] }) });
    expect(stepOf({ card: row.card }).decision).toBeDefined();
    expect(stepOf({ card: row.card }).pages).toEqual([]);
    expect(handRecordOf({ row }).form).toEqual({ kind: "drawn" });
  });

  it("still cites the page when the ask it opens is unshaped and joins no decision", () => {
    const unshaped = { ...ASK, artifact: PAGE, lean: undefined, options: [], problem: undefined };
    const row = handRowOf({ rows: rowsFor({ asks: [unshaped] }) });
    expect(stepOf({ card: row.card }).decision).toBe(undefined);
    expect(stepOf({ card: row.card }).pages).toEqual([{ slug: "sd-e8ecf199-preview", url: PAGE }]);
    expect(handRecordOf({ row }).form).toEqual({ kind: "drawn" });
  });
});

describe("a hand step with no shaped ask stays a step to take", () => {
  /** The rows every plain `STEP` card draws: its own fields, in order, and nothing else. */
  const STEP_ROWS = [
    { label: "go to", value: STEP.url },
    { label: "unblocks", value: STEP.unblocks },
    { behind: true, label: "where", value: STEP.where },
    { behind: true, label: "done when", value: STEP.witness },
  ];

  it("draws only the step's own rows when the ask it opens is not shaped", () => {
    const rows = rowsFor({ asks: [{ ...ASK, lean: undefined, options: [], problem: undefined }] });
    const row = handRowOf({ rows });
    const card = stepOf({ card: row.card });
    expect(card.decision).toBe(undefined);
    expect(card.rows).toEqual(STEP_ROWS);
    expect(row.aliases).toEqual([]);
  });

  it("reads an ask whose problem and lean are only blanks as unshaped, drawing no blank rows", () => {
    const row = handRowOf({ rows: rowsFor({ asks: [{ ...ASK, lean: "\t", problem: "   " }] }) });
    expect(stepOf({ card: row.card }).decision).toBe(undefined);
    expect(stepOf({ card: row.card }).rows).toEqual(STEP_ROWS);
  });

  it("draws only the step's own rows when the board holds no such ask", () => {
    const row = handRowOf({ rows: rowsFor({ asks: [] }) });
    expect(stepOf({ card: row.card }).rows).toEqual(STEP_ROWS);
    expect(handRecordOf({ row }).decision).toBe(undefined);
    expect(handRecordOf({ row }).form).toEqual({ kind: "drawn" });
  });
});
