/**
 * The shared result contract `pane pr-status` ranks its rows through: ranking is derived from the sort key
 * alone, and ties break on the stable `key` so rows cannot shuffle between measurements.
 *
 * deleted-with-code: heldSection, measuredAge
 */
import { describe, expect, it } from "vitest";
import { type RankCandidate, rankRows } from "../../../pane/section.js";

/** One candidate, spread over so only the field under test varies. */
function candidate(over: Partial<RankCandidate> = {}): RankCandidate {
  return {
    rankWhy: "because",
    row: {
      age: "measured 1s ago",
      badge: "you",
      badgeKind: "you",
      detail: ["phase    open"],
      key: "k",
      title: "a-thing",
      verb: "decide",
      why: "evidence",
    },
    sortKey: "0",
    ...over,
  };
}

describe("rankRows", () => {
  it("orders by sort key and stamps a 1-based rank with the reason", () => {
    const rows = rankRows({
      candidates: [
        candidate({ rankWhy: "second", row: { ...candidate().row, key: "b" }, sortKey: "1" }),
        candidate({ rankWhy: "first", row: { ...candidate().row, key: "a" }, sortKey: "0" }),
      ],
      sectionId: "s",
    });

    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.rank).toBe(2);
    expect(rows[0]!.rankWhy).toBe("first");
  });

  it("breaks a tie on the stable key, so equal rows do not shuffle between measurements", () => {
    const tie = ({ key }: { key: string }): RankCandidate =>
      candidate({ row: { ...candidate().row, key }, sortKey: "same" });

    const first = rankRows({ candidates: [tie({ key: "z" }), tie({ key: "a" }), tie({ key: "m" })], sectionId: "s" });
    const second = rankRows({ candidates: [tie({ key: "m" }), tie({ key: "z" }), tie({ key: "a" })], sectionId: "s" });

    expect(first.map((r) => r.key)).toEqual(["a", "m", "z"]);
    expect(second.map((r) => r.key)).toEqual(["a", "m", "z"]);
  });

  it("stamps every row with the section it belongs to", () => {
    const rows = rankRows({ candidates: [candidate()], sectionId: "prs" });

    expect(rows[0]!.sectionId).toBe("prs");
  });

  it("returns no rows for no candidates, rather than inventing one", () => {
    expect(rankRows({ candidates: [], sectionId: "s" })).toEqual([]);
  });
});
