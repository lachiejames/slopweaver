/*
 * An unsteered act from `autonomy list --json` through to the links its queue card draws: `readAutonomy`
 * keeps `run` and `witness`, `readBoard` publishes the finding's pull request, and `rowsOf` joins them. A
 * finding act names only its board slug (the gate records it before the pull request exists), so the link
 * lives in this wiring or nowhere.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../../components/live/read";
import { ACT_BOARD_SUBJECT, ACT_LANDING_SUBJECT } from "../../../lib/queueCardActLinks";
import { reviewLineFor } from "../../../lib/queueReviewLine";
import { actRows, acts, board, formOf, LOADING, landing, PENDING, PR, PR_OPEN, ready, SLUG } from "./harness";

describe("an unsteered act's links, from the two published documents to the queue row", () => {
  it("keeps the ledger's run and witness on the read row", () => {
    const [row] = acts();
    expect([row.run, row.witness]).toEqual([SLUG, "open a pull request on main: finding gate"]);
  });

  it("links the finding to the pull request a settled board row names, and to no workstreams page", () => {
    const [row] = actRows({ boardState: ready({ value: board() }) });
    expect(row.record).toEqual({
      act: acts()[0],
      earlier: [],
      kind: "act",
      links: {
        boardNotice: undefined,
        kind: "linked",
        landingNotice: { read: { phase: "loading" }, subject: ACT_LANDING_SUBJECT },
        links: [{ label: "lachiejames/slopweaver#6", url: PR }],
      },
      form: PENDING,
      lookupBranch: SLUG,
      subjects: [SLUG],
    });
  });

  it("links the open pull request on the finding's branch, and leaves naming it to the lookup", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: landing() }) });
    // The owner's landing reading holds only open, undrafted pull requests, so one match there is not the only one.
    expect(row.card.question).toBe(`Was open internal finding pull request on ${SLUG} the right call?`);
    expect(row.record).toEqual({
      act: acts()[0],
      earlier: [],
      kind: "act",
      links: {
        boardNotice: { read: { phase: "loading" }, subject: ACT_BOARD_SUBJECT },
        kind: "linked",
        landingNotice: undefined,
        links: [{ label: "lachiejames/slopweaver#7", url: PR_OPEN }],
      },
      form: PENDING,
      lookupBranch: SLUG,
      subjects: [SLUG],
    });
  });

  it("opens the finding's board row on its own queue card when the queue holds one", () => {
    const read = readBoard({
      rows: [
        {
          kind: "ask",
          ownerWait: "owner",
          prUrls: [],
          question: "Keep the browser door shut for Codex seats?",
          reason: "asked",
          section: "WAITING ON YOU",
          slug: SLUG,
          status: "ready",
        },
      ],
      unresolved: 0,
    });
    if (read === undefined) {
      throw new Error("the fixture board did not read");
    }
    const [row] = actRows({ boardState: ready({ value: read }), landingState: ready({ value: landing() }) });
    expect(row.record).toEqual({
      act: acts()[0],
      earlier: [],
      kind: "act",
      links: {
        boardNotice: undefined,
        kind: "linked",
        landingNotice: undefined,
        links: [
          { label: "lachiejames/slopweaver#7", url: PR_OPEN },
          { label: "its card on the queue", url: `/queue?open=ask%3A${SLUG}` },
        ],
      },
      form: PENDING,
      lookupBranch: SLUG,
      subjects: [SLUG],
    });
  });

  it("still lists the act while the board is loading, and says why it has no link yet", () => {
    const rows = actRows({ boardState: LOADING });
    expect(rows.map((row) => row.record)).toEqual([
      {
        act: acts()[0],
        earlier: [],
        kind: "act",
        links: {
          boardNotice: { read: { phase: "loading" }, subject: ACT_BOARD_SUBJECT },
          kind: "none",
          landingNotice: { read: { phase: "loading" }, subject: ACT_LANDING_SUBJECT },
        },
        form: PENDING,
        lookupBranch: SLUG,
        subjects: [SLUG],
      },
    ]);
  });
});

describe("an act's card before it is opened", () => {
  it("is refused while a finding act's pull request is unread", () => {
    const rows = actRows({ boardState: LOADING });
    expect(rows.map((row) => formOf({ row }))).toEqual([PENDING]);
  });

  it("gives an act no review-before-sending line: acting on it sends nothing", () => {
    const [row] = actRows({ boardState: LOADING });
    expect(reviewLineFor({ row })).toBe(undefined);
  });
});
