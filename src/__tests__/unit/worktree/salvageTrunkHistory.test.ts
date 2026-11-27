/**
 * A salvage of a tree on ANOTHER history than the remote's trunk refuses before it writes anything — against real git.
 *
 * The incident shape: a checkout keeps its pre-cut history on an `archive` remote beside the public `origin`, and the
 * two share no commit. A cold, dirty tree on an archive branch reaches `salvaged` past the week, and a salvage would
 * push that whole history to origin as one `salvage/…` branch. The fake world in `./salvageGitWorld.ts` scripts the
 * refusal; this file proves git's real `merge-base` exit drives it, with the production `readGit` and a `writeGit`
 * that only records, so no write can happen whatever the code does.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GithubPushEdges } from "../../../admit/githubPush.js";
import { readGit } from "../../../admit/gitTransport.js";
import { ok } from "../../../lib/result.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import { runSalvage } from "../../../worktree/pruneSalvage.js";
import { unrelatedHistoryDecline } from "../../../worktree/salvageTrunkHistory.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../pushRootFixture.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../tempGitRepo.js";
import { COMMIT } from "./pruneReclaim/harness.js";
import { ABSENT, NO_SECRETS } from "./salvageGitWorld.js";

const dirs: string[] = [];

afterEach(() => {
  for (const each of dirs.splice(0)) {
    rmSync(each, { force: true, recursive: true });
  }
});

/** A fresh temp directory this file removes after each case. */
const tempDir = ({ name }: { name: string }): string => {
  const made = mkdtempSync(join(tmpdir(), `sw-unrelated-${name}-`));
  dirs.push(made);
  return made;
};

/** A one-commit repository on `main` whose single file carries `text`, so two of them share no history. */
const rootHistory = ({ name, text }: { name: string; text: string }): string => {
  const repo = tempDir({ name });
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: repo });
  writeFileSync(join(repo, "f.txt"), text);
  gitInTemp({ args: ["add", "-A"], cwd: repo });
  gitInTemp({ args: [...COMMIT, text], cwd: repo });
  return repo;
};

/**
 * A clone of a public origin, with an archive remote of an unrelated history, and a dirty worktree checked out off
 * `start` — `origin/main` for this repository's own work, `archive/main` for the old history.
 */
const seed = ({ start }: { start: "archive/main" | "origin/main" }): { tree: string } => {
  const origin = tempDir({ name: "origin" });
  gitInTemp({
    args: ["clone", "-q", "--bare", rootHistory({ name: "public", text: "public\n" }), origin],
    cwd: origin,
  });
  const repo = tempDir({ name: "clone" });
  gitInTemp({ args: ["clone", "-q", origin, repo], cwd: repo });
  gitInTemp({ args: ["remote", "add", "archive", rootHistory({ name: "archive", text: "old history\n" })], cwd: repo });
  gitInTemp({ args: ["fetch", "-q", "archive"], cwd: repo });
  const tree = join(tempDir({ name: "trees" }), "old-work");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "work", tree, start], cwd: repo });
  writeFileSync(join(tree, "f.txt"), "uncommitted edit\n");
  return { tree };
};

/** The production read edge, and a write edge that records each argv and changes nothing. */
const edges = (): { deps: GithubPushEdges; writes: string[] } => {
  const writes: string[] = [];
  return {
    deps: {
      out: () => undefined,
      readGit,
      writeGit: ({ args }) => {
        writes.push(args.join(" "));
        return ok(undefined);
      },
    },
    writes,
  };
};

const verdictAt = ({ path }: { path: string }): PruneVerdict => ({
  branch: "work",
  cls: "salvaged",
  deleteBranch: false,
  diskKib: null,
  dropsDeps: false,
  path,
  reason: "1 uncommitted change(s), untouched 10d",
});

describe("a salvage of another history", REAL_GIT_SUITE, () => {
  it("refuses a tree whose HEAD shares no commit with origin's trunk, and asks git to write nothing", () => {
    const { tree } = seed({ start: "archive/main" });
    const { deps, writes } = edges();

    const outcome = runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict: verdictAt({ path: tree }),
    });

    expect(outcome).toEqual({
      branch: null,
      declined:
        "its HEAD shares no history with origin's trunk (refs/remotes/origin/HEAD), or that trunk could not be read — nothing was pushed",
    });
    expect(writes).toEqual([]);
  });

  it("passes the history check for a tree off origin's own trunk, so its first write mints the salvage branch", () => {
    const { tree } = seed({ start: "origin/main" });
    const { deps, writes } = edges();

    runSalvage({
      deps,
      denylist: ABSENT,
      home: HOME_WITHOUT_PUSH_ROOTS,
      remote: "origin",
      scan: NO_SECRETS,
      verdict: verdictAt({ path: tree }),
    });

    const head = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree });
    expect(writes[0]).toBe(
      `-c core.hooksPath=/dev/null -c core.fsmonitor=false branch salvage/old-work-${head.slice(0, 8)} ${head}`,
    );
  });
});

describe("unrelatedHistoryDecline", REAL_GIT_SUITE, () => {
  it("answers null for a commit on origin's own trunk", () => {
    const { tree } = seed({ start: "origin/main" });
    const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree });
    expect(unrelatedHistoryDecline({ deps: edges().deps, headSha, path: tree, remote: "origin" })).toBe(null);
  });

  it("declines the archive's commit, which shares no merge base with origin's trunk", () => {
    const { tree } = seed({ start: "archive/main" });
    const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree });
    expect(unrelatedHistoryDecline({ deps: edges().deps, headSha, path: tree, remote: "origin" })).toBe(
      "its HEAD shares no history with origin's trunk (refs/remotes/origin/HEAD), or that trunk could not be read — nothing was pushed",
    );
  });

  it("declines when the remote's trunk ref is absent, rather than reading a missing trunk as shared history", () => {
    // No remote of this name was ever fetched, so `refs/remotes/nowhere/HEAD` does not resolve. (A fetched remote is
    // no stand-in: git's `followRemoteHEAD` writes that symref on fetch, measured on this suite's own `archive`.)
    const { tree } = seed({ start: "origin/main" });
    const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree });
    expect(unrelatedHistoryDecline({ deps: edges().deps, headSha, path: tree, remote: "nowhere" })).toBe(
      "its HEAD shares no history with nowhere's trunk (refs/remotes/nowhere/HEAD), or that trunk could not be read — nothing was pushed",
    );
  });
});
