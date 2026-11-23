/**
 * `gitAncestry.ts` — real-git proof of the two bugs this module fixes: a same-named local branch shadowing
 * a raw SHA passed to `merge-base --is-ancestor`, and a private fetch ref whose name was previously unknown
 * to the caller until AFTER a successful fetch. `gitInTemp` per `src/__tests__/tempGitRepo.ts` — a test may
 * not shell git any other way.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import {
  countCommitsAhead,
  deletePrivateRef,
  fetchBranchIntoPrivateRef,
  isAncestor,
  newPrivateFetchRef,
} from "../../../../../cli/commands/github/gitAncestry.js";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A bare repository, matching how this tool actually reads a GitHub remote. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "git-ancestry-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-b", "main"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: dir });
  return dir;
}

function commit({
  dir,
  file,
  content,
  message,
}: {
  dir: string;
  file: string;
  content: string;
  message: string;
}): string {
  writeFileSync(join(dir, file), content);
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-m", message], cwd: dir });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
}

const realGit: GithubPushDeps = {
  cwd: () => "",
  doorLedger: memoryDoorLedger().port,
  out: () => {},
  readGit: ({ cwd, args }) => gitInTemp({ args, cwd }),
  writeGit: ({ cwd, args }) => {
    try {
      gitInTemp({ args, cwd });
      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error.message : String(error));
    }
  },
};

describe("isAncestor", () => {
  it(
    "reports true when the ancestor commit is genuinely reachable from the descendant",
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      const dir = initRepo();
      const first = commit({ content: "a", dir, file: "f.txt", message: "first" });
      const second = commit({ content: "b", dir, file: "f.txt", message: "second" });
      expect(unwrap(isAncestor({ ancestor: first, cwd: dir, descendant: second }))).toBe(true);
    },
  );

  it("reports false when the two commits share no such relationship", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const dir = initRepo();
    const first = commit({ content: "a", dir, file: "f.txt", message: "first" });
    gitInTemp({ args: ["checkout", "-b", "other", first], cwd: dir });
    const sibling = commit({ content: "c", dir, file: "g.txt", message: "sibling" });
    gitInTemp({ args: ["checkout", "main"], cwd: dir });
    const second = commit({ content: "b", dir, file: "f.txt", message: "second" });
    expect(unwrap(isAncestor({ ancestor: second, cwd: dir, descendant: sibling }))).toBe(false);
  });

  it(
    "cannot be shadowed by a local branch whose name is the exact 40-hex ancestor SHA",
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      const dir = initRepo();
      const first = commit({ content: "a", dir, file: "f.txt", message: "first" });
      const second = commit({ content: "b", dir, file: "f.txt", message: "second" });
      // A branch NAMED with the real ancestor's own SHA, but pointed at the unrelated sibling commit — the
      // exact adversarial shape a raw (unpeeled) revision argument can be tricked into resolving to.
      gitInTemp({ args: ["checkout", "-b", "shadow", first], cwd: dir });
      const shadowTarget = commit({ content: "shadow", dir, file: "h.txt", message: "shadow target" });
      gitInTemp({ args: ["branch", first, shadowTarget], cwd: dir });
      // Without ^{commit} peeling, `merge-base --is-ancestor <first> <second>` would resolve `<first>` to the
      // branch named `first` (pointing at shadowTarget) rather than the commit object `first` itself.
      expect(unwrap(isAncestor({ ancestor: first, cwd: dir, descendant: second }))).toBe(true);
    },
  );

  it(
    "returns Err, never Ok(false), for an execution fault rather than a real ancestry answer",
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      const dir = initRepo();
      commit({ content: "a", dir, file: "f.txt", message: "first" });
      const result = isAncestor({
        ancestor: "0000000000000000000000000000000000000000",
        cwd: dir,
        descendant: "HEAD",
      });
      expect(result.isErr()).toBe(true);
      expect(githubVerbErrorLines({ error: unwrapErr(result) }).join(" ")).toContain(
        "git merge-base --is-ancestor failed",
      );
    },
  );
});

describe("newPrivateFetchRef", () => {
  it("mints unique refs under this tool's own private namespace", () => {
    const first = newPrivateFetchRef();
    const second = newPrivateFetchRef();
    expect(first).toMatch(/^refs\/slopweaver\/fetch\/[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });
});

describe("fetchBranchIntoPrivateRef and deletePrivateRef", () => {
  it(
    "fetches a branch's live tip into the given ref and resolves its exact SHA",
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      const remoteDir = mkdtempSync(join(tmpdir(), "git-ancestry-remote-"));
      fixtureDirs.push(remoteDir);
      gitInTemp({ args: ["init", "--bare", "-b", "main"], cwd: remoteDir });
      const workDir = mkdtempSync(join(tmpdir(), "git-ancestry-work-"));
      fixtureDirs.push(workDir);
      gitInTemp({ args: ["clone", remoteDir, "."], cwd: workDir });
      gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: workDir });
      gitInTemp({ args: ["config", "user.name", "Test"], cwd: workDir });
      gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: workDir });
      const sha = commit({ content: "a", dir: workDir, file: "f.txt", message: "first" });
      gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });

      const cloneDir = mkdtempSync(join(tmpdir(), "git-ancestry-clone-"));
      fixtureDirs.push(cloneDir);
      gitInTemp({ args: ["init", "-b", "scratch"], cwd: cloneDir });
      gitInTemp({ args: ["remote", "add", "origin", remoteDir], cwd: cloneDir });

      const ref = newPrivateFetchRef();
      const fetched = fetchBranchIntoPrivateRef({ branch: "main", cwd: cloneDir, git: realGit, ref, remote: "origin" });
      expect(unwrap(fetched)).toEqual({ sha });

      const deleted = deletePrivateRef({ cwd: cloneDir, git: realGit, ref });
      expect(deleted.isOk()).toBe(true);
      expect(() => gitInTemp({ args: ["rev-parse", "--verify", "--quiet", ref], cwd: cloneDir })).toThrow();
    },
  );

  it(
    "reports the fetch failure for a branch that does not exist on the remote",
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      const remoteDir = mkdtempSync(join(tmpdir(), "git-ancestry-remote-"));
      fixtureDirs.push(remoteDir);
      gitInTemp({ args: ["init", "--bare", "-b", "main"], cwd: remoteDir });
      const cloneDir = mkdtempSync(join(tmpdir(), "git-ancestry-clone-"));
      fixtureDirs.push(cloneDir);
      gitInTemp({ args: ["init", "-b", "scratch"], cwd: cloneDir });
      gitInTemp({ args: ["remote", "add", "origin", remoteDir], cwd: cloneDir });

      const ref = newPrivateFetchRef();
      const fetched = fetchBranchIntoPrivateRef({
        branch: "does-not-exist",
        cwd: cloneDir,
        git: realGit,
        ref,
        remote: "origin",
      });
      expect(githubVerbErrorLines({ error: unwrapErr(fetched) })).toEqual([
        `Command failed: git fetch origin refs/heads/does-not-exist:${ref}\n` +
          "fatal: couldn't find remote ref refs/heads/does-not-exist\n",
      ]);
    },
  );

  it("reports deletion failure rather than swallowing it, when the underlying write fails", () => {
    const failingGit: GithubPushDeps = {
      cwd: () => "/repo",
      doorLedger: memoryDoorLedger().port,
      out: () => {},
      readGit: () => "",
      writeGit: () => err("ref lock held"),
    };
    const deleted = deletePrivateRef({ cwd: "/repo", git: failingGit, ref: newPrivateFetchRef() });
    expect(deleted.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(deleted) }).join(" ")).toContain("ref lock held");
  });
});

describe("countCommitsAhead", () => {
  it("counts exactly the commits the base carries that the head does not", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const dir = initRepo();
    const fork = commit({ content: "one", dir, file: "a.txt", message: "one" });
    gitInTemp({ args: ["checkout", "-b", "feature"], cwd: dir });
    const head = commit({ content: "branch", dir, file: "b.txt", message: "branch work" });
    gitInTemp({ args: ["checkout", "main"], cwd: dir });
    commit({ content: "two", dir, file: "c.txt", message: "two" });
    const base = commit({ content: "three", dir, file: "d.txt", message: "three" });

    expect(unwrap(countCommitsAhead({ cwd: dir, from: head, to: base }))).toBe(2);
    expect(unwrap(countCommitsAhead({ cwd: dir, from: base, to: head }))).toBe(1);
    expect(unwrap(countCommitsAhead({ cwd: dir, from: fork, to: fork }))).toBe(0);
  });

  it("reports a revision it cannot resolve rather than answering a count", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const dir = initRepo();
    const head = commit({ content: "one", dir, file: "a.txt", message: "one" });
    const counted = countCommitsAhead({ cwd: dir, from: head, to: "f".repeat(40) });
    expect(counted.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(counted) }).join(" ")).toContain("could not count commits");
  });
});
