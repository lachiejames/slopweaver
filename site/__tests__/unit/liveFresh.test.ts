import { describe, expect, it } from "vitest";

import { stillOwesFresh } from "../../lib/liveFresh";

const pressRead = { landed: true, owed: true, pressedSince: false, sentFresh: true };

describe("whether a channel still owes a press a fresh read", () => {
  it("is paid by a fresh read that lands an answer", () => {
    expect(stillOwesFresh(pressRead)).toBe(false);
  });

  it("stays owed when the press's read failed, so its retry goes out fresh", () => {
    expect(stillOwesFresh({ ...pressRead, landed: false })).toBe(true);
  });

  it("stays owed when a press came after the read left, even with no channel alive to mark", () => {
    expect(stillOwesFresh({ ...pressRead, pressedSince: true })).toBe(true);
  });

  it("is never paid by a plain read, and never owed when no press asked", () => {
    expect(stillOwesFresh({ ...pressRead, sentFresh: false })).toBe(true);
    expect(stillOwesFresh({ ...pressRead, owed: false, sentFresh: false })).toBe(false);
  });
});
