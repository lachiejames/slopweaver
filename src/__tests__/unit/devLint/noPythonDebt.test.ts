/**
 * `NO_PYTHON_DEBT`: the committed registry of Python instructions that stood when the `no-python` gate landed.
 * Pinned as metadata — which files owe how many lines, in path order — so an entry silently dropped, added or
 * reordered reddens here, without copying every long command into the test.
 */
import { describe, expect, it } from "vitest";

import { NO_PYTHON_DEBT } from "../../../devLint/noPythonDebt.js";

describe("NO_PYTHON_DEBT", () => {
  it("records exactly these seventeen path entries, in this order", () => {
    expect(NO_PYTHON_DEBT.length).toBeGreaterThan(0);
    expect(NO_PYTHON_DEBT.map(({ count, path }) => ({ count, path }))).toEqual([
      { count: 1, path: "src/__tests__/setup-temp-root.ts" },
      { count: 1, path: "src/admit/inventedVisual.ts" },
      { count: 1, path: "src/admit/inventedVisual.ts" },
      { count: 1, path: "src/admit/inventedVisual.ts" },
      { count: 1, path: "src/admit/inventedVisual.ts" },
      { count: 1, path: "src/atlas/jumpcloud/shapeExemptions.ts" },
      { count: 1, path: "src/atlas/vanta/vulnerabilityReport.ts" },
      { count: 1, path: "src/briefing/caps.ts" },
      { count: 1, path: "src/briefing/caps.ts" },
      { count: 1, path: "src/handover/summaryCap.ts" },
      { count: 1, path: "src/live/fathom/api.ts" },
      { count: 1, path: "src/live/fathom/api.ts" },
      { count: 1, path: "src/reflect/collectAskedForMissing.ts" },
      { count: 1, path: "src/reflect/collectAskedForMissing.ts" },
      { count: 1, path: "src/reflect/substrate.ts" },
      { count: 1, path: "src/route/atlasReading.ts" },
      { count: 1, path: "src/silver/mentionResolver.ts" },
    ]);
  });

  it("keeps its entries in path order, as its own doc comment says", () => {
    const paths = NO_PYTHON_DEBT.map((entry) => entry.path);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toEqual(paths.toSorted());
  });

  it("holds no entry with a count other than one, a blank or untrimmed line, a line naming no python3, or a blank owes", () => {
    expect(NO_PYTHON_DEBT.length).toBeGreaterThan(0);
    expect(
      NO_PYTHON_DEBT.filter(
        (entry) =>
          entry.count !== 1 ||
          entry.matchedLine === "" ||
          entry.matchedLine !== entry.matchedLine.trim() ||
          !entry.matchedLine.includes("python3") ||
          entry.owes.trim() === "",
      ),
    ).toEqual([]);
  });

  it("never records the same path and line twice — a repeat is one entry with a higher count", () => {
    const identities = NO_PYTHON_DEBT.map((entry) => `${entry.path}\n${entry.matchedLine}`);

    expect(identities.length).toBe(17);
    expect(new Set(identities).size).toBe(17);
  });
});
