import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  blobSetFindings,
  EMPTY_LANE_FINDING,
  mergedFileFindings,
  UNIT_LANE_INCLUDE,
  UNIT_SHARD_COUNT,
  unitShardBlob,
  unitShardCommand,
  unitShardJob,
  unitShardJobs,
  unlistedLaneFindings,
} from "../../../testLanes/unitShards.js";

describe("UNIT_LANE_INCLUDE", () => {
  it("is exactly the include the unit lane's own config selects, so the cross-check reads that lane", () => {
    // Read as TEXT: a file under `src/` importing `config/` fails the `compile` job with TS6059.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const text = readFileSync(join(root, "config", "vitest", "unit.ts"), "utf8");
    const block = /include: \[([^\]]*)\]/.exec(text)![1]!;
    expect([...block.matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual([...UNIT_LANE_INCLUDE]);
  });
});

describe("unlistedLaneFindings — Vitest's walk against git's listing", () => {
  it("names a lane file git lists that Vitest's walk skipped with its unreadable directory", () => {
    const listed = ["src/__tests__/unit/a.test.ts", "site/__tests__/unit/hidden/secret.test.ts", "README.md"];
    expect(unlistedLaneFindings({ expected: ["src/__tests__/unit/a.test.ts"], listed })).toEqual([
      "1 test file(s) git lists that the lane's own walk never selected, so it skipped a directory: site/__tests__/unit/hidden/secret.test.ts",
    ]);
  });

  it("matches a dot directory, which Vitest's glob walks too", () => {
    const listed = ["desktop/__tests__/unit/.cache/x.test.ts"];
    expect(unlistedLaneFindings({ expected: [], listed })).toEqual([
      "1 test file(s) git lists that the lane's own walk never selected, so it skipped a directory: desktop/__tests__/unit/.cache/x.test.ts",
    ]);
  });

  it("passes a walk that selected every lane file git lists, ignoring files outside the include", () => {
    const listed = ["src/__tests__/unit/a.test.ts", "src/__tests__/integration/b.test.ts", "src/a.ts"];
    expect(unlistedLaneFindings({ expected: ["src/__tests__/unit/a.test.ts"], listed })).toEqual([]);
  });

  it("lets a file under node_modules go, which Vitest's default exclude drops", () => {
    const listed = ["src/__tests__/unit/node_modules/x.test.ts"];
    expect(unlistedLaneFindings({ expected: [], listed })).toEqual([]);
  });
});

/** Every blob the lap produces, written out rather than derived, so a drift in the derivation shows here. */
const FULL_SET = ["blob-1-6.json", "blob-2-6.json", "blob-3-6.json", "blob-4-6.json", "blob-5-6.json", "blob-6-6.json"];

describe("the shard names and commands", () => {
  it("runs six shards, the count the lap-2 measurement chose", () => {
    expect(UNIT_SHARD_COUNT).toBe(6);
  });

  it("names every shard job in order", () => {
    expect(unitShardJobs()).toEqual(["unit-1", "unit-2", "unit-3", "unit-4", "unit-5", "unit-6"]);
  });

  it("names one shard job by its 1-based index", () => {
    expect(unitShardJob({ index: 3 })).toBe("unit-3");
  });

  it("narrows `test:unit` to one shard and writes a blob report, the step's whole run line", () => {
    expect(unitShardCommand({ index: 2 })).toBe("yarn test:unit --shard=2/6 --reporter=default --reporter=blob");
  });

  it("names the blob file Vitest writes for a shard", () => {
    expect(unitShardBlob({ index: 4 })).toBe("blob-4-6.json");
  });
});

describe("blobSetFindings", () => {
  it("reports nothing for exactly the set the shards produce, in any order", () => {
    expect(blobSetFindings({ names: FULL_SET.toReversed() })).toEqual([]);
  });

  it("names a shard whose report never arrived — the merge would otherwise be a smaller lane", () => {
    expect(blobSetFindings({ names: FULL_SET.filter((name) => name !== "blob-3-6.json") })).toEqual([
      "missing blob-3-6.json — its shard's report never arrived, so the merge would be a smaller lane",
    ]);
  });

  it("names every report missing from an empty directory", () => {
    expect(blobSetFindings({ names: [] })).toHaveLength(6);
  });

  it("names a report from a different shard count, which would double-count a slice of the lane", () => {
    expect(blobSetFindings({ names: [...FULL_SET, "blob-1-4.json"] })).toEqual([
      "unexpected blob-1-4.json — not one of the 6 shard reports this lap produces",
    ]);
  });
});

describe("mergedFileFindings", () => {
  const LANE = ["a.test.ts", "b.test.ts", "c.test.ts"];

  it("reports nothing when every lane file was merged exactly once", () => {
    expect(mergedFileFindings({ expected: LANE, merged: ["c.test.ts", "a.test.ts", "b.test.ts"] })).toEqual([]);
  });

  it("names a report duplicated in place of another: one file twice, another never", () => {
    expect(mergedFileFindings({ expected: LANE, merged: ["a.test.ts", "b.test.ts", "b.test.ts"] })).toEqual([
      "1 test file(s) never ran in any shard, so the merged lane is smaller than the lane: c.test.ts",
      "1 test file(s) ran in more than one merged report, so one report was duplicated in place of another: b.test.ts",
    ]);
  });

  it("names a file the lane does not select", () => {
    expect(mergedFileFindings({ expected: LANE, merged: [...LANE, "stray.test.ts"] })).toEqual([
      "1 test file(s) is not in the lane's own file list: stray.test.ts",
    ]);
  });

  it("counts every missing file but names only the first three", () => {
    expect(mergedFileFindings({ expected: [...LANE, "d.test.ts"], merged: [] })).toEqual([
      "4 test file(s) never ran in any shard, so the merged lane is smaller than the lane: a.test.ts, b.test.ts, c.test.ts",
    ]);
  });

  it("refuses an empty lane rather than calling an empty merge exact", () => {
    expect(mergedFileFindings({ expected: [], merged: [] })).toEqual([EMPTY_LANE_FINDING]);
  });

  it("refuses an empty lane and still names a merged file it does not list", () => {
    expect(mergedFileFindings({ expected: [], merged: ["a.test.ts"] })).toEqual([
      EMPTY_LANE_FINDING,
      "1 test file(s) is not in the lane's own file list: a.test.ts",
    ]);
  });
});
