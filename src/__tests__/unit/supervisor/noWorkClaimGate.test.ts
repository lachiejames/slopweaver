import { describe, expect, it } from "vitest";

import { type HeldWork, heldWorkOf } from "../../../supervisor/heldWork.js";
import { judgeNoWorkClaim, noWorkClaimsIn } from "../../../supervisor/noWorkClaimGate.js";

/** A board holding 3 open rows: 1 ready, 2 held only for naming no repo:. */
const OPEN_BOARD = {
  held: [
    { id: "land-acme-1", standing: "blocked" },
    { id: "land-acme-2", standing: "blocked" },
  ],
  rankedCount: 3,
  ready: [{ id: "fix-acme-3" }],
  repolessRows: ["land-acme-1", "land-acme-2"],
  trunkMovedRows: [],
};

const EMPTY_BOARD = { held: [], rankedCount: 0, ready: [], repolessRows: [], trunkMovedRows: [] };

describe("noWorkClaimsIn", () => {
  it.each([
    ["there is nothing to seat", ["nothing to seat"]],
    ["The board has no runnable row.", ["The board has no runnable row"]],
    ["Capacity was unused because the queue was empty", ["the queue was empty"]],
    ["the board is clear", ["the board is clear"]],
    ["the work queue sat empty", ["the work queue sat empty"]],
    ["No fleet seat live because nothing is seatable", ["nothing is seatable"]],
    ["every seat is closed since there's no work queued", ["there's no work"]],
    ["Fleet idle. No work left.", ["No work left"]],
    ["Nothing runnable — all held", ["Nothing runnable"]],
    ["No ready rows; every one is held", ["No ready rows"]],
    ["There’s nothing left to do for now.", ["There’s nothing left to do"]],
    ["we have nothing to do.", ["we have nothing to do"]],
    ["nothing can be seated this pass", ["nothing can be seated"]],
    ["there are no rows to seat", ["no rows to seat"]],
    ["there are no ready items", ["there are no ready items"]],
    ["the board has no ready asks", ["the board has no ready asks"]],
    ["WE HAVE NO MORE WORK", ["WE HAVE NO MORE WORK"]],
  ])("finds the claim in %j", (text, words) => {
    expect(noWorkClaimsIn({ text })).toEqual(words);
  });

  it.each([
    // A counterexample: true of one pull request, not of the board.
    "Pull request #42 needs no more work; it is ready to merge.",
    // A counterexample: a recipe's items, not the board's.
    "The nightly-cleanup recipe has no runnable items; its only step already completed.",
    // A counterexample: a recipe's rows, not the board's.
    "The nightly-cleanup recipe has no runnable rows; its only row already completed.",
    "the recipe has no items to run",
    "#42 has no work left to do",
    "in that recipe nothing is runnable yet",
    "The CI queue was empty when it retried.",
    "there is nothing to do on #42 until CI reruns",
    "#42 has no open work items left in review",
    "nothing of theirs left to land",
    "that has nothing to do with capacity",
    "there is nothing to do with that alert",
    "no work was completed on that branch",
    "no work has been lost",
    "The merge queue is clear.",
    "the merge queue was empty all morning",
    "their Queue is clear",
    "their Queue is empty",
    "two ready rows, both held on the owner's answer; 84 more held only for naming no repo:",
    "",
  ])("finds nothing in %j", (text) => {
    expect(noWorkClaimsIn({ text })).toEqual([]);
  });
});

describe("judgeNoWorkClaim", () => {
  const claim = [{ label: "lede", text: "there is nothing to seat" }];

  it("refuses a claim over a board holding open rows, carrying the reading", () => {
    const verdict = judgeNoWorkClaim({ reconciliation: OPEN_BOARD, texts: claim });
    const held = heldWorkOf({ reconciliation: OPEN_BOARD }) as { kind: "read"; value: HeldWork };

    expect(verdict).toEqual({
      claims: [{ label: "lede", words: "nothing to seat" }],
      held: held.value,
      kind: "refused",
    });
  });

  it("refuses even when every open row waits on the owner — that is work waiting on the owner, not no work", () => {
    const board = {
      ...OPEN_BOARD,
      held: [{ standing: "waiting-on-owner" }],
      ready: [],
      repolessRows: [],
      rankedCount: 1,
    };

    expect(judgeNoWorkClaim({ reconciliation: board, texts: claim }).kind).toBe("refused");
  });

  it("passes a claim over a board with no open row", () => {
    expect(judgeNoWorkClaim({ reconciliation: EMPTY_BOARD, texts: claim })).toEqual({ kind: "clean" });
  });

  it("is unreadable when a claim rests on a reading that will not decode", () => {
    expect(judgeNoWorkClaim({ reconciliation: { rankedCount: 5 }, texts: claim })).toEqual({
      claims: [{ label: "lede", words: "nothing to seat" }],
      kind: "unreadable",
      why: "the reconciliation is missing one of `ready`, `held`, `repolessRows` or `trunkMovedRows`",
    });
  });

  it("never reads the reconciliation when no text claims anything", () => {
    expect(
      judgeNoWorkClaim({ reconciliation: "not even an object", texts: [{ label: "lede", text: "1 ready, 2 held" }] }),
    ).toEqual({ kind: "clean" });
  });
});
