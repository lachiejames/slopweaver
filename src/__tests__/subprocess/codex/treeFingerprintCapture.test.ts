/**
 * Round-trip tests for the effectful fingerprint capture, against REAL temporary git repositories.
 *
 * Filesystem use is deliberate and sanctioned: `testing.md` allows it for a genuine round-trip, and this is
 * one — the whole property under test is "does git, as actually invoked, notice this change?". A fake git
 * would only prove that the fake agrees with itself.
 */

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { treeDrift } from "../../../codex/fingerprint.js";
import { capturePassTree, captureTreeFingerprint } from "../../../codex/gitDiff.js";
import { unwrapErr } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh repository with one committed file, so every test starts from a clean, non-empty tree. */
function seededRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-fp-"));
  fixtureDirs.push(dir);
  const git = ({ args }: { args: readonly string[] }): void => {
    gitInTemp({ args: [...args], cwd: dir });
  };
  git({ args: ["init", "-q"] });
  git({ args: ["config", "user.email", "test@example.com"] });
  git({ args: ["config", "user.name", "Test"] });
  writeFileSync(join(dir, "tracked.txt"), "one\n");
  git({ args: ["add", "-A"] });
  git({ args: ["commit", "-qm", "seed"] });
  return dir;
}

describe("captureTreeFingerprint", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reports a freshly committed tree as clean", () => {
    const captured = captureTreeFingerprint({ cwd: seededRepo() });

    expect(captured.isOk()).toBe(true);
    expect(captured._unsafeUnwrap().dirtyBytes).toBe(0);
  });

  it("is stable across two captures of an untouched tree", () => {
    const dir = seededRepo();

    const first = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();
    const second = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(second.digest).toBe(first.digest);
  });

  // The measured PR6 failure: an hour of editing with no commit, which a HEAD comparison calls current.
  it("moves on an uncommitted edit while HEAD stays put", () => {
    const dir = seededRepo();
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    appendFileSync(join(dir, "tracked.txt"), "two\n");
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(after.headSha).toBe(before.headSha);
    expect(after.digest === before.digest).toBe(false);
    expect(after.dirtyBytes > 0).toBe(true);
  });

  /**
   * The reason this capture reuses `combinedDiffText` instead of `git stash create`.
   *
   * `stash create` records tracked modifications only. A branch whose change is mostly NEW files would
   * fingerprint identically before and after those files appeared — two different trees comparing equal,
   * which is the one outcome a staleness check must never produce. Measured, not assumed: a probe against a
   * real repository confirmed `stash create` omits the new file.
   */
  it("moves when a brand-new untracked file appears", () => {
    const dir = seededRepo();
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    writeFileSync(join(dir, "brand-new.ts"), "export const x = 1;\n");
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(after.digest === before.digest).toBe(false);
    expect(after.dirtyBytes > before.dirtyBytes).toBe(true);
  });

  it("ignores a file the repository ignores, so build output cannot invalidate a pass", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, ".gitignore"), "junk/\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "ignore"], cwd: dir });
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    mkdirSync(join(dir, "junk"), { recursive: true });
    writeFileSync(join(dir, "junk", "out.log"), "noise\n");
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(after.digest).toBe(before.digest);
  });

  it("moves when a commit changes the files, and says so", () => {
    const dir = seededRepo();
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    appendFileSync(join(dir, "tracked.txt"), "two\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "second"], cwd: dir });
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(after.headSha === before.headSha).toBe(false);
    expect(treeDrift({ after, before })!).toContain("the committed tree changed");
  });

  /**
   * The fingerprint must describe the TREE, not the machine reading it.
   *
   * Found by a Codex review of this very commit and then reproduced: toggling `core.quotepath` alone changed
   * the digest of a tree that never moved, because git renders `café.ts` either literally or as
   * `"caf\303\251.ts"`. That would have broken the CI half of the loop gate silently — a runner's git config
   * differs from a laptop's, so any branch touching a non-ASCII path would have failed for no visible reason.
   * The non-ASCII filename is the point of the fixture; an ASCII-only repo cannot exhibit it.
   */
  it("is invariant to local git configuration that only changes how a diff is rendered", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, "café.ts"), "export const x = 1;\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "unicode path"], cwd: dir });
    appendFileSync(join(dir, "café.ts"), "// edit\n");

    const digests = [
      ["core.quotepath", "true"],
      ["core.quotepath", "false"],
      ["diff.algorithm", "patience"],
      ["diff.context", "7"],
      ["diff.noprefix", "true"],
      ["core.abbrev", "4"],
    ].map(([key, value]) => {
      gitInTemp({ args: ["config", key!, value!], cwd: dir });
      return captureTreeFingerprint({ cwd: dir })._unsafeUnwrap().digest;
    });

    expect(new Set(digests).size).toBe(1);
  });

  /** The mandated one-commit-off-base workflow must not invalidate the passes taken during the work. */
  it("survives a squash that leaves every file identical", () => {
    const dir = seededRepo();
    appendFileSync(join(dir, "tracked.txt"), "work\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "work"], cwd: dir });
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    gitInTemp({ args: ["reset", "--soft", "HEAD~1"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "squashed, same files"], cwd: dir });
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(after.headSha === before.headSha).toBe(false);
    expect(after.digest).toBe(before.digest);
  });

  it("returns a typed error rather than throwing when the directory is not a repository", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "slopweaver-norepo-"));
    fixtureDirs.push(notARepo);

    const captured = captureTreeFingerprint({ cwd: notARepo });

    expect(unwrapErr(captured).kind).toBe("io");
    expect(unwrapErr(captured).operation).toBe("codex.captureTreeFingerprint");
  });
});

describe("capturePassTree", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("records the branch, the digest and a clean tree", () => {
    const dir = seededRepo();
    gitInTemp({ args: ["checkout", "-q", "-b", "some-branch"], cwd: dir });

    const tree = capturePassTree({ cwd: dir })!;

    expect(tree.branch).toBe("some-branch");
    expect(tree.dirtyBytes).toBe(0);
    expect(tree.fingerprint.length).toBe(64);
    expect(tree.headSha.length).toBe(40);
  });

  it("reports the uncommitted patch size, so a pass that read a dirty tree says so", () => {
    const dir = seededRepo();
    appendFileSync(join(dir, "tracked.txt"), "two\n");

    expect(capturePassTree({ cwd: dir })!.dirtyBytes > 0).toBe(true);
  });

  /**
   * A detached HEAD is ordinary here, not exotic — the frozen snapshot a pass reads is one. `null` keeps
   * "there is no branch" distinguishable from "we did not look", which an empty string would not.
   */
  it("reports a detached HEAD as null rather than an empty string", () => {
    const dir = seededRepo();
    gitInTemp({ args: ["checkout", "-q", "--detach"], cwd: dir });

    expect(capturePassTree({ cwd: dir })!.branch).toBe(null);
  });

  /**
   * Missing provenance must never stop a pass running. The artifact says "unknown" instead, which is honest;
   * throwing here would make the ledger a reason not to use the loop at all.
   */
  it("returns undefined rather than throwing when the directory is not a repository", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "slopweaver-notree-"));
    fixtureDirs.push(notARepo);

    expect(capturePassTree({ cwd: notARepo })).toBeUndefined();
  });

  it("agrees with a direct fingerprint capture of the same tree", () => {
    const dir = seededRepo();

    expect(capturePassTree({ cwd: dir })!.fingerprint).toBe(
      captureTreeFingerprint({ cwd: dir })._unsafeUnwrap().digest,
    );
  });
});
