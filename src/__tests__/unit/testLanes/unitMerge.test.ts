import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { couldBeLaneFile, runUnitMerge } from "../../../testLanes/unitMerge.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "unit-merge-"));
});

afterEach(() => {
  rmSync(cwd, { force: true, recursive: true });
});

/** Write the named report files into the blob directory, empty — the refusal reads names, never contents. */
const writeBlobs = ({ names }: { names: readonly string[] }): void => {
  mkdirSync(join(cwd, ".vitest-reports"));
  for (const name of names) {
    writeFileSync(join(cwd, ".vitest-reports", name), "");
  }
};

describe("runUnitMerge", () => {
  it("refuses when no shard report directory arrived at all", () => {
    expect(runUnitMerge({ cwd })).toBe(1);
  });

  it("refuses a set missing one shard, before anything merges", () => {
    writeBlobs({ names: ["blob-1-6.json", "blob-2-6.json", "blob-3-6.json", "blob-4-6.json", "blob-5-6.json"] });
    expect(runUnitMerge({ cwd })).toBe(1);
  });
});

describe("couldBeLaneFile", () => {
  it("drops a path that does not exist, a dangling link and a self-looping link", () => {
    symlinkSync(join(cwd, "nowhere"), join(cwd, "dangling.test.ts"));
    symlinkSync(join(cwd, "loop.test.ts"), join(cwd, "loop.test.ts"));
    expect([
      couldBeLaneFile({ cwd, file: "gone.test.ts" }),
      couldBeLaneFile({ cwd, file: "dangling.test.ts" }),
      couldBeLaneFile({ cwd, file: "loop.test.ts" }),
    ]).toEqual([false, false, false]);
  });

  it("keeps a file on disk, and a link to one", () => {
    writeFileSync(join(cwd, "here.test.ts"), "");
    symlinkSync(join(cwd, "here.test.ts"), join(cwd, "linked.test.ts"));
    expect([couldBeLaneFile({ cwd, file: "here.test.ts" }), couldBeLaneFile({ cwd, file: "linked.test.ts" })]).toEqual([
      true,
      true,
    ]);
  });

  it("drops a directory symlink named like a test, which Vitest never selects", () => {
    // A tracked link `x.test.ts` to a directory reddened a complete lane.
    mkdirSync(join(cwd, "target"));
    symlinkSync(join(cwd, "target"), join(cwd, "not-a-file.test.ts"));
    expect(couldBeLaneFile({ cwd, file: "not-a-file.test.ts" })).toBe(false);
  });

  it("keeps a file behind an unreadable directory, which existsSync read as gone", () => {
    // A tracked test under an ignored `chmod 000` directory answers EACCES, not ENOENT.
    mkdirSync(join(cwd, "hidden"));
    writeFileSync(join(cwd, "hidden", "secret.test.ts"), "");
    chmodSync(join(cwd, "hidden"), 0o000);
    try {
      expect(couldBeLaneFile({ cwd, file: "hidden/secret.test.ts" })).toBe(true);
    } finally {
      chmodSync(join(cwd, "hidden"), 0o755);
    }
  });
});
