/**
 * "What landed since you last looked" on the Fleet page: only landings after the mark count, a full window entirely
 * past the mark is a floor rather than a total, and no mark claims nothing new.
 */
import { describe, expect, it } from "vitest";

import { landedSince, landedSinceLine } from "../../lib/landedLooked";

const LANDINGS = [
  { mergedIso: "2026-10-05T03:00:00Z" },
  { mergedIso: "2026-10-05T02:00:00Z" },
  { mergedIso: "2026-10-05T01:00:00Z" },
];

describe("landedSince", () => {
  it("counts only the landings after the mark", () => {
    expect(landedSince({ landings: LANDINGS, limit: 30, lookedIso: "2026-10-05T01:30:00Z" })).toEqual({
      atLeast: false,
      count: 2,
      kind: "since",
    });
  });

  it("is a floor when every landing in a full window is past the mark", () => {
    expect(landedSince({ landings: LANDINGS, limit: 3, lookedIso: "2026-10-04T00:00:00Z" })).toEqual({
      atLeast: true,
      count: 3,
      kind: "since",
    });
  });

  it("claims nothing new with no mark, or a mark that is not a time", () => {
    expect(landedSince({ landings: LANDINGS, limit: 30, lookedIso: null })).toEqual({ kind: "unmarked" });
    expect(landedSince({ landings: LANDINGS, limit: 30, lookedIso: "yesterday" })).toEqual({ kind: "unmarked" });
  });
});

describe("landedSinceLine", () => {
  it("says the count, the floor and the singular", () => {
    expect(landedSinceLine({ shown: 3, since: { atLeast: true, count: 3, kind: "since" } })).toBe(
      "at least 3 changes landed on main since you last looked",
    );
    expect(landedSinceLine({ shown: 3, since: { atLeast: false, count: 1, kind: "since" } })).toBe(
      "1 change landed on main since you last looked",
    );
    expect(landedSinceLine({ shown: 3, since: { atLeast: false, count: 0, kind: "since" } })).toBe(
      "nothing has landed on main since you last looked",
    );
    expect(landedSinceLine({ shown: 30, since: { kind: "unmarked" } })).toBe(
      "the last 30 changes to land on main, newest first",
    );
  });
});
