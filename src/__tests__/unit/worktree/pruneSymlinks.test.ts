import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stagedSymlinks, symlinkEditsNow } from "../../../worktree/pruneSymlinks.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../tempGitRepo.js";

const COMMIT = ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-qm"];

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prune-symlinks-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** A repository with a committed symlink `link -> public-A`, at `<dir>/repo`. */
const seedRepo = (): string => {
  const repo = join(dir, "repo");
  mkdirSync(repo);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: repo });
  writeFileSync(join(repo, "public-A"), "public\n");
  symlinkSync("public-A", join(repo, "link"));
  gitInTemp({ args: ["add", "-A"], cwd: repo });
  gitInTemp({ args: [...COMMIT, "base"], cwd: repo });
  return repo;
};

describe("stagedSymlinks", () => {
  it("keeps only paths staged once, as a symlink", () => {
    const staged = new Map<string, readonly string[]>([
      ["link", ["120000 aaa"]],
      ["file", ["100644 bbb"]],
      ["conflicted", ["120000 ccc", "100644 ddd"]],
      ["sub", ["160000 eee"]],
    ]);

    expect(stagedSymlinks({ staged })).toEqual([{ blob: "aaa", file: "link" }]);
  });

  it("finds nothing in an empty index", () => {
    expect(stagedSymlinks({ staged: new Map() })).toEqual([]);
  });
});

describe("symlinkEditsNow (the r3 Codex review)", REAL_GIT_SUITE, () => {
  it("counts zero for a symlink still pointing at its staged target", () => {
    const repo = seedRepo();

    expect(symlinkEditsNow({ path: repo })).toBe(0);
  });

  it("counts a symlink retargeted to a same-length target", () => {
    const repo = seedRepo();
    rmSync(join(repo, "link"));
    symlinkSync("secret-A", join(repo, "link"));

    expect(symlinkEditsNow({ path: repo })).toBe(1);
  });

  it("counts a symlink replaced by a regular file holding the target's bytes", () => {
    const repo = seedRepo();
    rmSync(join(repo, "link"));
    writeFileSync(join(repo, "link"), "public-A");

    expect(symlinkEditsNow({ path: repo })).toBe(1);
  });

  it("counts a missing symlink in a whole tree, and not in a gutted one", () => {
    const repo = seedRepo();
    rmSync(join(repo, "link"));

    expect(symlinkEditsNow({ path: repo })).toBe(1);
    expect(symlinkEditsNow({ gutted: true, path: repo })).toBe(0);
  });

  it("is unreadable when git cannot list the index", () => {
    const repo = seedRepo();

    expect(symlinkEditsNow({ git: () => null, path: repo })).toBe(null);
  });
});
