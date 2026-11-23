import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mergeProcessCovs, mergeScriptCovs } from "@bcoe/v8-coverage";
import { describe, expect, it } from "vitest";
import {
  type CoverageFold,
  type CoverageOps,
  emptyCoverageFold,
  foldCoverageDump,
  handoffCoverage,
  type ProcessCoverage,
} from "../../../testLanes/coverageFold.js";

type Script = Parameters<typeof mergeProcessCovs>[0][number]["result"][number];
type Range = Script["functions"][number]["ranges"][number];

/** The two operations the provider injects, exactly as it injects them. */
const OPS: CoverageOps<Script> = { merge: mergeProcessCovs, normalize: (script) => mergeScriptCovs([script])! };

/** A seeded generator, so every generated lane is the same on every run. */
function seeded({ seed }: { seed: number }): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** A block tree under `[start, end)`, children nested and in order, as V8 writes one. */
function blocks({
  start,
  end,
  depth,
  next,
}: {
  start: number;
  end: number;
  depth: number;
  next: () => number;
}): Range[] {
  const ranges: Range[] = [{ count: Math.floor(next() * 4), endOffset: end, startOffset: start }];
  if (depth === 0 || end - start < 4) {
    return ranges;
  }
  let cursor = start + 1;
  while (cursor < end - 2 && next() < 0.6) {
    const childEnd = cursor + 1 + Math.floor(next() * (end - cursor - 1));
    ranges.push(...blocks({ depth: depth - 1, end: childEnd, next, start: cursor }));
    cursor = childEnd + Math.floor(next() * 2);
  }
  return ranges;
}

/** A lane of twelve dumps over five urls: each loads a random subset, some none, an offset sometimes absent. */
function generatedLane({ seed }: { seed: number }): ProcessCoverage<Script>[] {
  const next = seeded({ seed });
  const urls = ["a", "b", "c", "d", "e"].map((name) => `file:///repo/src/${name}.ts`);
  const dumps: ProcessCoverage<Script>[] = [];
  for (let dump = 0; dump < 12; dump += 1) {
    const result: Script[] = [];
    for (const url of urls) {
      if (next() < 0.45) {
        const startOffset = Math.floor(next() * 3) * 50;
        result.push({
          functions: [
            { functionName: "", isBlockCoverage: true, ranges: blocks({ depth: 3, end: 40, next, start: 0 }) },
            { functionName: "g", isBlockCoverage: true, ranges: blocks({ depth: 2, end: 30, next, start: 10 }) },
          ],
          scriptId: String(dump),
          url,
          ...(startOffset === 0 ? {} : { startOffset }),
        });
      }
    }
    dumps.push({ result });
  }
  return dumps;
}

/** One dump loading the single url `url`, its one function carrying `ranges`. */
function dumpOf({ url, ranges }: { url: string; ranges: Range[] }): ProcessCoverage<Script> {
  return { result: [{ functions: [{ functionName: "", isBlockCoverage: true, ranges }], scriptId: "7", url }] };
}

/** A counterexample: a merge whose output one more single-input pass still changes. */
function codexCounterexample(): ProcessCoverage<Script>[] {
  return [
    dumpOf({
      ranges: [
        { count: 2, endOffset: 10, startOffset: 0 },
        { count: 4, endOffset: 9, startOffset: 7 },
        { count: 1, endOffset: 8, startOffset: 7 },
      ],
      url: "a",
    }),
    dumpOf({
      ranges: [
        { count: 2, endOffset: 10, startOffset: 0 },
        { count: 3, endOffset: 8, startOffset: 5 },
        { count: 2, endOffset: 7, startOffset: 6 },
      ],
      url: "a",
    }),
  ];
}

/** Upstream's `onFileRead` in `@vitest/coverage-v8` 4.1, as a function of the coverage so far and one dump. */
function upstreamStep({ merged, coverage }: { merged: ProcessCoverage<Script>; coverage: ProcessCoverage<Script> }) {
  const next = mergeProcessCovs([merged, coverage]);
  for (const result of next.result) {
    if (!result.startOffset) {
      const original = coverage.result.find((candidate) => candidate.url === result.url);
      result.startOffset = 0;
      if (original?.startOffset) {
        result.startOffset = original.startOffset;
      }
    }
  }
  return next;
}

/** What upstream alone leaves after every dump, serialised. */
function upstreamFold({ dumps }: { dumps: readonly ProcessCoverage<Script>[] }): string {
  let merged: ProcessCoverage<Script> = { result: [] };
  for (const coverage of structuredClone(dumps)) {
    merged = upstreamStep({ coverage, merged });
  }
  return JSON.stringify(merged);
}

/** The fold over every dump, before the handoff. */
function foldAll({ dumps }: { dumps: readonly ProcessCoverage<Script>[] }): CoverageFold<Script> {
  let folded = emptyCoverageFold<Script>();
  for (const dump of structuredClone(dumps)) {
    folded = foldCoverageDump({ dump, folded, ops: OPS });
  }
  return folded;
}

/** What upstream leaves after the provider's ONE handoff of the fold, serialised. */
function handedOff({ dumps }: { dumps: readonly ProcessCoverage<Script>[] }): string {
  const coverage = handoffCoverage({ folded: foldAll({ dumps }), ops: OPS });
  return JSON.stringify(upstreamStep({ coverage, merged: { result: [] } }));
}

describe("foldCoverageDump and handoffCoverage", () => {
  it("leave what upstream's fold leaves on Codex's counterexample, where one pass too many would not", () => {
    const dumps = codexCounterexample();
    const once = JSON.parse(handedOff({ dumps })) as ProcessCoverage<Script>;
    // Upstream's ranges, which one more single-input pass would collapse to [6, 8, 4].
    const ranges = once.result[0]!.functions[0]!.ranges.map((range) => [
      range.startOffset,
      range.endOffset,
      range.count,
    ]);

    expect(handedOff({ dumps })).toBe(upstreamFold({ dumps }));
    expect(ranges).toEqual([
      [0, 10, 4],
      [5, 8, 5],
      [6, 7, 4],
      [7, 8, 4],
      [8, 9, 6],
    ]);
  });

  it("leave what upstream's fold leaves, byte for byte, on forty generated lanes", () => {
    const seeds = Array.from({ length: 40 }, (_, index) => index + 1);
    const differing = seeds.filter((seed) => {
      const dumps = generatedLane({ seed });
      return handedOff({ dumps }) !== upstreamFold({ dumps });
    });

    expect(seeds.length).toBe(40);
    expect(differing).toEqual([]);
  });

  it("hand off nothing for a lane that wrote no dump", () => {
    expect(handoffCoverage({ folded: emptyCoverageFold<Script>(), ops: OPS })).toEqual({ result: [] });
  });

  it("hand a lone dump to upstream's own step untouched", () => {
    const [first] = codexCounterexample();
    const before = structuredClone(first!.result);
    const folded = foldCoverageDump({ dump: first!, folded: emptyCoverageFold<Script>(), ops: OPS });

    expect(handoffCoverage({ folded, ops: OPS }).result).toEqual(before);
  });

  it("carry a script no later dump loads as the very same object, owing one pass per dump it missed", () => {
    const range = ({ count }: { count: number }): Range[] => [{ count, endOffset: 10, startOffset: 0 }];
    let folded = foldCoverageDump({
      dump: dumpOf({ ranges: range({ count: 1 }), url: "a" }),
      folded: emptyCoverageFold<Script>(),
      ops: OPS,
    });
    folded = foldCoverageDump({ dump: dumpOf({ ranges: range({ count: 2 }), url: "b" }), folded, ops: OPS });
    const carried = folded.scripts.get("a")!.script;
    folded = foldCoverageDump({ dump: dumpOf({ ranges: range({ count: 3 }), url: "b" }), folded, ops: OPS });
    folded = foldCoverageDump({ dump: { result: [] }, folded, ops: OPS });

    expect(folded.scripts.get("a")!.script).toBe(carried);
    expect(folded.scripts.get("a")!.owed).toBe(2);
    expect(folded.scripts.get("b")!.owed).toBe(0);
  });
});

describe("the installed @vitest/coverage-v8 step this fold emulates", () => {
  it("still folds each dump with mergeProcessCovs and restores startOffset from it", () => {
    // `handoffCoverage` is built for exactly this step. A bump that changes it fails here instead of drifting.
    const provider = readFileSync(
      createRequire(import.meta.url).resolve("@vitest/coverage-v8/dist/provider.js"),
      "utf8",
    );

    expect(provider).toContain("merged = mergeProcessCovs([merged, coverage]);");
    expect(provider).toContain("onFileRead(coverage) {");
    expect(provider).toContain("result.startOffset = original?.startOffset || 0;");
  });
});
