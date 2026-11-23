/** The one row `handover row --json` prints, against the board's own row for the same doc. */
import { describe, expect, it } from "vitest";

import { boardJsonRow, NO_BOARD_REFERENCES } from "../../../../cli/commands/handover/listJson.js";
import { BOARD_SUMMARY_CHARS } from "../../../../cli/commands/handover/listJsonRowText.js";
import { boardRowJsonText } from "../../../../cli/commands/handover/rowJson.js";
import { doc, modelsFor } from "./fixtures.js";

describe("boardRowJsonText — the one row `handover row --json` prints", () => {
  const HUGE = "x".repeat(BOARD_SUMMARY_CHARS + 500);

  it("is the board's own row for that doc, with its summary WHOLE rather than capped", () => {
    const [model] = modelsFor({ docs: [doc({ priority: "p1", slug: "fat", summary: HUGE })] });
    const printed = JSON.parse(
      boardRowJsonText({ model: model!, references: NO_BOARD_REFERENCES, repoLargestPull: undefined }),
    ) as Record<string, unknown>;
    // Round-tripped so the `undefined` fields drop exactly as they do from the printed text.
    const boardRow = JSON.parse(
      JSON.stringify(boardJsonRow({ model: model!, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() })),
    ) as Record<string, unknown>;

    expect(boardRow["summary"]).toBe("x".repeat(BOARD_SUMMARY_CHARS));
    expect(printed).toEqual({ ...boardRow, referenceContext: { linearTeamKeys: [], records: [] }, summary: HUGE });
    expect(printed["slug"]).toBe("fat");
    expect(printed["priority"]).toBe("p1");
  });
});
