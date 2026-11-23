/*
 * `briefingOf`: partial when only the board row was read, not applicable for a card naming nothing, not measured when
 * a board row's answer was not kept, and blind to a read after its window closes.
 */
import { describe, expect, it } from "vitest";

import { briefingOf } from "../../../../desktop/cardFidelityBriefing.js";
import { cardSourceOf } from "../../../../desktop/cardFidelitySource.js";
import { ANSWER, at, GOOD, KEY, tool } from "./harness.js";

describe("briefingOf", () => {
  const source = cardSourceOf({ answer: ANSWER, cardKey: KEY })!;

  it("is partial when only the board row was read, and not applicable for a card naming nothing", () => {
    const read = briefingOf({ fromMs: 0, ordered: GOOD.slice(0, 3), source, toMs: Number.POSITIVE_INFINITY });
    const bare = cardSourceOf({ answer: JSON.stringify({ card: { key: KEY } }), cardKey: KEY })!;
    expect([read.state, read.read]).toEqual(["partial", ["board:acme-fixture-card"]]);
    expect(briefingOf({ fromMs: 0, ordered: GOOD, source: bare, toMs: 1 }).state).toBe("not-applicable");
  });

  it("cannot rule a board row out when its answer was not kept", () => {
    const ordered = [tool({ detail: "read with board_row", name: "board_row", s: 3 })];
    expect(briefingOf({ fromMs: 0, ordered, source, toMs: Number.POSITIVE_INFINITY }).state).toBe("not-measured");
  });

  it("counts no read after the window closes", () => {
    const toMs = Date.parse(at({ seconds: 3 }));
    expect(briefingOf({ fromMs: 0, ordered: GOOD, source, toMs }).state).toBe("not-read");
  });
});
