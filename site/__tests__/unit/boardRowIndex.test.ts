import { describe, expect, it } from "vitest";

import { indexBoardRows, rowsCarrying } from "../../lib/boardRowIndex";

const ROWS = [
  { n: 0, slug: "b" },
  { n: 1, slug: "x" },
  { n: 2, slug: "a" },
  { n: 3, slug: "b" },
];

describe("the board-row index", () => {
  it("answers exactly the scan it replaced, in board order, whatever order the slugs come in", () => {
    const slugs = new Set(["a", "b", "missing"]);
    expect(rowsCarrying({ index: indexBoardRows({ rows: ROWS }), slugs })).toEqual(
      ROWS.filter((row) => slugs.has(row.slug)),
    );
    expect(rowsCarrying({ index: indexBoardRows({ rows: ROWS }), slugs }).map((row) => row.n)).toEqual([0, 2, 3]);
  });

  it("answers nothing for an empty board or no slugs", () => {
    expect(rowsCarrying({ index: indexBoardRows({ rows: [] }), slugs: new Set(["a"]) })).toEqual([]);
    expect(rowsCarrying({ index: indexBoardRows({ rows: ROWS }), slugs: new Set() })).toEqual([]);
  });

  it("keeps the rows as they stood, so a caller changing its own array later moves nothing", () => {
    const rows = [...ROWS];
    const index = indexBoardRows({ rows });
    rows.splice(0, rows.length, { n: 9, slug: "a" });
    expect(rowsCarrying({ index, slugs: new Set(["a"]) }).map((row) => row.n)).toEqual([2]);
  });
});
