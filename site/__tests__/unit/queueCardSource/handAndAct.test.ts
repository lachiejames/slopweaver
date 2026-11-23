/*
 * Where a hand step's and an act's queue card came from: each inherits the source of the board row it names, and says
 * so when that row is gone. Driven through the real readers, so every row is one the page would actually hold.
 */

import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../../components/live/read";
import { readAutonomy } from "../../../components/live/readAutonomy";
import type { ReadPullRequest } from "../../../lib/findingActCard";
import { withLookedUpPull } from "../../../lib/queueActRow";
import { actGroupSource, actSource, handSource } from "../../../lib/queueCardSource";
import { rowsOf } from "../../../lib/queueRows";
import { sourceBlockCopy } from "../../../lib/sourceBlock";
import { ACME_PLACER } from "../../organisationFixture";
import { ARCHIVED, ask, boardOf, CHAIR, LOADING, MISSING, QUOTE, ready, SUBJECT, TALK } from "./harness";

describe("a hand step's source", () => {
  const STEP = {
    id: "steer-the-ask",
    postedBy: "workspace:93",
    postedIso: "2026-09-28T06:20:00.000Z",
    url: "http://localhost:3000/queue?open=ask%3Athe-ask",
    what: "Pick which lands first",
    where: "the queue page",
    witness: "slopweaver hand done steer-the-ask --did 'picked'",
  };

  it("inherits the source of the ask it opens", () => {
    const [step] = readHandSteps([STEP])!;
    const rows = boardOf({ rows: [ask({ fields: { anchor: TALK, ownerWords: QUOTE } })] }).rows;
    expect(handSource({ rows, step: step })).toEqual({ kind: "words", quote: QUOTE, steers: [], subject: SUBJECT });
  });

  it("carries the ask's refusal into the hand card's form", () => {
    const rows = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: LOADING,
      board: ready({ value: boardOf({ rows: [ask({ fields: { anchor: TALK } })] }) }),
      drafts: LOADING,
      hands: ready({ value: readHandSteps([STEP])! }),
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    const hand = rows.find((row) => row.key === "hand:steer-the-ask")!;
    expect(hand.record.form).toEqual({ kind: "refused", why: MISSING });
  });

  it("waits on the board read, never a sentence, while the board has no reading", () => {
    const [step] = readHandSteps([STEP])!;
    expect(handSource({ rows: undefined, step: step })).toEqual({ kind: "board-pending", steers: [] });
  });

  it("names its poster when it opens no ask, never claiming the words behind it are not the owner's", () => {
    const [step] = readHandSteps([{ ...STEP, url: undefined }])!;
    expect(handSource({ rows: [], step: step })).toEqual({
      kind: "unrecorded",
      origin: "posted by workspace:93, opening no ask",
      steers: [],
    });
  });

  it("names a poster that is a session id by what it is, the id behind the hover", () => {
    const [step] = readHandSteps([{ ...STEP, postedBy: CHAIR, url: undefined }])!;
    expect(handSource({ rows: [], step: step })).toEqual({
      hover: `session ${CHAIR}`,
      kind: "unrecorded",
      origin: "posted by a Claude session, opening no ask",
      steers: [],
    });
  });

  it("draws a card the chair posted by its session id, the id on the source line's hover alone", () => {
    const rows = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: LOADING,
      board: ready({ value: boardOf({ rows: [] }) }),
      drafts: LOADING,
      hands: ready({
        value: readHandSteps([{ ...STEP, postedBy: CHAIR, url: "http://localhost:3000/view?src=%2Fapi%2Fpage%2Fx" }])!,
      }),
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    const hand = rows.find((row) => row.key === "hand:steer-the-ask")!;
    const copy = sourceBlockCopy({ source: hand.source });
    expect(hand.record.form).toEqual({ kind: "drawn" });
    expect(copy.line).toBe(
      "Nothing records whose words are behind this: posted by a Claude session, opening no ask. If it came from you, " +
        "a session finds your turn with `slopweaver profile words` and ties it here with " +
        "`slopweaver handover quote <slug> --anchor <anchor> --apply`.",
    );
    expect(copy.hover).toBe(`session ${CHAIR}`);
  });

  it("is not read when two live rows share the slug it opens", () => {
    const [step] = readHandSteps([STEP])!;
    const rows = boardOf({ rows: [ask({ fields: { anchor: TALK, ownerWords: QUOTE } }), ask({ fields: {} })] }).rows;
    expect(handSource({ rows, step: step })).toEqual({
      kind: "unread",
      steers: [],
      why: "the live board holds 2 rows by the name this card gives, so whose words are behind it is not read here",
    });
  });
});

describe("an act's source", () => {
  const ACT = {
    actionId: "finding-pr.the-ask",
    doneIso: "2026-09-28T06:30:00.000Z",
    kind: "open-internal-finding-pull-request",
    run: "the-ask",
    subject: "the-ask",
    why: "an unruled fleet finding",
  };

  it("inherits the source of the board row its run names", () => {
    const [act] = readAutonomy([{ action: ACT }])!;
    const rows = boardOf({ rows: [ask({ fields: { anchor: TALK, ownerWords: QUOTE } })] }).rows;
    expect(actSource({ act: act, rows })).toEqual({ kind: "words", quote: QUOTE, steers: [], subject: SUBJECT });
  });

  it("is not read, never fleet, when the row its run names is off the live board", () => {
    const [act] = readAutonomy([{ action: ACT }])!;
    expect(actSource({ act: act, rows: [] })).toEqual({ kind: "unread", steers: [], why: ARCHIVED });
  });

  it("never borrows a live row's words through its subject when its run is off the board", () => {
    const [act] = readAutonomy([{ action: { ...ACT, run: "archived-run", subject: "the-ask" } }])!;
    const rows = boardOf({ rows: [ask({ fields: { anchor: TALK, ownerWords: QUOTE } })] }).rows;
    expect(actSource({ act: act, rows })).toEqual({ kind: "unread", steers: [], why: ARCHIVED });
  });

  it("reads the row its subject names when it names no run, and not read once that row is off the board", () => {
    const [act] = readAutonomy([{ action: { ...ACT, run: undefined } }])!;
    const rows = boardOf({ rows: [ask({ fields: { anchor: TALK, ownerWords: QUOTE } })] }).rows;
    expect([actSource({ act: act, rows }), actSource({ act: act, rows: [] })]).toEqual([
      { kind: "words", quote: QUOTE, steers: [], subject: SUBJECT },
      { kind: "unread", steers: [], why: ARCHIVED },
    ]);
  });

  it("says nothing records whose words are behind an act naming no row, never that none are the owner's", () => {
    const [act] = readAutonomy([{ action: { ...ACT, run: undefined, subject: "https://example.com/x" } }])!;
    expect(actSource({ act: act, rows: [] })).toEqual({
      kind: "unrecorded",
      origin: "the fleet acted on https://example.com/x and names no board row (open-internal-finding-pull-request)",
      steers: [],
    });
  });

  it("reads a pattern's newest act when every act names one row, and never one row's words for several", () => {
    const [newest, older] = readAutonomy([
      { action: { ...ACT, actionId: "a.2", run: undefined, subject: "the-ask" } },
      { action: { ...ACT, actionId: "a.1", run: undefined, subject: "other-row" } },
    ])!;
    const rows = boardOf({
      rows: [ask({ fields: { anchor: TALK, ownerWords: QUOTE } }), ask({ fields: { slug: "other-row" } })],
    }).rows;
    expect([
      actGroupSource({ act: newest, earlier: [], rows }),
      actGroupSource({ act: newest, earlier: [older], rows }),
    ]).toEqual([
      { kind: "words", quote: QUOTE, steers: [], subject: SUBJECT },
      {
        kind: "unrecorded",
        origin: "2 open-internal-finding-pull-request acts of one pattern, naming 2 rows or subjects",
        steers: [],
      },
    ]);
  });

  it("keeps the source's refusal once the lookup rebuilds the form", () => {
    const pull: ReadPullRequest = {
      boardRowSlug: undefined,
      form: { blastRadius: "One card.", kind: "parsed", problem: "A card lost the owner's words.", risk: "Low." },
      headRefName: "the-ask",
      mergedAt: "2026-09-28T07:00:00Z",
      number: 3,
      readAtIso: "2026-09-28T07:00:00.000Z",
      repoSlug: "lachiejames/slopweaver",
      state: "merged",
      title: "The owner's words lead the card",
      url: `https://github.com/lachiejames/slopweaver/pull/${String(3)}`,
    };
    const rows = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: ready({ value: readAutonomy([{ action: ACT }])! }),
      board: ready({
        value: boardOf({ rows: [ask({ fields: { anchor: TALK, ownerWait: "settled", section: "DONE" } })] }),
      }),
      drafts: LOADING,
      hands: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    const row = rows.find((one) => one.kind === "act")!;
    const drawn = withLookedUpPull({ lookup: { branch: "the-ask", phase: "ready", pulls: [pull], unchecked: 0 }, row });
    expect([row.record.form, drawn.record.form]).toEqual([
      { kind: "refused", why: MISSING },
      { kind: "refused", why: MISSING },
    ]);
  });
});
