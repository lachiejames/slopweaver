import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { renderNoindexReport, runWorktreeNoindex } from "../../../cli/commands/worktree/noindexRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import { readWorktreesDirFacts } from "../../../worktree/location.js";

describe("renderNoindexReport", () => {
  it("leads with the outcome, then one line per step taken", () => {
    expect(renderNoindexReport({ repoRoot: "/r", steps: ["rename-alias-to-dir", "create-alias"] })).toEqual([
      "made Spotlight-safe: /r/.claude/worktrees -> /r/.claude/worktrees.noindex",
      "  renamed the real `worktrees` directory to `worktrees.noindex`",
      "  created the `worktrees` symlink to `worktrees.noindex`",
    ]);
  });

  it("says so when nothing needed doing", () => {
    expect(renderNoindexReport({ repoRoot: "/r", steps: [] })).toEqual([
      "already Spotlight-safe: /r/.claude/worktrees -> /r/.claude/worktrees.noindex",
    ]);
  });
});

describe("runWorktreeNoindex against a scratch checkout", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("repairs the layout of the --repo it is given and reports success", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "slopweaver-noindex-verb-"));
    roots.push(repoRoot);
    mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
    expect(runWorktreeNoindex(["node", "cli", "worktree", "noindex", "--repo", repoRoot, "--json"])).toBe(EXIT_OK);
    expect(readWorktreesDirFacts({ repoRoot })).toEqual({
      dir: "directory",
      link: "symlink",
      linkTarget: "worktrees.noindex",
    });
  });

  it("exits non-zero and touches nothing when the layout conflicts", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "slopweaver-noindex-verb-"));
    roots.push(repoRoot);
    mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
    mkdirSync(join(repoRoot, ".claude", "worktrees.noindex"), { recursive: true });
    expect(runWorktreeNoindex(["node", "cli", "worktree", "noindex", "--repo", repoRoot])).toBe(EXIT_ERROR);
    expect(readWorktreesDirFacts({ repoRoot })).toEqual({ dir: "directory", link: "directory", linkTarget: undefined });
  });
});
