/**
 * A salvage of a tree carrying ANOTHER history than the remote's live trunk refuses before it writes anything — against
 * real git.
 *
 * The incident shape: a checkout keeps its pre-cut history on an `archive` remote beside the public `origin`, and the
 * two share no commit. A cold, dirty tree on an archive branch reaches `salvaged` past the week, and a salvage would
 * push that whole history to origin as one `salvage/…` branch. The fake world in `./salvageGitWorld.ts` scripts the
 * refusal; this file proves git's real root listing and `ls-remote` drive it, with the production `readGit` and a
 * `writeGit` that only records, so no write can happen whatever the code does. The two shapes a merge-base test
 * passed are here too: a branch off the trunk that MERGED the archive in, and a local `origin/HEAD` re-pointed at it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GithubPushEdges } from "../../../admit/githubPush.js";
import { readGit } from "../../../admit/gitTransport.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import { runSalvage } from "../../../worktree/pruneSalvage.js";
import { SalvageTrunkErrors } from "../../../worktree/salvageTrunkErrors.js";
import { pushableSha, trunkHistoryHead } from "../../../worktree/salvageTrunkHistory.js";
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

/** A one-commit repository on `main` holding `<name>.txt`, so two of them share no history and merge cleanly. */
const rootHistory = ({ name }: { name: string }): string => {
  const repo = tempDir({ name });
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: repo });
  writeFileSync(join(repo, `${name}.txt`), `${name}\n`);
  gitInTemp({ args: ["add", "-A"], cwd: repo });
  gitInTemp({ args: [...COMMIT, name], cwd: repo });
  return repo;
};

/** A merge of the archive's history into the tree, the shape a merge-base test passes. */
const MERGE_ARCHIVE = [
  "-c",
  "user.email=a@b.c",
  "-c",
  "user.name=t",
  "merge",
  "-q",
  "--allow-unrelated-histories",
  "--no-edit",
  "archive/main",
] as const;

/**
 * A clone of a public origin, with an archive remote of an unrelated history, and a dirty worktree checked out off
 * `start` — `origin/main` for this repository's own work, `archive/main` for the old history.
 */
const seed = ({ start }: { start: "archive/main" | "origin/main" }): { origin: string; repo: string; tree: string } => {
  const origin = tempDir({ name: "origin" });
  gitInTemp({ args: ["clone", "-q", "--bare", rootHistory({ name: "public" }), origin], cwd: origin });
  const repo = tempDir({ name: "clone" });
  gitInTemp({ args: ["clone", "-q", origin, repo], cwd: repo });
  gitInTemp({ args: ["remote", "add", "archive", rootHistory({ name: "archive" })], cwd: repo });
  gitInTemp({ args: ["fetch", "-q", "archive"], cwd: repo });
  const tree = join(tempDir({ name: "trees" }), "old-work");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "work", tree, start], cwd: repo });
  writeFileSync(join(tree, "f.txt"), "uncommitted edit\n");
  return { origin, repo, tree };
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

/** Salvage `tree` through the recording edges, answering the outcome and every write git was asked for. */
const salvage = ({ tree }: { tree: string }): { outcome: ReturnType<typeof runSalvage>; writes: string[] } => {
  const { deps, writes } = edges();
  const outcome = runSalvage({
    deps,
    denylist: ABSENT,
    home: HOME_WITHOUT_PUSH_ROOTS,
    remote: "origin",
    scan: NO_SECRETS,
    verdict: verdictAt({ path: tree }),
  });
  return { outcome, writes };
};

const FOREIGN_DECLINE = {
  branch: null,
  declined:
    "its history reaches 1 root commit(s) origin's live trunk does not, so it carries another history — nothing was pushed",
};

describe("a salvage of another history", REAL_GIT_SUITE, () => {
  it("refuses a tree whose HEAD is on the archive's history, and asks git to write nothing", () => {
    const { tree } = seed({ start: "archive/main" });
    const { outcome, writes } = salvage({ tree });
    expect(outcome).toEqual(FOREIGN_DECLINE);
    expect(writes).toEqual([]);
  });

  it("refuses a branch off origin's trunk that MERGED the archive in, though it shares a merge base with the trunk", () => {
    const { repo, tree } = seed({ start: "origin/main" });
    gitInTemp({ args: [...MERGE_ARCHIVE], cwd: tree });
    // The control: this HEAD does share a merge base with origin's trunk, which is the test that used to pass it.
    expect(gitInTemp({ args: ["merge-base", "HEAD", "origin/main"], cwd: tree })).toBe(
      gitInTemp({ args: ["rev-parse", "origin/main"], cwd: repo }),
    );
    const { outcome, writes } = salvage({ tree });
    expect(outcome).toEqual(FOREIGN_DECLINE);
    expect(writes).toEqual([]);
  });

  it("refuses an archive tree when the local origin/HEAD was re-pointed at the archive, reading the remote's own HEAD", () => {
    const { repo, tree } = seed({ start: "archive/main" });
    gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/archive/main"], cwd: repo });
    // The control: the local symref now names the archive, so a check reading it would see shared history.
    expect(gitInTemp({ args: ["merge-base", "HEAD", "refs/remotes/origin/HEAD"], cwd: tree })).toBe(
      gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree }),
    );
    const { outcome, writes } = salvage({ tree });
    expect(outcome).toEqual(FOREIGN_DECLINE);
    expect(writes).toEqual([]);
  });

  it("refuses when origin cannot be asked for its HEAD, failing closed before any write", () => {
    const { repo, tree } = seed({ start: "origin/main" });
    gitInTemp({ args: ["remote", "set-url", "origin", join(repo, "no-such-remote")], cwd: repo });
    const { outcome, writes } = salvage({ tree });
    expect(outcome.declined).toContain("origin's live trunk could not be read (");
    expect(writes).toEqual([]);
  });

  it("passes the history check for a tree off origin's own trunk, so its first write mints the salvage branch", () => {
    const { tree } = seed({ start: "origin/main" });
    const { writes } = salvage({ tree });
    const head = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree });
    expect(writes[0]).toBe(
      `-c core.hooksPath=/dev/null -c core.fsmonitor=false branch salvage/old-work-${head.slice(0, 8)} ${head}`,
    );
  });
});

describe("pushableSha", REAL_GIT_SUITE, () => {
  it("declines a tree reset off the checked HEAD before the push", () => {
    const { tree } = seed({ start: "origin/main" });
    gitInTemp({ args: ["add", "-A"], cwd: tree });
    gitInTemp({ args: [...COMMIT, "checked"], cwd: tree });
    const checked = unwrap(trunkHistoryHead({ deps: edges().deps, path: tree, remote: "origin" }));
    // Another process resets the tree to the checked commit's parent, a commit the check never accepted as the push.
    gitInTemp({ args: ["reset", "-q", "--hard", "HEAD~1"], cwd: tree });
    const pushed = pushableSha({ checked, deps: edges().deps, path: tree, remote: "origin" });
    expect(unwrapErr(pushed)).toEqual(SalvageTrunkErrors.notDescendant());
  });

  it("declines a commit that descends from the checked HEAD but merged the archive in after the check", () => {
    const { tree } = seed({ start: "origin/main" });
    const checked = unwrap(trunkHistoryHead({ deps: edges().deps, path: tree, remote: "origin" }));
    gitInTemp({ args: [...MERGE_ARCHIVE], cwd: tree });
    const pushed = pushableSha({ checked, deps: edges().deps, path: tree, remote: "origin" });
    expect(unwrapErr(pushed).code).toBe("FOREIGN_ROOT");
  });

  it("names a merge-base that FAILED (exit 128) as unreadable ancestry, never as a descent verdict", () => {
    const { tree } = seed({ start: "origin/main" });
    const checked = unwrap(trunkHistoryHead({ deps: edges().deps, path: tree, remote: "origin" }));
    // A checked HEAD this repository holds no object for: git answers `fatal: Not a valid commit name`, exit 128.
    const absent = { ...checked, head: "0123456789abcdef0123456789abcdef01234567" };
    const pushed = pushableSha({ checked: absent, deps: edges().deps, path: tree, remote: "origin" });
    expect(unwrapErr(pushed).code).toBe("ANCESTRY_UNREADABLE");
    expect(unwrapErr(pushed).message).toContain(`whether ${checked.head.slice(0, 8)} descends from the checked HEAD`);
  });
});

describe("trunkHistoryHead", REAL_GIT_SUITE, () => {
  it("answers the HEAD, the remote's live trunk and the url it was read from, for a commit on that trunk", () => {
    const { origin, tree } = seed({ start: "origin/main" });
    const head = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree });
    expect(unwrap(trunkHistoryHead({ deps: edges().deps, path: tree, remote: "origin" }))).toEqual({
      head,
      trunk: head,
      url: origin,
    });
  });

  it("declines a remote that is not configured as an unbound destination, before any trunk is asked", () => {
    const { tree } = seed({ start: "origin/main" });
    const checked = trunkHistoryHead({ deps: edges().deps, path: tree, remote: "nowhere" });
    expect(unwrapErr(checked).code).toBe("DESTINATION_UNBOUND");
  });

  it("declines a repository carrying a grafts file, which would otherwise pass an archive commit grafted onto the trunk", () => {
    const { repo, tree } = seed({ start: "archive/main" });
    const publicRoot = gitInTemp({ args: ["rev-parse", "origin/main"], cwd: repo });
    const archiveHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree });
    const graftFile = resolve(tree, gitInTemp({ args: ["rev-parse", "--git-path", "info/grafts"], cwd: tree }));
    mkdirSync(dirname(graftFile), { recursive: true });
    writeFileSync(graftFile, `${archiveHead} ${publicRoot}\n`);
    // The control: with the graft read, the archive commit's only root IS the public one, so a root test alone passes.
    expect(gitInTemp({ args: ["rev-list", "--max-parents=0", "HEAD"], cwd: tree })).toBe(publicRoot);
    const checked = trunkHistoryHead({ deps: edges().deps, path: tree, remote: "origin" });
    expect(unwrapErr(checked)).toEqual(SalvageTrunkErrors.grafted({ graftFile }));
  });

  it("declines a tree git cannot read at all, naming `git rev-parse HEAD`", () => {
    const checked = trunkHistoryHead({ deps: edges().deps, path: tempDir({ name: "not-a-repo" }), remote: "origin" });
    expect(unwrapErr(checked).code).toBe("HEAD_UNREADABLE");
    expect(unwrapErr(checked).message).toContain("`git rev-parse HEAD` could not name its HEAD commit (");
  });
});
