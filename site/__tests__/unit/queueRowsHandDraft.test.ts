/*
 * A hand step asking the owner to react to a message drafted as the owner, from the documents the queue reads to the
 * one row it draws: the message the ask it opens offers rides the row whether or not that ask is shaped, and a step
 * carrying no message at all is refused rather than drawn as a question with nothing to react to.
 *
 * The step below is a `steer-iso-rosa-drafts` record; the ask is the ISO run's row as `handover list --json` prints it.
 */

import { describe, expect, it } from "vitest";

import { type Board, readBoard, readHandSteps } from "../../components/live/read";
import { readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { draftAsOwnerPhrase } from "../../lib/draftAsOwner";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-27T06:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** `hand:steer-iso-rosa-drafts` as `hand list --json` prints it. */
const STEP = {
  cites: [
    "https://github.com/acme/acme-admin/pull/17680",
    "https://github.com/acme/acme-admin/pull/17376",
    "https://github.com/acme/acme-admin/pull/17344",
  ],
  context: "work",
  id: "steer-iso-rosa-drafts",
  opened: undefined,
  postedBy: "every-open-hand-step-and-board-ask-is",
  postedIso: "2026-09-26T02:25:19.596Z",
  unaddressed: undefined,
  unblocks: "the ISO change management item (III-204) and closing #17344",
  url: "http://localhost:3000/queue?open=ask%3Aiso-compliance-violations-bigtask&context=work",
  what: "Read the two replies to Rosa drafted as you on #17680 and #17376, and say whether to post them and close #17344",
  where: "the queue page; the reply text is attached in your bot DM",
  witness: "slopweaver hand done steer-iso-rosa-drafts --did 'yes, hold, or what to change'",
};

/** The reply as the owner that the ISO ask offers. */
const REPLY = {
  actor: "me",
  body: "<@U0SYN000002> this walks one real change end to end with screenshots. happy for me to upload it?",
  destinations: [
    {
      channel: "C0SYN000001",
      kind: "thread",
      label: "Your change management thread, #proj-launch-room",
      permalink: "https://acme.slack.com/archives/C0SYN000001/p1790054263189439",
      threadTs: "1790054263.189439",
      tradeoff: "under your name, tags Rosa, who is already CC on it",
    },
  ],
  mentions: [{ label: "Rosa Lindqvist", userId: "U0SYN000002" }],
  version: 1,
};

/** The ask the step opens: parked on the owner, offering the reply, shaped. */
const ASK = {
  action: REPLY,
  kind: "ask",
  lean: "Post it, the PR already does what Rosa asked for",
  options: [
    { letter: "A", option: REPLY.destinations[0].label, tradeoff: REPLY.destinations[0].tradeoff },
    {
      letter: "B",
      option: "Hold it — send nothing for now",
      tradeoff: "the thread moves on without our answer, and the draft goes stale",
    },
  ],
  ownerWait: "owner",
  prUrls: [],
  priority: "p1",
  problem: "Change management is drafted but not uploaded until Rosa is happy with it",
  question: "Can I post this one reply as you in the ISO change management thread?",
  reason: "waiting on the owner",
  repo: "/Users/someone/dev/slopweaver",
  section: "WAITING ON YOU",
  slug: "iso-compliance-violations-bigtask",
  status: "ready",
};

type HandRecord = Extract<QueueRow["record"], { kind: "hand" }>;

function handRow({
  asks = [ASK],
  steps = [STEP],
  board,
}: {
  asks?: readonly unknown[];
  steps?: readonly unknown[];
  board?: LiveState<Board>;
}): QueueRow {
  let boardState: LiveState<Board> = ready({ value: readBoard({ rows: asks, unresolved: 0 })! });
  if (board !== undefined) {
    boardState = board;
  }
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: boardState,
    drafts: LOADING,
    hands: ready({ value: readHandSteps(steps)! }),
    landing: LOADING,
    placer: ACME_PLACER,
    posts: ready({ value: readParkedDrafts({ items: [], people: [] })! }),
    reviews: LOADING,
    imports: LOADING,
  });
  return rows.find((one) => one.kind === "hand")!;
}

function handRecord(input: {
  asks?: readonly unknown[];
  steps?: readonly unknown[];
  board?: LiveState<Board>;
}): HandRecord {
  const row = handRow(input);
  expect(row.record.kind).toBe("hand");
  return row.record as HandRecord;
}

/** A retained board reading, handed over on mount while the read replacing it is in flight. */
function retained({ asks }: { asks: readonly unknown[] }): LiveState<Board> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-27T06:00:00.000Z",
    phase: "ready",
    refreshing: true,
    stampedByRoute: false,
    value: readBoard({ rows: asks, unresolved: 0 })!,
  };
}

describe("a hand step asking the owner to react to a message drafted as the owner", () => {
  it("names the phrase the console's criterion reads off the step", () => {
    expect(draftAsOwnerPhrase({ texts: [STEP.what, STEP.where] })).toBe("drafted as you");
  });

  it("carries the reply the ask it opens offers, and draws the card", () => {
    const record = handRecord({});
    expect(record.offered!.slug).toBe("iso-compliance-violations-bigtask");
    expect(record.offered!.action.kind).toBe("action");
    const read = record.offered!.action as { kind: "action"; action: { body: string; actor: string } };
    expect(read.action.body).toBe(REPLY.body);
    expect(read.action.actor).toBe("me");
    expect(record.form).toEqual({ kind: "drawn" });
  });

  it("carries the reply off an ask that is not shaped as a decision — the raw join, not the decision's", () => {
    const record = handRecord({ asks: [{ ...ASK, lean: undefined, options: [], problem: undefined }] });
    expect(record.decision).toBe(undefined);
    expect(record.offered!.action.kind).toBe("action");
    expect(record.form).toEqual({ kind: "drawn" });
  });

  it("refuses the card when the ask it opens offers no message", () => {
    const { action: _dropped, ...bare } = ASK;
    const record = handRecord({ asks: [bare] });
    expect(record.offered!.action.kind).toBe("none");
    expect(record.form.kind).toBe("refused");
    expect((record.form as { why: string }).why).toBe(
      'This step asks you to react to a message "drafted as you", and carries no message to show you: it names no ' +
        "parked draft and opens no ask offering one. That is a defect in whatever posted it, not a card without a draft.",
    );
  });

  it("refuses the card when the ask's message body is blank, rather than drawing an empty quote", () => {
    const record = handRecord({ asks: [{ ...ASK, action: { ...REPLY, body: "" } }] });
    expect(record.offered!.action.kind).toBe("invalid");
    expect(record.form.kind).toBe("refused");
  });

  it("refuses the card when the board holds no such ask", () => {
    const record = handRecord({ asks: [] });
    expect(record.offered).toBe(undefined);
    expect(record.form.kind).toBe("refused");
  });

  it("still carries the reply an opened ask offers when the step's own words name no draft", () => {
    const record = handRecord({ steps: [{ ...STEP, what: "Say whether to close #17344", where: undefined }] });
    expect(record.offered!.action.kind).toBe("action");
    expect(record.form).toEqual({ kind: "drawn" });
  });

  // The hands can arrive before the board, and the card must not say the draft is missing — a defect — for the
  // seconds the board takes, then draw it.
  it("draws the card, saying the ask is being read, while the board is still arriving", () => {
    const record = handRecord({ board: LOADING });
    expect(record.offered).toBe(undefined);
    expect(record.form).toEqual({ kind: "drawn" });
    expect(record.askPending).toEqual({ phase: "reading" });
  });

  it("says the board did not read, never that the draft is missing, when the board fails", () => {
    const record = handRecord({ board: { phase: "not-measured", why: "handover list timed out" } });
    expect(record.form).toEqual({ kind: "drawn" });
    expect(record.askPending).toEqual({
      phase: "not-measured",
      why: "the board did not read: handover list timed out",
    });
  });

  it("answers the step's own ask link while the board is still arriving", () => {
    expect(handRow({ board: LOADING }).aliases).toEqual(["ask:iso-compliance-violations-bigtask"]);
  });

  // A retained reading is `ready`, and one predating the ask must not tell the owner the draft is missing.
  it("says the ask is being read over a retained board that predates it, and answers its link", () => {
    const row = handRow({ board: retained({ asks: [] }) });
    const record = row.record as HandRecord;
    expect(record.form).toEqual({ kind: "drawn" });
    expect(record.askPending).toEqual({ phase: "reading" });
    expect(row.aliases).toEqual(["ask:iso-compliance-violations-bigtask"]);
  });

  // A settled ask in the retained reading offers nothing and stands no ask row.
  it("answers its link over a retained board holding the ask settled and bare, where no ask row stands", () => {
    const { action: _dropped, ...bare } = ASK;
    const row = handRow({ board: retained({ asks: [{ ...bare, ownerWait: "settled" }] }) });
    expect((row.record as HandRecord).form).toEqual({ kind: "drawn" });
    expect(row.aliases).toEqual(["ask:iso-compliance-violations-bigtask"]);
  });

  it("leaves the link to the ask row when the retained reading stands one up", () => {
    const { action: _dropped, lean: _lean, options: _options, problem: _problem, ...bare } = ASK;
    expect(handRow({ board: retained({ asks: [bare] }) }).aliases).toEqual([]);
  });

  // The panel draws the pending line over an invalid offer, so the row must mark it pending.
  it("marks the card pending over a retained reading whose offer does not read", () => {
    const record = handRecord({ board: retained({ asks: [{ ...ASK, action: { ...REPLY, body: "" } }] }) });
    expect(record.offered!.action.kind).toBe("invalid");
    expect(record.askPending).toEqual({ phase: "reading" });
    expect(record.form).toEqual({ kind: "drawn" });
  });

  // A joined decision step and a later pending step must not both answer the one link.
  it("lets exactly one row answer the ask link when a decision step joins it first", () => {
    const { action: _dropped, ...bare } = ASK;
    const rows = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: LOADING,
      board: retained({ asks: [{ ...bare, ownerWait: "settled" }] }),
      drafts: LOADING,
      hands: ready({ value: readHandSteps([STEP, { ...STEP, id: "second-step" }])! }),
      landing: LOADING,
      placer: ACME_PLACER,
      posts: ready({ value: readParkedDrafts({ items: [], people: [] })! }),
      reviews: LOADING,
      imports: LOADING,
    });
    const answering = rows.filter((row) => row.aliases?.includes("ask:iso-compliance-violations-bigtask"));
    expect(answering.map((row) => row.id)).toEqual(["steer-iso-rosa-drafts"]);
  });

  // Two rows sharing the slug, the bare one first — the card draws the one carrying the reply.
  it("draws the reply off the row carrying it when two rows share the ask's slug", () => {
    const { action: _dropped, ...bare } = ASK;
    const record = handRecord({ board: retained({ asks: [bare, ASK] }) });
    expect(record.offered!.action.kind).toBe("action");
    expect(record.askPending).toBe(undefined);
  });

  it("draws the reply off a retained board that already carries it, with nothing pending", () => {
    const record = handRecord({ board: retained({ asks: [ASK] }) });
    expect(record.askPending).toBe(undefined);
    expect(record.offered!.action.kind).toBe("action");
    expect(record.form).toEqual({ kind: "drawn" });
  });

  it("says nothing pending once the board is read", () => {
    const record = handRecord({});
    expect(record.askPending).toBe(undefined);
    expect(record.boardStale).toBe(false);
  });

  // The board is one read while hands poll every 20s, so a step posted with the queue
  // open met a board read before it, and was refused for as long as the page stayed open.
  it("says the board predates a step posted after it was read, asks for a re-read, and answers its link", () => {
    const row = handRow({ asks: [], steps: [{ ...STEP, postedIso: "2026-09-27T07:00:00.000Z" }] });
    const record = row.record as HandRecord;
    expect(record.form).toEqual({ kind: "drawn" });
    expect(record.boardStale).toBe(true);
    expect(record.askPending).toEqual({ phase: "reading" });
    expect(row.aliases).toEqual(["ask:iso-compliance-violations-bigtask"]);
  });

  it("draws the reply off a board read before the step when it already carries it, with no re-read", () => {
    const record = handRecord({ steps: [{ ...STEP, postedIso: "2026-09-27T07:00:00.000Z" }] });
    expect(record.boardStale).toBe(false);
    expect(record.askPending).toBe(undefined);
    expect(record.offered!.action.kind).toBe("action");
  });

  it("refuses the card when a board read after the step holds no such ask", () => {
    const record = handRecord({ asks: [] });
    expect(record.boardStale).toBe(false);
    expect(record.form.kind).toBe("refused");
  });

  // The scan is not atomic and the board is stamped when it ends, so a board stamped after
  // the step can still have missed an ask written mid-scan; only when the scan began bounds what it saw.
  it("reads the board again when its scan began before the step, though it was stamped after", () => {
    const board = ready({ value: readBoard({ rows: [], scanStartedIso: "2026-09-26T02:25:00.000Z", unresolved: 0 })! });
    const record = handRecord({ board });
    expect(record.boardStale).toBe(true);
    expect(record.form).toEqual({ kind: "drawn" });
  });

  it("refuses the card when a board whose scan began after the step holds no such ask", () => {
    const board = ready({ value: readBoard({ rows: [], scanStartedIso: "2026-09-26T02:26:00.000Z", unresolved: 0 })! });
    const record = handRecord({ board });
    expect(record.boardStale).toBe(false);
    expect(record.form.kind).toBe("refused");
  });

  it("refuses a board whose scan start is present and will not read, rather than reading it as absent", () => {
    expect(readBoard({ rows: [], scanStartedIso: 1790000000, unresolved: 0 })).toBe(undefined);
    expect(readBoard({ rows: [], scanStartedIso: undefined, unresolved: 0 })).toBe(undefined);
  });

  // V8 rolls the thirtieth of February over to the second of March rather than refusing it.
  it("reads the board again when its scan start is a date that does not exist", () => {
    const board = ready({ value: readBoard({ rows: [], scanStartedIso: "2026-09-31T00:00:00.000Z", unresolved: 0 })! });
    expect(handRecord({ board }).boardStale).toBe(true);
  });

  it("reads the board again when its scan began in the same millisecond the step was posted", () => {
    const board = ready({ value: readBoard({ rows: [], scanStartedIso: STEP.postedIso, unresolved: 0 })! });
    expect(handRecord({ board }).boardStale).toBe(true);
  });

  it("reads the board again, never refusing, when the step's posted instant will not parse", () => {
    const record = handRecord({ asks: [], steps: [{ ...STEP, postedIso: "yesterday" }] });
    expect(record.boardStale).toBe(true);
    expect(record.form).toEqual({ kind: "drawn" });
  });

  it("says the ask's file did not read, never that the draft is missing, when the scan could not read it", () => {
    const board = ready({
      value: readBoard({ rows: [], unreadable: ["iso-compliance-violations-bigtask.md"], unresolved: 0 })!,
    });
    const record = handRecord({ board });
    expect(record.form).toEqual({ kind: "drawn" });
    expect(record.boardStale).toBe(false);
    expect(record.askPending).toEqual({
      phase: "not-measured",
      why: "the board could not read iso-compliance-violations-bigtask.md, and the message may be in one",
    });
  });

  // A doc may declare a slug its filename does not carry, so any unreadable file could be the ask.
  it("keeps the card pending when any file the scan could not read might hold the ask", () => {
    const board = ready({ value: readBoard({ rows: [], unreadable: ["renamed.md"], unresolved: 0 })! });
    const record = handRecord({ board });
    expect(record.form).toEqual({ kind: "drawn" });
    expect(record.askPending).toEqual({
      phase: "not-measured",
      why: "the board could not read renamed.md, and the message may be in one",
    });
  });

  it("draws the reply when the ask read, whatever else the scan could not read", () => {
    const board = ready({ value: readBoard({ rows: [ASK], unreadable: ["renamed.md"], unresolved: 0 })! });
    const record = handRecord({ board });
    expect(record.askPending).toBe(undefined);
    expect(record.offered!.action.kind).toBe("action");
  });

  it("marks a retained reading pending without asking for a second re-read", () => {
    const record = handRecord({
      board: retained({ asks: [] }),
      steps: [{ ...STEP, postedIso: "2026-09-27T07:00:00.000Z" }],
    });
    expect(record.boardStale).toBe(false);
    expect(record.askPending).toEqual({ phase: "reading" });
  });

  it("refuses a step naming a draft as the owner that opens no ask, whether or not the board is read", () => {
    const { url: _dropped, ...bare } = STEP;
    const record = handRecord({ board: LOADING, steps: [bare] });
    expect(record.askPending).toBe(undefined);
    expect(record.form.kind).toBe("refused");
  });

  it("leaves a step that names no draft as the owner drawn, whatever it opens", () => {
    const record = handRecord({
      asks: [],
      steps: [{ ...STEP, what: "Say whether to close #17344", where: undefined }],
    });
    expect(record.form).toEqual({ kind: "drawn" });
  });
});
