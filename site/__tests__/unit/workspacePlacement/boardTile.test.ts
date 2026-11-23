import { describe, expect, it } from "vitest";

import { boardInContext } from "../../../lib/workstreamsContext";
import { ACME_PLACER } from "../../organisationFixture";
import { board } from "./fixtures";

describe("workstreams — the board tile", () => {
  it("lists only the rows its own workspace owns, sets every finding apart, and tallies the rest", () => {
    const shown = boardInContext({ board: board(), context: "slopweaver", placer: ACME_PLACER });
    expect(shown.rows.map((row) => row.slug)).toEqual(["acme-console-pages-react-27-sep"]);
    expect(shown.findings.map((row) => row.slug)).toEqual(["no-evidence"]);
    expect(shown.tally).toEqual({ conflict: 0, here: 2, other: 1, unplaced: 1 });
  });

  it("does the same the other way — the team page carries no self row and no finding", () => {
    const shown = boardInContext({ board: board(), context: "work", placer: ACME_PLACER });
    expect(shown.rows.map((row) => row.slug)).toEqual(["iso-least-privilege"]);
    expect(shown.findings).toEqual([]);
    expect(shown.tally).toEqual({ conflict: 0, here: 1, other: 2, unplaced: 0 });
  });
});
