import { describe, expect, it } from "vitest";

import { boardRowPlacement } from "../../../lib/registerPlacement";
import { markedCount } from "../../../lib/workspacePlacementContext";
import { ACME_PLACER } from "../../organisationFixture";
import { BARE, SLOPWEAVER_PR } from "./fixtures";

describe("markedCount — what a fold says it holds", () => {
  it("counts the findings and the statements over a conflict among the rows folded away, and nothing else", () => {
    const placed = boardRowPlacement({ placer: ACME_PLACER, row: { ...BARE, workspace: "team" } });
    const unplaced = boardRowPlacement({ placer: ACME_PLACER, row: BARE });
    const overruled = boardRowPlacement({
      placer: ACME_PLACER,
      row: { ...BARE, prUrls: [SLOPWEAVER_PR], workspace: "team" },
    });
    expect(markedCount({ rows: [{ placement: placed }, { placement: unplaced }, { placement: overruled }] })).toBe(2);
    expect(markedCount({ rows: [] })).toBe(0);
  });
});
