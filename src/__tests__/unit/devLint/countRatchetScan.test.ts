/**
 * The ratchet edge's scan step: a gate that scans hits gets them as read, a gate that scans facts gets them
 * resolved over the WHOLE pool first, and a file that would not read is reported rather than silently skipped —
 * the input `countRatchetAction` (`./countRatchet.test.ts`) refuses to rebaseline over.
 */
import { describe, expect, it } from "vitest";
import { type CountRatchetGateCore, scanGate } from "../../../devLint/countRatchet.js";

/** The fields `scanGate` never reads, so each case below declares only how it scans. */
const CORE: CountRatchetGateCore<string> = {
  baselineFile: ".baselines/unused.json",
  baselineKey: "sites",
  cleanLine: () => "",
  counts: () => [],
  findingKeyOf: ({ hit }) => hit,
  findingOf: ({ hit }) => ({ line: 1, path: hit, text: hit }),
  gate: "scan-gate-test",
  keyOf: ({ hit }) => hit,
  rebaselineRefusalId: "error-shape-threshold-rebaseline",
  refusalDetail: () => "",
  refusalId: "error-shape-threshold",
  scope: { selfFiles: new Set(), trees: ["src/"] },
  unit: "hit(s)",
};

/** Two readable files and one that throws, as the filesystem read would. */
const FILES: Readonly<Record<string, string>> = { "src/a.ts": "alpha", "src/b.ts": "beta" };

/** Read a path from {@link FILES}, throwing on one it does not hold. */
function readText({ path }: { path: string }): string {
  const text = FILES[path];
  if (text === undefined) {
    throw new Error(`ENOENT: ${path}`);
  }
  return text;
}

describe("scanGate", () => {
  it("gives a hit-scanning gate its hits exactly as each file's scan returned them", () => {
    const result = scanGate({
      gate: { ...CORE, scan: ({ path, content }) => [`${path}:${content}`] },
      paths: ["src/a.ts", "src/b.ts"],
      readText,
    });
    expect(result.hits).toEqual(["src/a.ts:alpha", "src/b.ts:beta"]);
    expect(result.scanned).toBe(2);
  });

  it("resolves a fact-scanning gate over every file's facts at once, not file by file", () => {
    const result = scanGate<string, { path: string; length: number }>({
      gate: {
        ...CORE,
        resolve: ({ facts }) => [facts.map((fact) => `${fact.path}=${String(fact.length)}`).join(",")],
        scan: ({ path, content }) => [{ length: content.length, path }],
      },
      paths: ["src/a.ts", "src/b.ts"],
      readText,
    });
    expect(result.hits).toEqual(["src/a.ts=5,src/b.ts=4"]);
  });

  it("reports a file that would not read as unreadable and leaves it out of the scanned count", () => {
    const result = scanGate({
      gate: { ...CORE, scan: ({ path }) => [path] },
      paths: ["src/a.ts", "src/gone.ts"],
      readText,
    });
    expect(result.hits).toEqual(["src/a.ts"]);
    expect(result.scanned).toBe(1);
    expect(result.unreadable.map((one) => one.path)).toEqual(["src/gone.ts"]);
  });
});
