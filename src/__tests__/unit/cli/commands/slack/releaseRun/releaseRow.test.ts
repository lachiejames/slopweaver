import { describe, expect, it } from "vitest";
import { heldRowOf } from "../../../../../../cli/commands/slack/releaseHeldRow.js";
import { releaseFormOf } from "../../../../../../cli/commands/slack/releaseRow.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { heldRow, logOf } from "./fixtures.js";

describe("releaseRow — the register reads a release makes before anything live", () => {
  it("answers the held row a release names, beside every folded row", () => {
    const row = heldRow();
    const held = unwrap(heldRowOf({ deps: { readDraftLog: () => logOf({ row }) }, draftId: row.id, home: "/h" }));
    expect(held.row.id).toBe(row.id);
    expect(held.items.map((item) => item.id)).toEqual([row.id]);
  });

  it("refuses an id the register does not hold", () => {
    const refused = unwrapErr(heldRowOf({ deps: { readDraftLog: () => [] }, draftId: "sd-00000000", home: "/h" }));
    expect(refused.code).toBe("DRAFT_NOT_FOUND");
    expect(refused.message).toContain("sd-00000000");
  });

  it("re-prepares the typed --form over the row's own, and the row's own when none is typed", () => {
    const row = heldRow();
    expect(unwrap(releaseFormOf({ draft: row, formSource: "{}" }))).toBe("{}");
    expect(unwrap(releaseFormOf({ draft: row, formSource: undefined }))).toBe(row.form);
  });
});
