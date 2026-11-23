/*
 * What a card's freshness mark says confirmed an ask, read from the document `slopweaver handover list --json`
 * publishes. A `handover reconfirm` on an ask with no stakes publishes `stillReal` and `stillRealIso` and
 * nothing else — so unless the mark carries the check line, a vague reconfirm is invisible where the owner reads it.
 *
 * Driven through `readBoard` rather than a hand-built `BoardRow`, so a reader that stops carrying `stillReal`
 * fails here too.
 */

import { describe, expect, it } from "vitest";

import { type BoardRow, readBoard } from "../../components/live/read";
import { askVerified } from "../../lib/askVerified";

const ASKED = "2026-09-01T11:00:00.000Z";

/** The one published ask waiting on the owner's word, with `over` laid on top. */
function askRow({ over }: { over: Record<string, unknown> }): BoardRow {
  const board = readBoard({
    rows: [
      {
        kind: "ask",
        ownerWait: "owner",
        priority: "p1",
        question: "Do you want the atlas to read JumpCloud?",
        questionAskedIso: ASKED,
        reason: "waiting on the owner",
        section: "runnable",
        slug: "atlas-jumpcloud",
        status: "waiting-on-owner",
        ...over,
      },
    ],
    unresolved: 0,
  });
  if (board === undefined) {
    throw new Error("the fixture board did not read");
  }
  const [row] = board.rows;
  if (row === undefined) {
    throw new Error("the fixture board carried no row");
  }
  return row;
}

describe("askVerified", () => {
  it("says an ask no check has confirmed was never re-confirmed", () => {
    expect(askVerified({ row: askRow({ over: {} }) })).toEqual({
      currencyFloorIso: ASKED,
      landingFloorIso: ASKED,
      verifiedBy: "never re-confirmed since it was asked",
      verifiedIso: undefined,
    });
  });

  it("prints a reconfirm's check line beside the instant it ran", () => {
    const row = askRow({
      over: { stillReal: "no jumpcloud source in slopweaver atlas list", stillRealIso: "2026-09-24T02:00:00.000Z" },
    });
    expect(askVerified({ row })).toEqual({
      currencyFloorIso: "2026-09-24T02:00:00.000Z",
      landingFloorIso: ASKED,
      verifiedBy: "its still-real check: no jumpcloud source in slopweaver atlas list",
      verifiedIso: "2026-09-24T02:00:00.000Z",
    });
  });

  it("names the check without a line when only the instant was published", () => {
    expect(askVerified({ row: askRow({ over: { stillRealIso: "2026-09-24T02:00:00.000Z" } }) })).toEqual({
      currencyFloorIso: "2026-09-24T02:00:00.000Z",
      landingFloorIso: ASKED,
      verifiedBy: "its still-real check",
      verifiedIso: "2026-09-24T02:00:00.000Z",
    });
  });

  it("carries no landing floor when the board dates no asking, so every landing holds the card", () => {
    const row = askRow({ over: { questionAskedIso: undefined } });
    expect(row.questionAskedIso).toBe(undefined);
    expect(askVerified({ row })).toEqual({
      verifiedBy: "never re-confirmed since it was asked",
      verifiedIso: undefined,
    });
  });
});
