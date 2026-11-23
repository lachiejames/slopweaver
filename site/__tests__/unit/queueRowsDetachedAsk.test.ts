/*
 * A run waiting on the owner's word whose doc left the board (row `acme-waiting-run-with-archived-doc`): `handover
 * list --json` publishes it under `detachedAsks`, and the Queue — the one page the owner reads — draws it as an ask card.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import { cardAddresses } from "../../lib/cardAddresses";
import { DETACHED_ASK_KIND, type QueueAskBoardRow } from "../../lib/detachedAskRow";
import { cardLinksOf } from "../../lib/openCard";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-10T02:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

const GONE = {
  askedIso: "2026-10-08T01:00:00.000Z",
  doc: { kind: "missing" },
  journal: "/home/runs/gone-run.jsonl",
  question: "Ship the gone thing?",
  slug: "gone-run",
};

const BROKEN = {
  askedIso: "2026-10-09T01:00:00.000Z",
  doc: { kind: "unreadable", why: "front matter will not parse" },
  journal: "/home/runs/broken-run.jsonl",
  question: "Ship the broken thing?",
  slug: "broken-run",
};

/** A live board row waiting on the owner, asked between the two detached asks. */
const LIVE = {
  kind: "ask",
  ownerWait: "owner",
  question: "Ship the live thing?",
  questionAskedIso: "2026-10-08T12:00:00.000Z",
  reason: "declared ready",
  section: "WAITING ON OWNER",
  slug: "live-run",
  status: "ready",
  summary: "the live thing",
};

function rowsFor({ payload }: { payload: Record<string, unknown> }): readonly QueueRow[] {
  return rowsOf({
    acts: LOADING,
    board: ready({ value: readBoard(payload)! }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    reviews: LOADING,
    imports: LOADING,
    standing: LOADING,
  });
}

describe("readBoard's detachedAsks", () => {
  it("reads an absent field as none, since a CLI older than the field publishes none", () => {
    expect(readBoard({ rows: [], unresolved: 0 })!.detachedAsks).toEqual([]);
  });

  it("reads both doc states exactly", () => {
    expect(readBoard({ detachedAsks: [GONE, BROKEN], rows: [], unresolved: 0 })!.detachedAsks).toEqual([GONE, BROKEN]);
  });

  it("refuses the whole board on a non-list, a member missing a field, or an unknown doc kind", () => {
    const { question: _question, ...noQuestion } = GONE;
    expect(readBoard({ detachedAsks: "x", rows: [], unresolved: 0 })).toBe(undefined);
    expect(readBoard({ detachedAsks: [GONE, noQuestion], rows: [], unresolved: 0 })).toBe(undefined);
    expect(readBoard({ detachedAsks: [{ ...GONE, doc: { kind: "lost" } }], rows: [], unresolved: 0 })).toBe(undefined);
    expect(readBoard({ detachedAsks: [{ ...BROKEN, doc: { kind: "unreadable" } }], rows: [], unresolved: 0 })).toBe(
      undefined,
    );
  });
});

describe("the Queue draws a detached ask", () => {
  it("as an ask card keyed by its slug, carrying its question and a drawn form", () => {
    const row = rowsFor({ payload: { detachedAsks: [GONE], rows: [], unresolved: 0 } }).find(
      (candidate) => candidate.key === "ask:gone-run",
    )!;
    expect([row.kind, row.whenIso, row.record.kind]).toEqual(["ask", GONE.askedIso, "ask"]);
    expect(row.card.question).toBe("Ship the gone thing?");
    expect(row.record.form).toEqual({ kind: "drawn" });
  });

  it("matching its remedy to what is known: restore-or-end for a gone doc, repair for an unreadable one", () => {
    const rows = rowsFor({ payload: { detachedAsks: [GONE, BROKEN], rows: [], unresolved: 0 } });
    const boardRowOf = ({ key }: { key: string }): QueueAskBoardRow =>
      (rows.find((row) => row.key === key)!.record as Extract<QueueRow["record"], { kind: "ask" }>).row;
    const gone = boardRowOf({ key: "ask:gone-run" });
    const broken = boardRowOf({ key: "ask:broken-run" });
    expect([gone.kind, gone.status, gone.ownerWait]).toEqual([DETACHED_ASK_KIND, "doc-missing", "owner"]);
    expect([gone.reason, gone.reasonWhy]).toEqual([
      "its doc is gone from the board and the archive, so the run can be restored or ended",
      undefined,
    ]);
    expect(broken.status).toBe("doc-unreadable");
    // The read's own reason stays out of the console's sentence, kept beside it for the card's fold.
    expect([broken.reason, broken.reasonWhy]).toEqual([
      "its doc would not read, so it needs repairing before anything else",
      "front matter will not parse",
    ]);
  });

  it("still finds a thread the read's reason names, now that the reason sits beside the sentence", () => {
    const thread = "https://acme.slack.com/archives/C0SYN000001/p1700000000000000";
    const linked = { ...BROKEN, doc: { kind: "unreadable", why: `the doc points at ${thread}` } };
    const row = rowsFor({ payload: { detachedAsks: [linked], rows: [], unresolved: 0 } }).find(
      (candidate) => candidate.key === "ask:broken-run",
    )!;
    expect(row.threadUrl).toBe(thread);
  });

  it("still resolves a number off a pull request the read's reason names, so the question's number links", () => {
    const pull = "https://github.com/acme/widgets/pull/42";
    const linked = {
      ...BROKEN,
      doc: { kind: "unreadable", why: `parse failed reading ${pull}` },
      question: "Ship #42?",
    };
    const row = rowsFor({ payload: { detachedAsks: [linked], rows: [], unresolved: 0 } }).find(
      (candidate) => candidate.key === "ask:broken-run",
    )!;
    expect(cardAddresses({ row })).toEqual([pull]);
  });

  it("still offers open_card a file the read's reason names, as it did when the reason sat in the what", () => {
    const why = "EACCES: permission denied, open '/home/handovers/broken-run.md'";
    const linked = { ...BROKEN, doc: { kind: "unreadable", why } };
    const row = rowsFor({ payload: { detachedAsks: [linked], rows: [], unresolved: 0 } }).find(
      (candidate) => candidate.key === "ask:broken-run",
    )!;
    expect(cardLinksOf({ row }).files).toEqual(["/home/handovers/broken-run.md"]);
  });

  it("sorted in among the board's own asks, oldest question first", () => {
    const rows = rowsFor({ payload: { detachedAsks: [BROKEN, GONE], rows: [LIVE], unresolved: 0 } });
    expect(rows.filter((row) => row.kind === "ask").map((row) => row.key)).toEqual([
      "ask:gone-run",
      "ask:live-run",
      "ask:broken-run",
    ]);
  });

  it("never twice, when a board row already carries its slug", () => {
    const rows = rowsFor({ payload: { detachedAsks: [{ ...GONE, slug: "live-run" }], rows: [LIVE], unresolved: 0 } });
    expect(rows.filter((row) => row.key === "ask:live-run").map((row) => row.whenIso)).toEqual([LIVE.questionAskedIso]);
  });
});
