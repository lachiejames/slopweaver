/**
 * The capture's git reads are BOUNDED, and the bound is above a real monorepo's whole-index listing.
 *
 * Node caps a captured child at 1 MiB by default and throws ENOBUFS past it. `readTreeNow` wraps its reads
 * in a `try`, so that throw arrived as "its working tree could not be read at apply time" — a read that had
 * actually worked, reported as a repository that could not be opened. Measured on a real drain lap: every
 * worktree in a large monorepo declined its salvage, because `git ls-files -v -z` there runs just past
 * 1 MiB. The decline was the safe direction, which is exactly why nothing surfaced it for a whole lap.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { productionGithubPushDeps } from "../../../cli/commands/github/pushPrimitives.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** Past Node's 1 MiB default with room to spare, so the assertion cannot pass on a near miss. */
const ENTRIES = 40_000;

describe("the capture's git read bound", REAL_GIT_SUITE, () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap-read-"));
    gitInTemp({ cwd: dir, args: ["init", "-q", "-b", "main"] });
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    gitInTemp({ cwd: dir, args: ["add", "seed.txt"] });
    // Index entries are minted from ONE blob through `--index-info`, so 24,000 of them cost no filesystem
    // writes at all. The listing's size is what is under test, not the tree's.
    const blob = gitInTemp({ cwd: dir, args: ["rev-parse", ":seed.txt"] }).trim();
    const lines = Array.from({ length: ENTRIES }, (_, i) => `100644 ${blob} 0\tpadded/directory/name/entry-${i}.txt`);
    gitInTemp({ cwd: dir, args: ["update-index", "--index-info"], input: `${lines.join("\n")}\n` });
  }, REAL_GIT_TIMEOUT_MS);

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("reads a whole-index listing well past Node's 1 MiB default instead of throwing ENOBUFS", () => {
    const listing = productionGithubPushDeps().readGit({ args: ["ls-files", "-v", "-z"], cwd: dir });

    // The witness the bound exists for: the answer is bigger than the default that used to refuse it.
    expect(listing.length).toBeGreaterThan(1024 * 1024);
    expect(listing.split("\0").filter((entry) => entry.endsWith("entry-0.txt"))).toEqual([
      "H padded/directory/name/entry-0.txt",
    ]);
  });
});
