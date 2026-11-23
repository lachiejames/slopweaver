/*
 * The whole console seam for an OFFERED ask, from the document `slopweaver handover list --json` publishes
 * through to the card the panel draws: `readBoard` reads the action, `rowsOf` resolves each destination
 * into the exact line that would send it, and `askCard` letters them with the hold last.
 *
 * Driven through the real readers rather than a hand-built `BoardRow`, because the defect this closes —
 * an option drawn over a draft addressed somewhere else — lives in the wiring between them.
 */

import { describe, expect, it } from "vitest";

import { type Board, readBoard } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";
import { briefingOf } from "./cardKind";

/** A register that has not arrived — every one but the board, on every case here. */
const LOADING = { phase: "loading" } as const;

/** One ready register. */
function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-22T12:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** The action a published row carries. */
const ACTION = {
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is ready for review — one approval and it lands tonight.",
  destinations: [
    {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are asking",
    },
    {
      conversation: "D01ARI",
      kind: "dm",
      label: "DM Ari",
      recipients: [{ label: "Ari", userId: "U01ARI" }],
      tradeoff: "only Ari sees it, so nobody else can pick it up",
    },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

/** One published board holding a single ask waiting on the owner's word. */
function boardWith({ over }: { over: Record<string, unknown> }): Board {
  const board = readBoard({
    rows: [
      {
        anchor: "transcript:a0000036#116b8349",
        kind: "ask",
        ownerWait: "owner",
        priority: "p1",
        question: "Do you want to post this into #delivery?",
        questionAskedIso: "2026-09-22T11:00:00.000Z",
        reason: "waiting on the owner",
        section: "runnable",
        slug: "an-ask-offers-the-concrete-action",
        status: "waiting-on-owner",
        ...over,
      },
    ],
    unresolved: 0,
  });
  if (board === undefined) {
    throw new Error("the fixture board did not read");
  }
  return board;
}

/** The one queue row a board yields, throwing when it yielded a different number. */
function onlyRow({ board }: { board: Board }): QueueRow {
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: ready({ value: board }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new Error(`expected one row, got ${String(rows.length)}`);
  }
  return row;
}

describe("an offered ask, from the published document to the card", () => {
  it("draws one option per destination, then the leave-it option", () => {
    const row = onlyRow({ board: boardWith({ over: { action: ACTION } }) });
    expect(briefingOf({ card: row.card }).options.map((option) => option.sentence)).toEqual([
      "Post it to #delivery",
      "DM Ari",
      "Leave it: the board keeps the row parked on you and no session picks it up.",
    ]);
  });

  it("prints the real send command, with the draft fed over a heredoc", () => {
    const row = onlyRow({ board: boardWith({ over: { action: ACTION } }) });
    expect(briefingOf({ card: row.card }).options[0].how).toEqual({
      command:
        "slopweaver slack post --as me --channel C01SDLC --shape top-level --body - <<'EOF'\n" + `${ACTION.body}\nEOF`,
      kind: "elsewhere",
      where: "a new top-level message in C01SDLC",
    });
  });

  it("sends a DM into the conversation the action named, and says who it reaches", () => {
    const row = onlyRow({ board: boardWith({ over: { action: ACTION } }) });
    expect(briefingOf({ card: row.card }).options[1].how).toEqual({
      command:
        "slopweaver slack post --as me --channel D01ARI --shape top-level --body - <<'EOF'\n" + `${ACTION.body}\nEOF`,
      kind: "elsewhere",
      where: "a DM to Ari",
    });
  });

  it("falls back to the supervisor chat on a row that offers no draft", () => {
    const options = [
      { letter: "A", option: "Ship the schema", tradeoff: "the card still reads as a paragraph" },
      { letter: "B", option: "Ship the card", tradeoff: "one more day" },
    ];
    const over = { lean: "take B", options, problem: "no verb states a lean" };
    const row = onlyRow({ board: boardWith({ over }) });
    expect(briefingOf({ card: row.card }).options[0].how).toEqual({
      command: undefined,
      kind: "elsewhere",
      where: "the supervisor chat",
    });
  });

  // No boilerplate options — the reaction field is how the owner answers it.
  it("draws no option at all on a row whose draft will not read, rather than printing a broken command", () => {
    const row = onlyRow({ board: boardWith({ over: { action: { ...ACTION, destinations: [] } } }) });
    expect(briefingOf({ card: row.card }).options).toEqual([]);
  });
});

describe("the links an ask row publishes", () => {
  it("prefers the published anchor over anything parsed out of the capped summary", () => {
    const over = {
      summary: "see https://acme.slack.com/archives/C01SDLC/p1700000000000000 for the thread",
      summaryAnchor: "https://acme.slack.com/archives/C01SDLC/p1758500000000100",
    };
    expect(onlyRow({ board: boardWith({ over }) }).threadUrl).toBe(
      "https://acme.slack.com/archives/C01SDLC/p1758500000000100",
    );
  });

  it("falls back to the row's own prose when the verb published no anchor", () => {
    const over = { summary: "see https://acme.slack.com/archives/C01SDLC/p1700000000000000 for the thread" };
    expect(onlyRow({ board: boardWith({ over }) }).threadUrl).toBe(
      "https://acme.slack.com/archives/C01SDLC/p1700000000000000",
    );
  });

  it("names no thread when the row names one nowhere", () => {
    expect(onlyRow({ board: boardWith({ over: {} }) }).threadUrl).toBeUndefined();
  });

  // A review card's thread that lives only in its anchor must still draw a thread.
  it("takes the row's own anchor when it is a Slack thread and the prose names none", () => {
    const over = { anchor: "https://acme.slack.com/archives/C0SYN000014/p1791159813645479" };
    expect(onlyRow({ board: boardWith({ over }) }).threadUrl).toBe(
      "https://acme.slack.com/archives/C0SYN000014/p1791159813645479",
    );
  });

  it("takes a Slack anchor ahead of a different link the prose names", () => {
    const over = {
      anchor: "https://acme.slack.com/archives/C01SDLC/p1758500000000100",
      reason: "see https://acme.slack.com/archives/C01OTHER/p1700000000000000",
    };
    expect(onlyRow({ board: boardWith({ over }) }).threadUrl).toBe(
      "https://acme.slack.com/archives/C01SDLC/p1758500000000100",
    );
  });

  it("still prefers the summary's published anchor over the row's own Slack anchor", () => {
    const over = {
      anchor: "https://acme.slack.com/archives/C01SDLC/p1758500000000100",
      summaryAnchor: "https://acme.slack.com/archives/C01OTHER/p1700000000000000",
    };
    expect(onlyRow({ board: boardWith({ over }) }).threadUrl).toBe(
      "https://acme.slack.com/archives/C01OTHER/p1700000000000000",
    );
  });

  it("reads no thread out of an anchor that is a pull request rather than a Slack permalink", () => {
    const over = { anchor: "https://github.com/acme/acme-admin/pull/18326" };
    expect(onlyRow({ board: boardWith({ over }) }).threadUrl).toBeUndefined();
  });
});

describe("readBoard over the pull requests an ask card links", () => {
  it("reads every published pull-request URL, in the order the verb wrote them", () => {
    const prUrls = ["https://github.com/acme/acme-admin/pull/16339", "https://github.com/acme/slopweaver/pull/1114"];
    expect(boardWith({ over: { prUrls } }).rows[0].prUrls).toEqual(prUrls);
  });

  it("reads no links at all off a board cut before the field existed, which is not the same as a row with none", () => {
    expect(boardWith({ over: {} }).rows[0].prUrls).toEqual([]);
  });

  it("drops a published list that is not links, rather than drawing whatever it holds", () => {
    expect(boardWith({ over: { prUrls: [7, "https://github.com/e/p/pull/1"] } }).rows[0].prUrls).toEqual([]);
  });

  it("carries the row's own anchor, so a card can link back to what the owner actually said", () => {
    expect(boardWith({ over: {} }).rows[0].anchor).toBe("transcript:a0000036#116b8349");
  });
});

describe("readBoard → rowsOf over an ask whose draft will not read", () => {
  /** The same action with its DM destination stripped of the conversation it would reach. */
  const broken = {
    ...ACTION,
    destinations: [ACTION.destinations[0], { ...ACTION.destinations[1], conversation: undefined }],
  };

  /** The options a publisher derived from that action before one of its destinations broke. */
  const stored = [
    { letter: "A", option: "DM Tobias", tradeoff: "only Tobias sees it" },
    { letter: "B", option: "Hold", tradeoff: "the review waits" },
  ];

  // The stored list is a takeable decision — "DM Tobias" — over a draft the panel is at the same moment
  // reporting as malformed, and it names a person the action reaches nowhere. Both halves are in the input
  // (the good #delivery destination and the stored list), so a card that went back to drawing either reddens
  // this.
  it("draws neither the surviving destination nor the options the row stored", () => {
    const row = onlyRow({ board: boardWith({ over: { action: broken, options: stored } }) });
    const sentences = briefingOf({ card: row.card }).options.map((one) => one.sentence);

    // It draws no option at all, which is honest: the row offers nothing takeable, so the card's reaction field
    // asks for the owner's word rather than presenting a choice it cannot make.
    expect(sentences).toEqual([]);
  });

  it("still draws the stored options for an ask carrying no draft at all, which is most of them", () => {
    const row = onlyRow({ board: boardWith({ over: { options: stored } }) });

    expect(briefingOf({ card: row.card }).options.map((one) => one.sentence)).toEqual(["DM Tobias", "Hold"]);
  });
});
