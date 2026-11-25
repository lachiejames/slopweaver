/*
 * Branch continuity over real git (`src/codex/branchContinuityGit.ts`, `src/codex/landingBranchEvidence.ts`): each
 * case builds a throwaway repository, makes the rename or the cut the way a session would, and reads it back
 * through the production edge, so what is proven is the reflog git actually writes.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readBranchContinuity, readBranchEvidence } from "../../../codex/branchContinuityGit.js";
import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import { landingBranchEvidence } from "../../../codex/landingBranchEvidence.js";
import type { LedgerScan } from "../../../codex/ledgerStore.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import { unwrap } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";
import { HEAD, planRecord, treeOn } from "./ledger/fixtures.js";

const TARGET = "feature/abc-1";
const DRAFT = "feature/abc-1-draft";
const SECOND = "feature/abc-2";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh directory under the per-file temp root, removed after the case. */
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "branch-continuity-"));
  dirs.push(dir);
  return dir;
}

/** Run git in `cwd` with a fixed identity, so a commit needs no ambient configuration. */
function git({ cwd, args }: { cwd: string; args: readonly string[] }): string {
  return gitInTemp({ args: ["-c", "user.name=acme", "-c", "user.email=dev@acme.example", ...args], cwd });
}

/** Commit one file change in `cwd`. */
function commit({ cwd, name }: { cwd: string; name: string }): void {
  writeFileSync(join(cwd, `${name}.txt`), `${name}\n`);
  git({ args: ["add", "."], cwd });
  git({ args: ["commit", "-q", "-m", name], cwd });
}

/**
 * A repository on `main` with one commit, at its canonical path, whose `origin` names `main` its default branch
 * unless a case asks for a repository with no remote default at all.
 */
function seededRepo({ remoteDefault = true }: { remoteDefault?: boolean } = {}): string {
  const repo = join(freshDir(), "acme");
  mkdirSync(repo);
  git({ args: ["init", "-q", "-b", "main"], cwd: repo });
  commit({ cwd: repo, name: "seed" });
  if (remoteDefault) {
    git({ args: ["update-ref", "refs/remotes/origin/main", "HEAD"], cwd: repo });
    git({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], cwd: repo });
  }
  return realpathSync(repo);
}

/** An empty receipt scan. */
const NO_RECEIPTS: FallbackReceiptScan = {
  foreign: 0,
  foreignModes: [],
  foreignReceipts: [],
  pending: 0,
  pendingPlans: 0,
  planReceipts: [],
  problems: [],
  receipts: [],
  unboundReceipts: [],
  unreadable: 0,
};

/** A scan holding one plan record taken on `branch` (default {@link DRAFT}) in `repoRoot`, before any git work. */
function draftScan({ repoRoot, branch = DRAFT }: { repoRoot: string; branch?: string }): LedgerScan {
  const record: CodexArtifactRecord = {
    ...planRecord({
      createdAtIso: "2020-01-01T00:00:00.000Z",
      pass: "p2",
      tree: treeOn({ branch, headSha: HEAD, patch: "" }),
    }),
    repoRoot,
  };
  return { records: [record], unreadable: 0, withoutSidecar: 0 };
}

describe("readBranchContinuity over real git", REAL_GIT_SUITE, () => {
  it(
    "reads a rename as a predecessor in every checkout",
    () => {
      const repo = seededRepo();
      git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
      commit({ cwd: repo, name: "draft" });
      git({ args: ["branch", "-m", TARGET], cwd: repo });
      const continuity = unwrap(readBranchContinuity({ cwd: repo, target: TARGET }));
      expect(continuity.windows.filter((window) => window.branch === DRAFT).map((window) => window.root)).toEqual([
        undefined,
      ]);
      expect([...continuity.roots]).toEqual([repo]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reads a branch cut from the checked-out one as a predecessor in that checkout",
    () => {
      const repo = seededRepo();
      git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
      commit({ cwd: repo, name: "draft" });
      git({ args: ["checkout", "-q", "-b", TARGET], cwd: repo });
      const continuity = unwrap(readBranchContinuity({ cwd: repo, target: TARGET }));
      expect(continuity.windows.filter((window) => window.branch === DRAFT).map((window) => window.root)).toEqual([
        repo,
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reads a cut made in a linked checkout that has since moved off, from the main checkout",
    () => {
      const repo = seededRepo();
      const linkedPath = join(freshDir(), "acme-two");
      git({ args: ["worktree", "add", "-q", "-b", DRAFT, linkedPath], cwd: repo });
      const linked = realpathSync(linkedPath);
      commit({ cwd: linked, name: "draft" });
      git({ args: ["checkout", "-q", "-b", TARGET], cwd: linked });
      git({ args: ["checkout", "-q", "--detach"], cwd: linked });
      const continuity = unwrap(readBranchContinuity({ cwd: repo, target: TARGET }));
      expect(continuity.windows.filter((window) => window.branch === DRAFT).map((window) => window.root)).toEqual([
        linked,
      ]);
      expect([...continuity.roots].toSorted()).toEqual([repo, linked].toSorted());
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses, rather than dropping the cuts its HEAD reflog proves, when one linked checkout's record is unreadable",
    () => {
      const repo = seededRepo();
      const linkedPath = join(freshDir(), "acme-two");
      git({ args: ["worktree", "add", "-q", "-b", DRAFT, linkedPath], cwd: repo });
      const linked = realpathSync(linkedPath);
      commit({ cwd: linked, name: "draft" });
      git({ args: ["checkout", "-q", "-b", TARGET], cwd: linked });
      git({ args: ["checkout", "-q", "--detach"], cwd: linked });
      rmSync(join(repo, ".git", "worktrees", "acme-two", "gitdir"));
      const read = readBranchContinuity({ cwd: repo, target: TARGET });
      expect(read._unsafeUnwrapErr().code).toBe("WORKTREES_UNREADABLE");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reads an ordinary checkout of an existing branch as no predecessor",
    () => {
      const repo = seededRepo();
      git({ args: ["branch", TARGET], cwd: repo });
      git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
      git({ args: ["checkout", "-q", TARGET], cwd: repo });
      expect(unwrap(readBranchContinuity({ cwd: repo, target: TARGET })).windows).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "never reads the default branch as a predecessor of a branch cut from it",
    () => {
      const repo = seededRepo();
      git({ args: ["checkout", "-q", "-b", TARGET], cwd: repo });
      expect(unwrap(readBranchContinuity({ cwd: repo, target: TARGET })).windows).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reads no predecessor at all in a repository whose remotes name no default branch",
    () => {
      const repo = seededRepo({ remoteDefault: false });
      git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
      git({ args: ["branch", "-m", TARGET], cwd: repo });
      expect(unwrap(readBranchContinuity({ cwd: repo, target: TARGET })).windows).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reads no predecessor once the reflog that proved the rename has expired",
    () => {
      const repo = seededRepo();
      git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
      git({ args: ["branch", "-m", TARGET], cwd: repo });
      git({ args: ["reflog", "expire", "--expire=now", "--all"], cwd: repo });
      expect(unwrap(readBranchContinuity({ cwd: repo, target: TARGET })).windows).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses, rather than reading as no predecessor, where there is no repository",
    () => {
      const read = readBranchContinuity({ cwd: freshDir(), target: TARGET });
      expect(read._unsafeUnwrapErr().code).toBe("REFLOG_UNREADABLE");
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe("readBranchEvidence over real git", REAL_GIT_SUITE, () => {
  it(
    "shows a renamed branch's record under its new name",
    () => {
      const repo = seededRepo();
      git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
      git({ args: ["branch", "-m", TARGET], cwd: repo });
      const evidence = unwrap(
        readBranchEvidence({ branch: TARGET, cwd: repo, receipts: NO_RECEIPTS, scan: draftScan({ repoRoot: repo }) }),
      );
      expect(evidence.scan.records.map((record) => record.tree!.branch)).toEqual([TARGET]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "gives the second of two branches cut from one none of the evidence from before the first cut",
    () => {
      // Whether the two cuts land in one second or two, the pass before both belongs to the second cut never: in
      // two seconds it falls before the second's window opens, and in one the cuts cannot be ordered at all.
      const repo = seededRepo();
      git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
      commit({ cwd: repo, name: "draft" });
      git({ args: ["checkout", "-q", "-b", TARGET], cwd: repo });
      git({ args: ["checkout", "-q", DRAFT], cwd: repo });
      git({ args: ["checkout", "-q", "-b", SECOND], cwd: repo });
      const evidence = unwrap(
        readBranchEvidence({ branch: SECOND, cwd: repo, receipts: NO_RECEIPTS, scan: draftScan({ repoRoot: repo }) }),
      );
      expect(evidence.scan.records.map((record) => record.tree!.branch)).toEqual([DRAFT]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "leaves a pass taken on the default branch there when a branch is cut from it",
    () => {
      const repo = seededRepo();
      git({ args: ["checkout", "-q", "-b", TARGET], cwd: repo });
      const scan = draftScan({ branch: "main", repoRoot: repo });
      const evidence = unwrap(readBranchEvidence({ branch: TARGET, cwd: repo, receipts: NO_RECEIPTS, scan }));
      expect(evidence.scan.records.map((record) => record.tree!.branch)).toEqual(["main"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "leaves the default branch's pass there when its remote HEAD dangles and another remote's HEAD is sound",
    () => {
      const repo = seededRepo();
      git({ args: ["update-ref", "-d", "refs/remotes/origin/main"], cwd: repo });
      git({ args: ["update-ref", "refs/remotes/upstream/trunk", "HEAD"], cwd: repo });
      git({ args: ["symbolic-ref", "refs/remotes/upstream/HEAD", "refs/remotes/upstream/trunk"], cwd: repo });
      git({ args: ["checkout", "-q", "-b", TARGET], cwd: repo });
      const scan = draftScan({ branch: "main", repoRoot: repo });
      const evidence = unwrap(readBranchEvidence({ branch: TARGET, cwd: repo, receipts: NO_RECEIPTS, scan }));
      expect(evidence.scan.records.map((record) => record.tree!.branch)).toEqual(["main"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "returns the error, rather than carrying nothing, when a remote HEAD on disk cannot be read",
    () => {
      const repo = seededRepo();
      git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
      git({ args: ["branch", "-m", TARGET], cwd: repo });
      writeFileSync(join(repo, ".git", "refs", "remotes", "origin", "HEAD"), "not a ref\n");
      const read = readBranchEvidence({
        branch: TARGET,
        cwd: repo,
        receipts: NO_RECEIPTS,
        scan: draftScan({ repoRoot: repo }),
      });
      expect(read._unsafeUnwrapErr().code).toBe("REMOTES_UNREADABLE");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "leaves a renamed branch's pass on its old name once the reflog has expired",
    () => {
      const repo = seededRepo();
      git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
      git({ args: ["branch", "-m", TARGET], cwd: repo });
      git({ args: ["reflog", "expire", "--expire=now", "--all"], cwd: repo });
      const evidence = unwrap(
        readBranchEvidence({ branch: TARGET, cwd: repo, receipts: NO_RECEIPTS, scan: draftScan({ repoRoot: repo }) }),
      );
      expect(evidence.scan.records.map((record) => record.tree!.branch)).toEqual([DRAFT]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "returns the error when a row names another branch and the reflogs cannot be read",
    () => {
      const read = readBranchEvidence({
        branch: TARGET,
        cwd: freshDir(),
        receipts: NO_RECEIPTS,
        scan: draftScan({ repoRoot: "/w/acme" }),
      });
      expect(read._unsafeUnwrapErr().code).toBe("REFLOG_UNREADABLE");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "asks no git when no row names another branch, so a root that is no repository still reads",
    () => {
      const scan: LedgerScan = { records: [], unreadable: 0, withoutSidecar: 0 };
      const evidence = unwrap(readBranchEvidence({ branch: TARGET, cwd: freshDir(), receipts: NO_RECEIPTS, scan }));
      expect(evidence.scan).toBe(scan);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe("landingBranchEvidence over real git", REAL_GIT_SUITE, () => {
  /** A renamed branch in a checkout whose `origin` is acme/widgets. */
  function renamedCheckout(): string {
    const repo = seededRepo();
    git({ args: ["remote", "add", "origin", "https://github.com/acme/widgets.git"], cwd: repo });
    git({ args: ["checkout", "-q", "-b", DRAFT], cwd: repo });
    git({ args: ["branch", "-m", TARGET], cwd: repo });
    return repo;
  }

  /** The pull request a case lands. */
  const head = ({ repository }: { repository: string }) => ({
    baseSha: undefined,
    branch: TARGET,
    headSha: HEAD,
    repository,
  });

  it(
    "reads the reflogs of the verb's own checkout when its origin is the pull request's repository",
    () => {
      const repo = renamedCheckout();
      const evidence = unwrap(
        landingBranchEvidence({
          cwd: repo,
          head: head({ repository: "acme/widgets" }),
          receipts: NO_RECEIPTS,
          scan: draftScan({ repoRoot: repo }),
        }),
      );
      expect(evidence.scan.records.map((record) => record.tree!.branch)).toEqual([TARGET]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "relabels nothing when no candidate checkout is of the pull request's repository",
    () => {
      const repo = renamedCheckout();
      const evidence = unwrap(
        landingBranchEvidence({
          cwd: repo,
          head: head({ repository: "acme/other" }),
          receipts: NO_RECEIPTS,
          scan: draftScan({ repoRoot: repo }),
        }),
      );
      expect(evidence.scan.records.map((record) => record.tree!.branch)).toEqual([DRAFT]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
