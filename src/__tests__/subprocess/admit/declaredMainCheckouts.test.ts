/**
 * {@link isDeclaredMainCheckout} and {@link isProtectedMainCheckout} — the second key the main-checkout
 * guards use, which is what lets them protect a checkout from a session standing in ANOTHER repository.
 *
 * Exercised against REAL git repositories and a real linked worktree, the same filesystem round-trip
 * `mainCheckoutBranchGuard.test.ts` uses: the whole predicate is a distinction git reports and nothing else
 * can honestly stand in for.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_TRUNK_BRANCH,
  isDeclaredMainCheckout,
  isProtectedMainCheckout,
  protectedTrunkBranch,
  trunkBranchFromRef,
} from "../../../admit/declaredMainCheckouts.js";
import { gitRemoteNames } from "../../../admit/mainWorktree.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A real repository with one real linked worktree, in a fresh temp directory. */
function realRepoWithWorktree(): { main: string; linked: string } {
  const main = mkdtempSync(join(tmpdir(), "slopweaver-declared-main-"));
  fixtureDirs.push(main);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: main });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: main });
  gitInTemp({ args: ["commit", "--allow-empty", "-q", "-m", "root"], cwd: main });
  const linkedRoot = mkdtempSync(join(tmpdir(), "slopweaver-declared-linked-"));
  fixtureDirs.push(linkedRoot);
  const linked = join(linkedRoot, "wt");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "feature", linked], cwd: main });
  return { linked, main };
}

describe("isDeclaredMainCheckout", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("recognises a declared main checkout", () => {
    const { main } = realRepoWithWorktree();
    expect(isDeclaredMainCheckout({ cwd: main, declared: [main] })).toBe(true);
  });

  it("does not recognise a linked worktree of that same declared repository", () => {
    const { linked, main } = realRepoWithWorktree();
    expect(isDeclaredMainCheckout({ cwd: linked, declared: [main] })).toBe(false);
  });

  it("does not recognise a main checkout nobody declared", () => {
    const { main } = realRepoWithWorktree();
    expect(isDeclaredMainCheckout({ cwd: main, declared: [] })).toBe(false);
  });

  it("does not recognise a directory that is not a repository at all", () => {
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-declared-none-"));
    fixtureDirs.push(outside);
    expect(isDeclaredMainCheckout({ cwd: outside, declared: [outside] })).toBe(false);
  });

  it("recognises a subdirectory of a declared main checkout", () => {
    const { main } = realRepoWithWorktree();
    const sub = join(main, "packages");
    mkdirSync(sub);
    expect(isDeclaredMainCheckout({ cwd: sub, declared: [main] })).toBe(true);
  });
});

describe("isProtectedMainCheckout", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("protects a declared checkout from a session standing in an unrelated repository", () => {
    const { main } = realRepoWithWorktree();
    const other = realRepoWithWorktree().main;
    expect(isProtectedMainCheckout({ cwd: main, repositoryCwd: other })).toBe(false);
  });

  it("protects a checkout from its OWN linked worktree by the topology key, with nothing declared", () => {
    const { linked, main } = realRepoWithWorktree();
    expect(isProtectedMainCheckout({ cwd: main, repositoryCwd: linked })).toBe(true);
  });

  it("leaves a linked worktree writable from within itself", () => {
    const { linked } = realRepoWithWorktree();
    expect(isProtectedMainCheckout({ cwd: linked, repositoryCwd: linked })).toBe(false);
  });
});

describe("trunkBranchFromRef", () => {
  it("strips a configured remote's prefix", () => {
    expect(trunkBranchFromRef({ ref: "origin/staging", remotes: ["origin"] })).toBe("staging");
  });

  it("strips a remote that is not called origin", () => {
    expect(trunkBranchFromRef({ ref: "upstream/trunk", remotes: ["origin", "upstream"] })).toBe("trunk");
  });

  it("keeps a slash-containing branch name whose first segment is not a remote", () => {
    expect(trunkBranchFromRef({ ref: "release/2.0", remotes: ["origin"] })).toBe("release/2.0");
  });

  it("keeps a bare local branch name", () => {
    expect(trunkBranchFromRef({ ref: "staging", remotes: ["origin"] })).toBe("staging");
  });

  it("strips a refs/heads/ prefix", () => {
    expect(trunkBranchFromRef({ ref: "refs/heads/release/2.0", remotes: ["origin"] })).toBe("release/2.0");
  });

  it("strips a refs/remotes/ prefix along with its remote segment", () => {
    expect(trunkBranchFromRef({ ref: "refs/remotes/origin/staging", remotes: ["origin"] })).toBe("staging");
  });

  it("still drops the remote segment of a refs/remotes/ ref when no remotes could be read", () => {
    expect(trunkBranchFromRef({ ref: "refs/remotes/origin/staging", remotes: [] })).toBe("staging");
  });

  it("leaves a prefixed ref alone when its first segment is not one of this repository's remotes", () => {
    expect(trunkBranchFromRef({ ref: "origin/staging", remotes: ["fork"] })).toBe("origin/staging");
  });

  it("ignores surrounding whitespace on a hand-edited profile value", () => {
    expect(trunkBranchFromRef({ ref: "  origin/staging  ", remotes: ["origin"] })).toBe("staging");
  });
});

describe("gitRemoteNames", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reads the remotes a real repository has", () => {
    const { main } = realRepoWithWorktree();
    gitInTemp({ args: ["remote", "add", "origin", "https://example.invalid/x.git"], cwd: main });
    gitInTemp({ args: ["remote", "add", "upstream", "https://example.invalid/y.git"], cwd: main });
    expect(gitRemoteNames({ cwd: main }).toSorted()).toEqual(["origin", "upstream"]);
  });

  it("reports none for a directory that is not a repository at all", () => {
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-remotes-none-"));
    fixtureDirs.push(outside);
    expect(gitRemoteNames({ cwd: outside })).toEqual([]);
  });
});

describe("protectedTrunkBranch", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reads the declared rebase target of THAT checkout", () => {
    const { main } = realRepoWithWorktree();
    expect(
      protectedTrunkBranch({
        checkouts: [{ path: main, rebaseOnto: "origin/staging" }],
        cwd: main,
        remotes: ["origin"],
      }),
    ).toBe("staging");
  });

  it("reads the trunk from a subdirectory of that checkout", () => {
    const { main } = realRepoWithWorktree();
    const sub = join(main, "packages");
    mkdirSync(sub);
    expect(
      protectedTrunkBranch({
        checkouts: [{ path: main, rebaseOnto: "origin/staging" }],
        cwd: sub,
        remotes: ["origin"],
      }),
    ).toBe("staging");
  });

  it("gives each declared checkout its own trunk, which one module constant could not", () => {
    const first = realRepoWithWorktree().main;
    const second = realRepoWithWorktree().main;
    const checkouts = [{ path: first }, { path: second, rebaseOnto: "origin/staging" }];
    expect(protectedTrunkBranch({ checkouts, cwd: first, remotes: ["origin"] })).toBe("main");
    expect(protectedTrunkBranch({ checkouts, cwd: second, remotes: ["origin"] })).toBe("staging");
  });

  it("falls back to main for a declared entry carrying no rebase target", () => {
    const { main } = realRepoWithWorktree();
    expect(protectedTrunkBranch({ checkouts: [{ path: main }], cwd: main, remotes: ["origin"] })).toBe(
      DEFAULT_TRUNK_BRANCH,
    );
  });

  it("falls back to main for a checkout the profile declares nothing about", () => {
    const { main } = realRepoWithWorktree();
    expect(protectedTrunkBranch({ checkouts: [], cwd: main, remotes: ["origin"] })).toBe(DEFAULT_TRUNK_BRANCH);
  });

  it("falls back to main for a directory that is not a repository at all", () => {
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-trunk-none-"));
    fixtureDirs.push(outside);
    expect(protectedTrunkBranch({ checkouts: [{ path: outside, rebaseOnto: "origin/staging" }], cwd: outside })).toBe(
      DEFAULT_TRUNK_BRANCH,
    );
  });
});
