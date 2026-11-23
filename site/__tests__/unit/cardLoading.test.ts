/*
 * Whether an opened card is still waiting on a read its content is derived from, off rows `rowsOf` really builds.
 * A card opened fresh sits half-drawn for ten to fifteen seconds, then fills in — so a card with a read in flight is
 * one loading state, and a register that could not be read is not loading.
 */

import { describe, expect, it } from "vitest";

import { type Board, readBoard, readHandSteps } from "../../components/live/read";
import { type AutonomyRow, readAutonomy } from "../../components/live/readAutonomy";
import { readImportQuestions } from "../../components/live/readImportQuestions";
import { type LandingReading, readLandingReading } from "../../components/live/readLanding";
import { type ParkedDraft, readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import type { ActPullState } from "../../lib/actPullVerb";
import {
  askPendingNow,
  cardLoading,
  cardLoadingLine,
  drawnThreadOf,
  ownRegisterWait,
  threadDraftsWait,
} from "../../lib/cardLoading";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;
const IDLE: ActPullState = { phase: "idle" };
const SLUG = "the-bot-s-own-posts-into-the-ada";
const DRAFT_ID = "sd-0a1b2c3d";

function ready<T>({ value, refreshing }: { value: T; refreshing?: true }): LiveState<T> {
  const state: LiveState<T> = {
    fixture: undefined,
    observedAtIso: "2026-09-27T06:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
  if (refreshing === undefined) {
    return state;
  }
  return { ...state, refreshing };
}

/** A hand step opening the ask below — the shape `hand list --json` prints. */
const STEP = {
  context: "work",
  id: "steer-iso-rosa-drafts",
  postedBy: "every-open-hand-step-and-board-ask-is",
  postedIso: "2026-09-26T02:25:19.596Z",
  url: "http://localhost:3000/queue?open=ask%3Aiso-compliance-violations-bigtask&context=work",
  what: "Say whether to close ABC-1",
  witness: "slopweaver hand done steer-iso-rosa-drafts --did 'yes or hold'",
};

/** The ask that step opens, offering a reply. */
const ASK = {
  action: {
    actor: "me",
    body: "happy for me to upload it?",
    destinations: [
      {
        channel: "C0SYN000001",
        kind: "thread",
        label: "Your change management thread",
        permalink: "https://acme.slack.com/archives/C0SYN000001/p1790054263189439",
        threadTs: "1790054263.189439",
        tradeoff: "under your name",
      },
    ],
    mentions: [],
    version: 1,
  },
  kind: "ask",
  ownerWait: "owner",
  prUrls: [],
  priority: "p1",
  question: "Can I post this one reply as you?",
  reason: "waiting on the owner",
  section: "WAITING ON YOU",
  slug: "iso-compliance-violations-bigtask",
  status: "ready",
};

function boardOf({ asks }: { asks: readonly unknown[] }): Board {
  return readBoard({ rows: asks, unresolved: 0 })!;
}

function landingOf(): LandingReading {
  return readLandingReading({
    by: "sync-now",
    document: { residue: [], rows: [], tally: { byAction: [], ready: 0, total: 0 } },
    observedAtIso: "2026-09-27T06:00:00.000Z",
    readingId: "r-1",
    recordedAtIso: "2026-09-27T06:00:00.000Z",
  })!;
}

/** An unsteered finding act — the card that looks its pull request up by branch when it opens. */
function acts(): readonly AutonomyRow[] {
  return readAutonomy([
    {
      action: {
        actionId: `finding-pr.${SLUG}`,
        doneIso: "2026-09-22T11:00:00.000Z",
        kind: "open-internal-finding-pull-request",
        run: SLUG,
        said: "I opened a pull request for a problem the fleet found itself.",
        subject: SLUG,
        why: "an unruled fleet finding",
        witness: "open a pull request on main: finding gate",
      },
    },
  ])!;
}

/** The drafts register once it has read. */
const POSTS_READ: LiveState<readonly ParkedDraft[]> = ready({ value: readParkedDrafts({ items: [], people: [] })! });

function rowOf({
  kind,
  board,
  steps = [STEP],
  posts = POSTS_READ,
}: {
  kind: QueueRow["kind"];
  board: LiveState<Board>;
  steps?: readonly unknown[];
  posts?: LiveState<readonly ParkedDraft[]>;
}): QueueRow {
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: ready({ value: acts() }),
    board,
    drafts: LOADING,
    hands: ready({ value: readHandSteps(steps)! }),
    landing: LOADING,
    placer: ACME_PLACER,
    posts,
    reviews: LOADING,
    imports: LOADING,
  });
  return rows.find((one) => one.kind === kind)!;
}

describe("cardLoading — a hand step", () => {
  it("waits on the board while it loads and the ask the step opens is not in hand", () => {
    const row = rowOf({ board: LOADING, kind: "hand" });
    expect(cardLoading({ board: LOADING, landing: LOADING, lookup: IDLE, posts: POSTS_READ, row })).toEqual([
      { kind: "opened-ask-board" },
    ]);
  });

  it("waits on a retained board being re-read that does not carry the ask yet", () => {
    const board = ready({ refreshing: true, value: boardOf({ asks: [] }) });
    const row = rowOf({ board, kind: "hand" });
    expect(cardLoading({ board, landing: LOADING, lookup: IDLE, posts: POSTS_READ, row })).toEqual([
      { kind: "opened-ask-board" },
    ]);
  });

  it("draws at once off a retained board that already carries the ask", () => {
    const board = ready({ refreshing: true, value: boardOf({ asks: [ASK] }) });
    const row = rowOf({ board, kind: "hand" });
    expect(cardLoading({ board, landing: LOADING, lookup: IDLE, posts: POSTS_READ, row })).toEqual([]);
  });

  it("is not loading when the board could not be read — the card draws the reason", () => {
    const board: LiveState<Board> = { phase: "not-measured", why: "handover list exited 1" };
    const row = rowOf({ board, kind: "hand" });
    expect(cardLoading({ board, landing: LOADING, lookup: IDLE, posts: POSTS_READ, row })).toEqual([]);
  });

  it("waits on a draft it names while the drafts register loads", () => {
    const board = ready({ value: boardOf({ asks: [ASK] }) });
    const row = rowOf({
      board,
      kind: "hand",
      posts: LOADING,
      steps: [{ ...STEP, what: `Read parked draft ${DRAFT_ID} and say whether to post it` }],
    });
    expect(cardLoading({ board, landing: LOADING, lookup: IDLE, posts: LOADING, row })).toEqual([
      { ids: [DRAFT_ID], kind: "named-drafts" },
    ]);
  });

  // A row that left its register stays open as the snapshot taken while the drafts register loaded.
  it("stops waiting on a named draft once the live drafts register settles, whatever the snapshot says", () => {
    const board = ready({ value: boardOf({ asks: [ASK] }) });
    const row = rowOf({
      board,
      kind: "hand",
      posts: LOADING,
      steps: [{ ...STEP, what: `Read parked draft ${DRAFT_ID} and say whether to post it` }],
    });
    const failed: LiveState<readonly ParkedDraft[]> = { phase: "not-measured", why: "slack draft list exited 1" };
    expect(cardLoading({ board, landing: LOADING, lookup: IDLE, posts: POSTS_READ, row })).toEqual([]);
    expect(cardLoading({ board, landing: LOADING, lookup: IDLE, posts: failed, row })).toEqual([]);
  });

  // A snapshot taken while the drafts register had FAILED, open while the live register reads again.
  it("waits on every named draft while the live drafts register loads, whatever the snapshot says", () => {
    const board = ready({ value: boardOf({ asks: [ASK] }) });
    const failed: LiveState<readonly ParkedDraft[]> = { phase: "not-measured", why: "slack draft list exited 1" };
    const row = rowOf({
      board,
      kind: "hand",
      posts: failed,
      steps: [{ ...STEP, what: `Read parked draft ${DRAFT_ID} and say whether to post it` }],
    });
    expect(cardLoading({ board, landing: LOADING, lookup: IDLE, posts: LOADING, row })).toEqual([
      { ids: [DRAFT_ID], kind: "named-drafts" },
    ]);
  });
});

describe("cardLoading — an act", () => {
  it("waits on the board, the owner's pull requests and the by-branch lookup while each is in flight", () => {
    const row = rowOf({ board: LOADING, kind: "act" });
    const lookup: ActPullState = { branch: SLUG, phase: "loading" };
    expect(cardLoading({ board: LOADING, landing: LOADING, lookup, posts: POSTS_READ, row })).toEqual([
      { kind: "act-board" },
      { kind: "act-landing" },
      { branch: SLUG, kind: "act-pull" },
    ]);
  });

  it("draws once every read has arrived, a failed lookup included", () => {
    const board = ready({ value: boardOf({ asks: [] }) });
    const landing = ready({ value: landingOf() });
    const row = rowOf({ board, kind: "act" });
    const lookup: ActPullState = { branch: SLUG, phase: "not-measured", why: "github search exited 1" };
    expect(cardLoading({ board, landing, lookup, posts: POSTS_READ, row })).toEqual([]);
  });

  it("does not wait on a retained board being re-read", () => {
    const board = ready({ refreshing: true, value: boardOf({ asks: [] }) });
    const landing = ready({ value: landingOf() });
    const row = rowOf({ board, kind: "act" });
    expect(cardLoading({ board, landing, lookup: IDLE, posts: POSTS_READ, row })).toEqual([]);
  });
});

describe("cardLoadingLine", () => {
  it("names one read", () => {
    expect(cardLoadingLine({ waits: [{ kind: "opened-ask-board" }] })).toBe(
      "Reading the board. The card draws whole once it arrives.",
    );
  });

  it("names each read once, the last joined with and", () => {
    expect(
      cardLoadingLine({
        waits: [{ kind: "act-board" }, { kind: "act-landing" }, { branch: SLUG, kind: "act-pull" }],
      }),
    ).toBe(
      `Reading the board, your open pull requests and the pull request opened from ${SLUG}. The card draws whole once they arrive.`,
    );
  });

  it("names the drafts it waits on by id", () => {
    expect(cardLoadingLine({ waits: [{ ids: [DRAFT_ID, "sd-4e5f6a7b"], kind: "named-drafts" }] })).toBe(
      `Reading the drafts it names (${DRAFT_ID}, sd-4e5f6a7b). The card draws whole once it arrives.`,
    );
  });
});

// A gone snapshot is drawn over whatever its own register holds now, which may be loading with no answer.
describe("ownRegisterWait", () => {
  const board = ready({ value: boardOf({ asks: [ASK] }) });
  const row = rowOf({ board, kind: "ask" });
  const settled = {
    acts: ready({ value: acts() }),
    board,
    drafts: LOADING,
    hands: ready({ value: readHandSteps([STEP])! }),
    landing: LOADING,
    posts: POSTS_READ,
    reviews: LOADING,
    imports: LOADING,
  };

  it("waits on the board an ask card came from while it loads", () => {
    const waits = ownRegisterWait({ registers: { ...settled, board: LOADING }, row });
    expect(waits).toEqual([{ kind: "own-register", register: "ask" }]);
    expect(cardLoadingLine({ waits })).toBe("Reading the board. The card draws whole once it arrives.");
  });

  it("waits on nothing once its own register has an answer, whatever the others are doing", () => {
    expect(ownRegisterWait({ registers: settled, row })).toEqual([]);
  });

  it("never waits on a register that failed", () => {
    const failed: LiveState<Board> = { phase: "not-measured", why: "handover list exited 1" };
    expect(ownRegisterWait({ registers: { ...settled, board: failed }, row })).toEqual([]);
  });

  it("waits on the staged import questions an import card came from while they load, and on nothing once read", () => {
    const imports = ready({
      value: readImportQuestions({
        observedAtIso: "2026-09-27T06:00:00.000Z",
        questions: [
          {
            actions: ["activate", "leave-inactive"],
            batchId: "00000000-0000-4000-8000-0000000000a1",
            current: null,
            imported: "acme-directive-1: always open a draft pull request for the acme-admin repo",
            key: "acme-directive-1",
            kind: "activation",
            part: "owner-directives",
            questionId: "import-q-00000000000000a1",
            stagedAtIso: "2026-09-26T09:00:00.000Z",
          },
        ],
      })!,
    });
    const [question] = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      imports,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      reviews: LOADING,
      standing: LOADING,
    });
    const waits = ownRegisterWait({ registers: { ...settled, imports: LOADING }, row: question });
    expect(waits).toEqual([{ kind: "own-register", register: "import" }]);
    expect(cardLoadingLine({ waits })).toBe(
      "Reading the staged import questions. The card draws whole once it arrives.",
    );
    expect(ownRegisterWait({ registers: { ...settled, imports }, row: question })).toEqual([]);
  });
});

// An ask's thread says whether a draft is held for it, so it must not say "none" before the register reads.
describe("threadDraftsWait", () => {
  const THREAD = "https://acme.slack.com/archives/C0SYN000001/p1790054263189439";
  const threaded = ({ board }: { board: LiveState<Board> }): QueueRow => rowOf({ board, kind: "ask" });
  const THREADED_BOARD = ready({ value: boardOf({ asks: [{ ...ASK, reason: `waiting on the owner in ${THREAD}` }] }) });

  it("waits on the held drafts while they load, for an ask that draws its thread", () => {
    const row = threaded({ board: THREADED_BOARD });
    expect(row.threadUrl).toBe(THREAD);
    expect(threadDraftsWait({ drafts: LOADING, row })).toEqual([{ kind: "thread-held-drafts" }]);
  });

  it("waits on nothing for an ask with no thread to draw", () => {
    const row = rowOf({ board: ready({ value: boardOf({ asks: [ASK] }) }), kind: "ask" });
    expect(row.threadUrl).toBe(undefined);
    expect(threadDraftsWait({ drafts: LOADING, row })).toEqual([]);
  });

  it("waits on nothing once the held drafts have an answer, or failed", () => {
    const row = threaded({ board: THREADED_BOARD });
    expect(threadDraftsWait({ drafts: ready({ value: [] }), row })).toEqual([]);
    expect(threadDraftsWait({ drafts: { phase: "not-measured", why: "queue list exited 1" }, row })).toEqual([]);
  });

  // A decision step floats its ask's card, so it leads with the same thread and waits too.
  it("waits on the held drafts for a decision step whose ask draws a thread", () => {
    const { action: _offersNoDraft, ...unoffered } = ASK;
    const shaped = {
      ...unoffered,
      anchor: THREAD,
      lean: "a seat reviews it",
      options: [
        { letter: "A", option: "a seat reviews it", tradeoff: "one seat" },
        { letter: "B", option: "leave it to platform", tradeoff: "the fix waits" },
      ],
      problem: "the platform review is still requested",
    };
    const row = rowOf({ board: ready({ value: boardOf({ asks: [shaped] }) }), kind: "hand" });
    expect(row.record).toMatchObject({ decision: { ask: { slug: ASK.slug } }, kind: "hand" });
    expect(drawnThreadOf({ row })).toBe(THREAD);
    expect(threadDraftsWait({ drafts: LOADING, row })).toEqual([{ kind: "thread-held-drafts" }]);
  });

  it("draws no thread for a decision step whose ask names none", () => {
    const row = rowOf({ board: ready({ value: boardOf({ asks: [ASK] }) }), kind: "hand" });
    expect(drawnThreadOf({ row })).toBe(undefined);
    expect(threadDraftsWait({ drafts: LOADING, row })).toEqual([]);
  });

  it("draws no thread for a plain step that only names a Slack link in its own words", () => {
    const row = rowOf({
      board: ready({ value: boardOf({ asks: [] }) }),
      kind: "hand",
      steps: [{ ...STEP, url: "http://localhost:3000/queue", what: `Click approve in ${THREAD}` }],
    });
    expect(row.threadUrl).toBe(THREAD);
    expect(drawnThreadOf({ row })).toBe(undefined);
  });
});

describe("askPendingNow", () => {
  const BOARD: LiveState<Board> = ready({ value: boardOf({ asks: [] }) });

  const READING = { phase: "reading" } as const;

  it("keeps a live card's spinner while its board has not been read again", () => {
    expect(askPendingNow({ askPending: READING, board: BOARD, gone: false, reread: undefined, stale: true })).toEqual(
      READING,
    );
  });

  it("keeps a live card's spinner while the re-read is in flight", () => {
    expect(
      askPendingNow({ askPending: READING, board: BOARD, gone: false, reread: { landed: false }, stale: true }),
    ).toEqual(READING);
  });

  it("marks the ask stale, saying why, once the one re-read landed and still predates the step, rather than spinning forever", () => {
    expect(
      askPendingNow({ askPending: READING, board: BOARD, gone: false, reread: { landed: true }, stale: true }),
    ).toEqual({
      phase: "not-measured",
      why: "the board was read again and that read still began before this step was posted; reloading the page reads it",
    });
  });

  it("keeps a pending state that is not about a stale board, whatever re-read was asked", () => {
    expect(
      askPendingNow({ askPending: READING, board: BOARD, gone: false, reread: { landed: true }, stale: false }),
    ).toEqual(READING);
  });

  it("marks a gone card's ask stale, saying why, rather than spinning forever", () => {
    expect(askPendingNow({ askPending: READING, board: BOARD, gone: true, reread: undefined, stale: false })).toEqual({
      phase: "not-measured",
      why: "this step left your hands before the board holding the ask it opens arrived, and nothing reads it here now",
    });
  });

  it("draws nothing when the ask was in hand", () => {
    expect(
      askPendingNow({ askPending: undefined, board: BOARD, gone: true, reread: { landed: true }, stale: true }),
    ).toBe(undefined);
  });
});
