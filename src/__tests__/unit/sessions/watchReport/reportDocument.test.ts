/* The `--json` document a watch prints: the rows, the suppressed count, the instant and what the drain could not see. */
import { describe, expect, it } from "vitest";

import { sessionWatchReportDocument } from "../../../../sessions/watchReport.js";
import { NOW, UNMAPPED_ROW } from "./harness.js";

describe("sessionWatchReportDocument", () => {
  it("carries the rows, the suppressed count, the instant and what the drain could not see", () => {
    const document = sessionWatchReportDocument({
      diagnostics: ["some events were MISSED"],
      observedAtIso: NOW,
      report: { rows: [UNMAPPED_ROW], suppressed: 385, suppressedOldestQuietMinutes: 8786 },
    });

    expect(document).toStrictEqual({
      diagnostics: ["some events were MISSED"],
      observedAtIso: NOW,
      rows: [UNMAPPED_ROW],
      suppressed: 385,
      suppressedOldestQuietMinutes: 8786,
    });
  });

  it("writes null, not an absent key, when nothing was suppressed", () => {
    const document = sessionWatchReportDocument({
      diagnostics: [],
      observedAtIso: NOW,
      report: { rows: [], suppressed: 0, suppressedOldestQuietMinutes: undefined },
    });

    expect(JSON.parse(JSON.stringify(document)) as unknown).toStrictEqual({
      diagnostics: [],
      observedAtIso: NOW,
      rows: [],
      suppressed: 0,
      suppressedOldestQuietMinutes: null,
    });
  });
});
