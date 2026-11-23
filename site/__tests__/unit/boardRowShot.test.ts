/*
 * An ask's boxed picture, read off the document `slopweaver handover list --json` publishes (an image on an ask shows on the
 * queue card). Driven through `readBoard`, so a reader that stops
 * carrying `shot` fails here, and a picture that will not read is SAID rather than drawn as an ask with none.
 */

import { describe, expect, it } from "vitest";

import { type BoardRow, readBoard } from "../../components/live/read";
import { shotOverlay } from "../../lib/handShot";

const SHOT = {
  boxes: [{ height: 40, label: "empty on every trace", width: 300, x: 120, y: 80 }],
  height: 900,
  sha256: "c".repeat(64),
  width: 1440,
};

/** The one published ask waiting on the owner's word, with `over` laid on top. */
function askRow({ over }: { over: Record<string, unknown> }): BoardRow {
  const board = readBoard({
    rows: [
      {
        kind: "ask",
        ownerWait: "owner",
        question: "Is running OpenTelemetry beside dd-trace worth a second agent?",
        reason: "waiting on the owner",
        section: "runnable",
        slug: "is-running-opentelemetry-for-traces-beside-dd-trace",
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

describe("a board row's shot", () => {
  it("reads a whole picture with its boxes, and the overlay serves it from the shot store", () => {
    const row = askRow({ over: { shot: SHOT } });
    expect([row.shot, row.shotUnreadable]).toEqual([SHOT, false]);
    expect(shotOverlay({ shot: row.shot! }).src).toBe(`/api/hand-shot/${"c".repeat(64)}`);
  });

  it("reads a row with no picture as one with none", () => {
    const row = askRow({ over: {} });
    expect([row.shot, row.shotUnreadable]).toEqual([undefined, false]);
  });

  it("marks a picture whose box runs past it unreadable, and keeps the row and the board", () => {
    const row = askRow({ over: { shot: { ...SHOT, boxes: [{ ...SHOT.boxes[0], width: 1500 }] } } });
    expect([row.shot, row.shotUnreadable, row.slug]).toEqual([
      undefined,
      true,
      "is-running-opentelemetry-for-traces-beside-dd-trace",
    ]);
  });
});
