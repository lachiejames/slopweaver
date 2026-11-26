/**
 * The verb's own argument handling — the paths that must decide BEFORE any git, filesystem or socket work,
 * because a caller who mistyped a flag should get a usage error rather than a seven-minute scan.
 */
import { describe, expect, it } from "vitest";

import { liveReferenceIndex, WORKTREE_FLAG_NAMES, worktreeUsage } from "../../../cli/commands/worktree/core.js";
import { runWorktreePrune } from "../../../cli/commands/worktree/pruneRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";

const argv = ({ rest }: { rest: readonly string[] }) => ["node", "slopweaver", "worktree", "prune", ...rest];

describe("runWorktreePrune argument handling", () => {
  it("prints usage and exits clean on --help, without reading a repository", async () => {
    expect(await runWorktreePrune(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
    expect(await runWorktreePrune(argv({ rest: ["-h"] }))).toBe(EXIT_OK);
  });

  it("rejects an unknown flag as a usage error", async () => {
    expect(await runWorktreePrune(argv({ rest: ["--delete-everything"] }))).toBe(EXIT_USAGE);
  });

  it("rejects an --older-than it cannot parse, before it touches anything", async () => {
    expect(await runWorktreePrune(argv({ rest: ["--older-than", "24 hours"] }))).toBe(EXIT_USAGE);
    expect(await runWorktreePrune(argv({ rest: ["--older-than", "0h"] }))).toBe(EXIT_USAGE);
  });

  it("rejects a --repo that is not a declared main checkout rather than sweeping them all", async () => {
    expect(await runWorktreePrune(argv({ rest: ["--repo", "/definitely/not/a/declared/checkout"] }))).toBe(EXIT_USAGE);
  });

  it("rejects an undeclared --repo with no .git directory even under --no-salvage, before any git work", async () => {
    expect(
      await runWorktreePrune(argv({ rest: ["--repo", "/definitely/not/a/declared/checkout", "--no-salvage"] })),
    ).toBe(EXIT_USAGE);
  });
});

describe("worktreeUsage", () => {
  it("renders every real flag, values marked, from the parser's own spec", () => {
    expect(worktreeUsage({ verb: "prune" })).toBe(
      "usage: slopweaver worktree prune [--apply] [--budget <value>] [--if-idle] [--include-unmarked-lap] [--json] [--merged-only] [--no-salvage] [--nuke-after <value>] [--older-than <value>] [--repo <value>] [--scan-budget <value>]",
    );
  });

  it("declares exactly the flags the manifest's usage line advertises", () => {
    expect(WORKTREE_FLAG_NAMES["prune"]).toEqual([
      "--apply",
      "--budget",
      "--if-idle",
      "--include-unmarked-lap",
      "--json",
      "--merged-only",
      "--no-salvage",
      "--nuke-after",
      "--older-than",
      "--repo",
      "--scan-budget",
    ]);
  });

  it("rejects a --scan-budget it cannot parse, before it touches anything", async () => {
    expect(await runWorktreePrune(argv({ rest: ["--scan-budget", "ten minutes"] }))).toBe(EXIT_USAGE);
    expect(await runWorktreePrune(argv({ rest: ["--scan-budget", "0m"] }))).toBe(EXIT_USAGE);
  });

  it("renders an empty usage line for a verb with no spec, rather than inventing flags", () => {
    expect(worktreeUsage({ verb: "nonexistent" })).toBe("usage: slopweaver worktree nonexistent");
  });
});

describe("the verb's live-state join is the one in core", () => {
  it("is reachable from the command module's own import surface", () => {
    expect(liveReferenceIndex({ cwds: new Map(), sessions: [], workspaces: [] }).size).toBe(0);
  });
});
