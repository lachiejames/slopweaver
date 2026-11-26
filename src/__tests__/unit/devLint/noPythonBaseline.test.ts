/**
 * `.baselines/no-python-baseline.json`: the committed register of Python instructions that stood when the
 * `no-python` gate landed, and the decoder the gate reads it through. Pinned as metadata — which files owe how
 * many lines, in path order — so an entry silently dropped, added or reordered reddens here, without copying
 * every long command into the test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseNoPythonBaseline } from "../../../devLint/noPython.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const COMMITTED = unwrap(
  parseNoPythonBaseline({
    text: readFileSync(
      fileURLToPath(new URL("../../../../.baselines/no-python-baseline.json", import.meta.url)),
      "utf8",
    ),
  }),
);

describe("parseNoPythonBaseline", () => {
  it("decodes a well-formed list into its rows", () => {
    const row = { count: 1, matchedLine: "python3 -c 'print(1)'", owes: "a jq", path: "a.md" };

    expect(unwrap(parseNoPythonBaseline({ text: JSON.stringify({ instructions: [row] }) }))).toEqual([row]);
  });

  it("names a file that is not JSON as malformed", () => {
    expect(unwrapErr(parseNoPythonBaseline({ text: "{" })).code).toBe("BASELINE_MALFORMED");
  });

  it("names a file whose rows lack a field as the wrong shape, and says which shape it wanted", () => {
    const error = unwrapErr(parseNoPythonBaseline({ text: JSON.stringify({ instructions: [{ path: "a.md" }] }) }));

    expect(error.code).toBe("BASELINE_SHAPE_INVALID");
    expect(error.message).toContain("{ instructions: [{ path, matchedLine, count, owes }, …] }");
  });

  it("refuses a row carrying a field the gate does not read, rather than dropping it", () => {
    const row = { count: 1, extra: true, matchedLine: "python3 x.py", owes: "a verb", path: "a.md" };

    expect(unwrapErr(parseNoPythonBaseline({ text: JSON.stringify({ instructions: [row] }) })).code).toBe(
      "BASELINE_SHAPE_INVALID",
    );
  });
});

describe("the committed no-python baseline", () => {
  it("records exactly these seventeen path entries, in this order", () => {
    expect(COMMITTED.length).toBeGreaterThan(0);
    expect(COMMITTED.map(({ count, path }) => ({ count, path }))).toEqual([
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

  it("keeps its entries in path order", () => {
    const paths = COMMITTED.map((entry) => entry.path);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toEqual(paths.toSorted());
  });

  it("holds no entry with a count other than one, a blank or untrimmed line, a line naming no python3, or a blank owes", () => {
    expect(COMMITTED.length).toBeGreaterThan(0);
    expect(
      COMMITTED.filter(
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
    const identities = COMMITTED.map((entry) => `${entry.path}\n${entry.matchedLine}`);

    expect(identities.length).toBe(17);
    expect(new Set(identities).size).toBe(17);
  });
});
