/**
 * The Linear atlas's publish-side refusals: each factory's code and exact text, and the lines each prints.
 *
 * The sensitivity refusal caps how many hits it names, so it is asserted over NINE hits: the headline must
 * count all nine while exactly eight hit lines appear between it and the correction.
 */
import { describe, expect, it } from "vitest";

import { LinearAtlasErrors, linearAtlasErrorLines } from "../../../../atlas/linear/errors.js";

describe("LinearAtlasErrors — the publish-side refusals", () => {
  it("prints a workspace crossing, why it is refused and the remedy passed in, one per line", () => {
    const error = LinearAtlasErrors.workspaceCrossed({ after: "w2", before: "w1", remedy: "run: the reset" });
    expect(error.code).toBe("WORKSPACE_CROSSED");
    expect(linearAtlasErrorLines({ error })).toEqual([
      "this generation was published from workspace w1 and this run read workspace w2",
      "the store accumulates, so publishing across workspaces would leave the first one's configuration marked stale — which reads as Linear having deleted it",
      "run: the reset",
    ]);
  });

  it("prints a run that read nothing and the browser's reason as two lines", () => {
    const error = LinearAtlasErrors.nothingRead({ because: "no consent token" });
    expect(error.code).toBe("NOTHING_READ");
    expect(linearAtlasErrorLines({ error })).toEqual([
      "neither surface produced a reading, so there is nothing to publish",
      "no consent token",
    ]);
    expect(error.message).toBe("neither surface produced a reading, so there is nothing to publish; no consent token");
  });

  it("counts every held value but names only the first eight", () => {
    const hits = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((key) => ({ path: `/${key}`, reason: "an email" }));
    const error = LinearAtlasErrors.sensitiveValuesHeld({ hits });
    expect(error.code).toBe("SENSITIVE_VALUES_HELD");
    expect(linearAtlasErrorLines({ error })).toEqual([
      "this generation carries 9 value(s) this atlas may never hold, so nothing was written",
      "  /a: an email",
      "  /b: an email",
      "  /c: an email",
      "  /d: an email",
      "  /e: an email",
      "  /f: an email",
      "  /g: an email",
      "  /h: an email",
      "fix the selection in settingSurfaces.ts rather than the gate — a redacting gate would leave a generation silently different from what was read",
    ]);
  });

  it("refuses a walk with no page planned", () => {
    const error = LinearAtlasErrors.pagesUnplanned();
    expect(error.code).toBe("PAGES_UNPLANNED");
    expect(linearAtlasErrorLines({ error })).toEqual([
      "no settings page was planned, so a walk would report full coverage over nothing",
    ]);
  });

  it("prints a pre-existing single-sentence failure as its message", () => {
    const error = LinearAtlasErrors.browserUnavailable({ reason: "Chrome is not running" });
    expect(linearAtlasErrorLines({ error })).toEqual([
      "the browser surface could not be filled: Chrome is not running",
    ]);
  });
});
