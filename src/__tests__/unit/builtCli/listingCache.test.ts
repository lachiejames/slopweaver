/**
 * The guard's source listing, remembered against the git index it came from — over a REAL throwaway checkout,
 * because the property worth holding down is that a changed index is never answered from the cache.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { cachedListing, gitDirOf, LISTING_CACHE_FILE, listingFor, listingKey } from "../../../builtCli/listingCache.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const dirs: string[] = [];
const ARGV = ["ls-files", "-z", "src"];

/** A throwaway checkout with one tracked source file. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), "listing-"));
  dirs.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  gitInTemp({ args: ["init", "-q"], cwd: root });
  gitInTemp({ args: ["add", "-A"], cwd: root });
  return root;
}

/** A listing read straight from git, counting how often it was asked. */
function counted({ root }: { root: string }): {
  list: () => { files: readonly string[]; remember: boolean };
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    list: () => {
      calls += 1;
      return { files: gitInTemp({ args: ["ls-files", "src"], cwd: root }).split("\n"), remember: true };
    },
  };
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

describe("gitDirOf", () => {
  it("is the checkout's own .git when that is a directory", () => {
    expect(gitDirOf({ dotGit: undefined, root: "/r" })).toBe("/r/.git");
  });

  it("follows a linked worktree's gitdir pointer, relative or absolute", () => {
    expect(gitDirOf({ dotGit: "gitdir: /main/.git/worktrees/w\n", root: "/r" })).toBe("/main/.git/worktrees/w");
    expect(gitDirOf({ dotGit: "gitdir: ../main/.git/worktrees/w\n", root: "/x/r" })).toBe("/x/main/.git/worktrees/w");
  });

  it("knows no git directory for a .git file that is not a pointer", () => {
    expect(gitDirOf({ dotGit: "not a pointer", root: "/r" })).toBeUndefined();
  });
});

describe("listingFor", () => {
  it("answers the listing recorded for this index", () => {
    expect(listingFor({ key: "k1", text: JSON.stringify({ files: ["src/a.ts"], key: "k1" }) })).toEqual(["src/a.ts"]);
  });

  it("answers nothing for another index's listing, a malformed one, or text that is not JSON", () => {
    expect(listingFor({ key: "k2", text: JSON.stringify({ files: ["src/a.ts"], key: "k1" }) })).toBeUndefined();
    expect(listingFor({ key: "k1", text: JSON.stringify({ files: [1], key: "k1" }) })).toBeUndefined();
    expect(listingFor({ key: "k1", text: "{" })).toBeUndefined();
  });
});

describe("listingKey", () => {
  it("keeps apart two argvs whose words join to the same string", () => {
    const spaced = listingKey({ argv: ["ls-files", "src a"], identity: "1:2", env: {} });
    const split = listingKey({ argv: ["ls-files", "src", "a"], identity: "1:2", env: {} });
    expect(spaced === split).toBe(false);
  });

  it("keeps apart an argv word carrying the old separator from the identity", () => {
    const bar = listingKey({ argv: ["ls-files|1:2"], identity: "3", env: {} });
    const plain = listingKey({ argv: ["ls-files"], identity: "1:2|3", env: {} });
    expect(bar === plain).toBe(false);
  });

  it("keeps apart one argv under two git settings, and ignores what git never reads", () => {
    const plain = listingKey({ argv: ARGV, env: { HOME: "/h" }, identity: "1:2" });
    expect(listingKey({ argv: ARGV, env: { GIT_ICASE_PATHSPECS: "1" }, identity: "1:2" }) === plain).toBe(false);
    expect(listingKey({ argv: ARGV, env: {}, identity: "1:2" })).toBe(plain);
  });

  it("does not depend on the order the environment lists git's variables in", () => {
    expect(listingKey({ argv: ARGV, env: { GIT_A: "1", GIT_B: "2" }, identity: "1" })).toBe(
      listingKey({ argv: ARGV, env: { GIT_B: "2", GIT_A: "1" }, identity: "1" }),
    );
  });
});

describe("cachedListing", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("asks git once while the index stands still", () => {
    const root = checkout();
    const git = counted({ root });
    const first = cachedListing({ argv: ARGV, env: {}, list: git.list, root });
    const second = cachedListing({ argv: ARGV, env: {}, list: git.list, root });
    expect(second).toEqual(first);
    expect(first).toEqual(["src/a.ts"]);
    expect(git.calls()).toBe(1);
  });

  it("asks git again the moment the index changes, and answers with the new file", () => {
    const root = checkout();
    const git = counted({ root });
    cachedListing({ argv: ARGV, env: {}, list: git.list, root });
    writeFileSync(join(root, "src/b.ts"), "export const b = 2;\n");
    gitInTemp({ args: ["add", "src/b.ts"], cwd: root });
    expect(cachedListing({ argv: ARGV, env: {}, list: git.list, root })).toEqual(["src/a.ts", "src/b.ts"]);
    expect(git.calls()).toBe(2);
  });

  it("asks git again under a git setting the remembered listing was not read under", () => {
    const root = checkout();
    const git = counted({ root });
    cachedListing({ argv: ARGV, env: {}, list: git.list, root });
    cachedListing({ argv: ARGV, env: { GIT_ICASE_PATHSPECS: "1" }, list: git.list, root });
    expect(git.calls()).toBe(2);
  });

  it("never answers one argv's listing for another", () => {
    const root = checkout();
    const git = counted({ root });
    cachedListing({ argv: ARGV, env: {}, list: git.list, root });
    cachedListing({ argv: ["ls-files", "-z", "site"], env: {}, list: git.list, root });
    expect(git.calls()).toBe(2);
  });

  it("asks git every time an environment points it at another index", () => {
    const root = checkout();
    const git = counted({ root });
    const env = { GIT_INDEX_FILE: join(root, "other-index") };
    cachedListing({ argv: ARGV, env, list: git.list, root });
    cachedListing({ argv: ARGV, env, list: git.list, root });
    expect(git.calls()).toBe(2);
  });

  it("answers what git printed when the index cannot be stat'd, rather than throwing", () => {
    const root = checkout();
    const answer = { files: ["from-git"], remember: false };
    chmodSync(join(root, ".git"), 0o600);
    try {
      expect(cachedListing({ argv: ARGV, env: {}, list: () => answer, root })).toEqual(["from-git"]);
    } finally {
      chmodSync(join(root, ".git"), 0o755);
    }
  });

  it("reads past a cache file that is not one, answers a failed listing as git printed it, and never remembers it", () => {
    const root = checkout();
    writeFileSync(join(root, ".git", LISTING_CACHE_FILE), "not json");
    let failures = 0;
    const failing = (): { files: readonly string[]; remember: boolean } => {
      failures += 1;
      return { files: ["src/partial.ts"], remember: false };
    };
    expect(cachedListing({ argv: ARGV, env: {}, list: failing, root })).toEqual(["src/partial.ts"]);
    expect(cachedListing({ argv: ARGV, env: {}, list: failing, root })).toEqual(["src/partial.ts"]);
    expect(failures).toBe(2);
  });
});
