import { describe, expect, it } from "vitest";

import {
  acceptedKeys,
  countFindings,
  findingKey,
  keysFromResults,
  type MemoryGateResult,
  partitionAgainstBaseline,
  shrunkBaseline,
} from "../../../memory/gateBaseline.js";
import type { MemoryFinding } from "../../../memory/types.js";

const DIR_A = "/home/x/.claude/projects/a/memory";
const DIR_B = "/home/x/.claude/projects/b/memory";

function finding({
  check,
  file,
  line,
  message,
}: {
  check: MemoryFinding["check"];
  file: string;
  line: number | null;
  message: string;
}): MemoryFinding {
  return { check, file, line, message };
}

const PREFIXED = finding({
  check: "name-format",
  file: "a.md",
  line: null,
  message: "`name: project-thing` opens with `project-`",
});
const DANGLING = finding({
  check: "dangling-wikilink",
  file: "b.md",
  line: 12,
  message: "`[[nope]]` matches no memory",
});

describe("findingKey", () => {
  it("separates two corpora carrying the identical finding", () => {
    expect(findingKey({ dir: DIR_A, finding: PREFIXED })).not.toBe(findingKey({ dir: DIR_B, finding: PREFIXED }));
  });

  it("ignores the line number, so an edit above a finding does not re-block it", () => {
    const moved = finding({ check: DANGLING.check, file: DANGLING.file, line: 99, message: DANGLING.message });
    expect(findingKey({ dir: DIR_A, finding: moved })).toBe(findingKey({ dir: DIR_A, finding: DANGLING }));
  });

  it("includes the message, so a mutated defect is not waved through by a loose key", () => {
    const mutated = finding({
      check: PREFIXED.check,
      file: PREFIXED.file,
      line: null,
      message: "`name: Thing_One` is not kebab-case",
    });
    expect(findingKey({ dir: DIR_A, finding: mutated })).not.toBe(findingKey({ dir: DIR_A, finding: PREFIXED }));
  });
});

describe("partitionAgainstBaseline", () => {
  const results: readonly MemoryGateResult[] = [
    { dir: DIR_A, findings: [PREFIXED, DANGLING] },
    { dir: DIR_B, findings: [] },
  ];

  it("calls everything fresh against an empty list", () => {
    const split = partitionAgainstBaseline({ accepted: [], results });
    expect(countFindings({ results: split.fresh })).toBe(2);
    expect(countFindings({ results: split.standing })).toBe(0);
    expect(split.staleKeys).toEqual([]);
  });

  it("moves an accepted finding to standing and leaves the rest fresh", () => {
    const split = partitionAgainstBaseline({
      accepted: [findingKey({ dir: DIR_A, finding: PREFIXED })],
      results,
    });
    expect(split.fresh[0]!.findings).toEqual([DANGLING]);
    expect(split.standing[0]!.findings).toEqual([PREFIXED]);
  });

  it("keeps an entry for a corpus that found nothing, so the report can still count it", () => {
    const split = partitionAgainstBaseline({ accepted: [], results });
    expect(split.fresh.map((r) => r.dir)).toEqual([DIR_A, DIR_B]);
    expect(split.fresh[1]!.findings).toEqual([]);
  });

  it("reports an accepted key that stopped firing as stale", () => {
    const gone = findingKey({ dir: DIR_B, finding: PREFIXED });
    const split = partitionAgainstBaseline({ accepted: [gone], results });
    expect(split.staleKeys).toEqual([gone]);
  });

  it("does not call an accepted key stale just because another corpus is clean", () => {
    const split = partitionAgainstBaseline({
      accepted: [findingKey({ dir: DIR_A, finding: DANGLING })],
      results,
    });
    expect(split.staleKeys).toEqual([]);
  });

  it("never calls an entry stale for a check this build does not run, so an older checkout cannot prune a newer one's", () => {
    const later = [DIR_B, "a-check-from-a-later-build", "x.md", "a finding"].join("\u0000");
    const gone = findingKey({ dir: DIR_B, finding: PREFIXED });
    const split = partitionAgainstBaseline({ accepted: [later, gone], results });
    expect(split.staleKeys).toEqual([gone]);
  });
});

describe("acceptedKeys", () => {
  it("replaces what this build judges and keeps a later build's entries", () => {
    const later = [DIR_B, "a-check-from-a-later-build", "x.md", "a finding"].join("\u0000");
    const fixed = findingKey({ dir: DIR_B, finding: PREFIXED });
    const standing = findingKey({ dir: DIR_A, finding: DANGLING });
    const keys = acceptedKeys({ accepted: [later, fixed], results: [{ dir: DIR_A, findings: [DANGLING] }] });
    expect(keys).toEqual([standing, later].toSorted());
  });
});

describe("keysFromResults", () => {
  it("collects every finding, sorted", () => {
    const keys = keysFromResults({ results: [{ dir: DIR_A, findings: [DANGLING, PREFIXED] }] });
    expect(keys).toEqual(
      [findingKey({ dir: DIR_A, finding: DANGLING }), findingKey({ dir: DIR_A, finding: PREFIXED })].toSorted(),
    );
  });

  it("deduplicates two identical findings in one corpus", () => {
    const keys = keysFromResults({ results: [{ dir: DIR_A, findings: [PREFIXED, PREFIXED] }] });
    expect(keys.length).toBe(1);
  });

  it("is empty for a clean run", () => {
    expect(keysFromResults({ results: [{ dir: DIR_A, findings: [] }] })).toEqual([]);
  });
});

describe("shrunkBaseline", () => {
  it("drops exactly the stale keys", () => {
    expect(shrunkBaseline({ accepted: ["a", "b", "c"], staleKeys: ["b"] })).toEqual(["a", "c"]);
  });

  it("is unchanged when nothing went stale", () => {
    expect(shrunkBaseline({ accepted: ["b", "a"], staleKeys: [] })).toEqual(["a", "b"]);
  });

  it("can only shrink, never grow", () => {
    expect(shrunkBaseline({ accepted: ["a"], staleKeys: ["a"] })).toEqual([]);
  });
});

describe("countFindings", () => {
  it("sums across corpora", () => {
    expect(
      countFindings({
        results: [
          { dir: DIR_A, findings: [PREFIXED, DANGLING] },
          { dir: DIR_B, findings: [PREFIXED] },
        ],
      }),
    ).toBe(3);
  });

  it("is zero for a clean run", () => {
    expect(countFindings({ results: [{ dir: DIR_A, findings: [] }] })).toBe(0);
  });
});
