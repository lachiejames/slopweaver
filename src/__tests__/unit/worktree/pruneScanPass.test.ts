/**
 * The pure decision in `worktree prune`'s scan half.
 *
 * `probePath` is the one that answers from its arguments alone, so it is the one tested here. Its WRONG
 * answer is a free-space reading taken on a filesystem that is not the one being swept, which would report
 * a removal that freed nothing as having freed gigabytes. `selectRepos` reads the profile off disk, so its
 * decision is `admitPruneRepo`, tested here, and its narrowing is covered where the verb runs end to end.
 *
 * The scan cursors are a round trip through a throwaway home, the one filesystem use a unit test may make.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  admitPruneRepo,
  distinctRepos,
  physicalRepoKey,
  probePath,
  readScanCursors,
  writeScanCursors,
} from "../../../cli/commands/worktree/pruneScanPass.js";

describe("probePath", () => {
  it("probes the FIRST repository being swept, because that is where the removals happen", () => {
    expect(probePath({ repos: ["/dev/slopweaver", "/dev/acme-admin"] })).toBe("/dev/slopweaver");
  });

  it("answers / when there is no repository at all, rather than failing a run that frees nothing", () => {
    expect(probePath({ repos: [] })).toBe("/");
  });
});

describe("scan cursors", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "scan-cursors-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reports cursors it cannot write rather than throwing, so the apply that follows still runs", () => {
    writeFileSync(join(home, "worktree-bundles"), "a file where the directory belongs");

    expect(writeScanCursors({ cursors: [], home })).toBe(false);
  });

  it("reads back what an apply wrote, the unreadable-mtime cursor included", () => {
    const cursors = [
      {
        afterColdnessMs: 1_758_000_000_000,
        afterPath: "/dev/acme-admin/.claude/worktrees.noindex/a",
        repoRoot: "/dev/acme-admin",
        waited: 0,
      },
      {
        afterColdnessMs: null,
        afterPath: "/dev/slopweaver/.claude/worktrees.noindex/b",
        repoRoot: "/dev/slopweaver",
        waited: 2,
      },
    ];
    expect(writeScanCursors({ cursors, home })).toBe(true);
    expect(readScanCursors({ home })).toEqual(cursors);
  });

  it("reads no cursors from a home that never wrote any", () => {
    expect(readScanCursors({ home })).toEqual([]);
  });

  it("reads a malformed record as no cursors, so the scan starts coldest-first", () => {
    mkdirSync(join(home, "worktree-bundles"));
    writeFileSync(join(home, "worktree-bundles", "scan-cursors.json"), '[{"repoRoot":1}]\n');
    expect(readScanCursors({ home })).toEqual([]);
  });

  it("reads a torn record that is not JSON at all as no cursors, rather than throwing out of every run", () => {
    mkdirSync(join(home, "worktree-bundles"));
    writeFileSync(join(home, "worktree-bundles", "scan-cursors.json"), "{");
    expect(readScanCursors({ home })).toEqual([]);
  });
});

describe("admitPruneRepo", () => {
  const declared = ["/dev/slopweaver"];

  it("admits a declared checkout with salvage on, without asking about its .git", () => {
    expect(admitPruneRepo({ declared, gitDirIsDirectory: false, noSalvage: false, repo: "/dev/slopweaver" })).toEqual({
      kind: "admitted",
      repo: "/dev/slopweaver",
    });
  });

  it("refuses an undeclared main checkout without --no-salvage, naming the flag that admits it", () => {
    expect(admitPruneRepo({ declared, gitDirIsDirectory: true, noSalvage: false, repo: "/dev/acme-admin" })).toEqual({
      kind: "refused",
      line: "worktree prune: /dev/acme-admin is not a declared main checkout; pass --no-salvage to admit an undeclared main checkout",
    });
  });

  it("refuses an undeclared linked worktree under --no-salvage, since its .git is a file", () => {
    expect(
      admitPruneRepo({ declared, gitDirIsDirectory: false, noSalvage: true, repo: "/dev/acme-admin/.claude/w/a" }),
    ).toEqual({
      kind: "refused",
      line: "worktree prune: /dev/acme-admin/.claude/w/a is not a declared main checkout; --no-salvage admits an undeclared path only when its .git is a directory (a main checkout)",
    });
  });

  it("admits an undeclared main checkout under --no-salvage", () => {
    expect(admitPruneRepo({ declared, gitDirIsDirectory: true, noSalvage: true, repo: "/dev/acme-admin" })).toEqual({
      kind: "admitted",
      repo: "/dev/acme-admin",
    });
  });
});

describe("distinctRepos", () => {
  it("keeps a repository declared twice once, at its first spelling, so no tree is queued twice", () => {
    expect(distinctRepos({ declared: ["/r", "/s", "/r/", "/private/r", "/s"], keyOf: physicalRepoKey })).toEqual([
      "/r",
      "/s",
    ]);
  });

  it("keeps distinct repositories in profile order, a prefix sibling included", () => {
    expect(distinctRepos({ declared: ["/b", "/a", "/a-two"], keyOf: physicalRepoKey })).toEqual(["/b", "/a", "/a-two"]);
  });

  it("keeps a repository declared again through a symlink once, since both spellings are one checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "distinct-repos-"));
    try {
      mkdirSync(join(root, "r"));
      symlinkSync(join(root, "r"), join(root, "r-link"));
      const declared = [join(root, "r"), join(root, "r-link")];
      expect(distinctRepos({ declared, keyOf: physicalRepoKey })).toEqual([join(root, "r")]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps two real repositories whose paths differ only by the worktrees directory's two spellings", () => {
    const root = mkdtempSync(join(tmpdir(), "distinct-repos-"));
    try {
      const declared = [join(root, ".claude/worktrees/repo"), join(root, ".claude/worktrees.noindex/repo")];
      declared.forEach((path) => mkdirSync(path, { recursive: true }));
      expect(distinctRepos({ declared, keyOf: physicalRepoKey })).toEqual(declared);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
