/**
 * `freezeWithProvenance` over REAL temporary git repositories.
 *
 * The composition is what broke, so the composition is what is tested here. `stableTree`'s properties are
 * decided over plain values in `unit/codex/passProvenance.test.ts`, and the content address is measured against
 * real git in `subprocess/codex/snapshot.test.ts` — neither says whether the three readings this function
 * takes are readings of the same thing. That question needs real git and an actual freeze.
 *
 * The case that matters: a DIRTY checkout. Provenance used to be discarded on every one of them, because the
 * third reading fingerprinted the frozen copy and compared it to a fingerprint of the live repository — two
 * digests over different decompositions of the tree, equal only when the working-tree patch is empty. With no
 * recorded tree, `freshnessOf` reads `unknown`, and `planFailures` wants a plan that is both STALE and READY,
 * so the plan floor could never be met by a pass run from a checkout the agent was still writing to. Which is
 * the normal case — the snapshot exists precisely so the agent keeps writing.
 */

import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { capturePassTree } from "../../../codex/gitDiff.js";
import { freezeWithProvenance } from "../../../codex/orchestrate.js";
import { stableTree } from "../../../codex/passProvenance.js";
import { captureContentTree } from "../../../codex/snapshot.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** Every fixture repository this file minted, removed after each test so none outlives its own case. */
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A repository with one committed file. */
function seededRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-freeze-src-"));
  fixtureDirs.push(dir);
  const git = ({ args }: { args: readonly string[] }): string => gitInTemp({ args: [...args], cwd: dir });
  git({ args: ["init", "-q"] });
  git({ args: ["config", "user.email", "test@example.com"] });
  git({ args: ["config", "user.name", "Test"] });
  writeFileSync(join(dir, "tracked.txt"), "committed\n");
  git({ args: ["add", "-A"] });
  git({ args: ["commit", "-qm", "seed"] });
  return dir;
}

describe("freezeWithProvenance", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("records the tree a pass read on a DIRTY checkout, and names the frozen copy it read", () => {
    const dir = seededRepo();
    appendFileSync(join(dir, "tracked.txt"), "UNCOMMITTED\n");
    const live = capturePassTree({ cwd: dir })!;

    const frozen = freezeWithProvenance({ repoRoot: dir });

    // Anchored on the snapshot commit read out of git, not on `frozen.frozen`: comparing two fields that are
    // both `undefined` when no provenance was recorded is the shape this whole change exists to catch, and it
    // would have passed vacuously.
    const snapshotCommit = gitInTemp({ args: ["rev-parse", frozen.frozen!.commit], cwd: dir }).trim();

    expect(frozen.tree!.fingerprint).toBe(live.fingerprint);
    expect(frozen.tree!.dirtyBytes).toBe(live.dirtyBytes);
    expect(frozen.tree!.snapshotCommit).toBe(snapshotCommit);
    expect(frozen.readRoot).toBe(frozen.frozen!.path);
    frozen.frozen?.release();
  });

  /** The dirt is what the case is about, so assert it is really there rather than trusting the fixture. */
  it("records a dirty checkout whose patch is genuinely non-empty", () => {
    const dir = seededRepo();
    appendFileSync(join(dir, "tracked.txt"), "UNCOMMITTED\n");

    const frozen = freezeWithProvenance({ repoRoot: dir });

    expect(frozen.tree!.dirtyBytes > 0).toBe(true);
    expect(gitInTemp({ args: ["diff", "HEAD"], cwd: dir }).includes("UNCOMMITTED")).toBe(true);
    frozen.frozen?.release();
  });

  it("records the tree on a clean checkout, where HEAD's own tree is what was frozen", () => {
    const dir = seededRepo();

    const frozen = freezeWithProvenance({ repoRoot: dir });

    expect(frozen.tree!.treeSha).toBe(gitInTemp({ args: ["rev-parse", "HEAD^{tree}"], cwd: dir }).trim());
    expect(frozen.tree!.dirtyBytes).toBe(0);
    frozen.frozen?.release();
  });

  it("records a checkout whose only change is an untracked file", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, "brand-new.ts"), "export const x = 1;\n");

    const frozen = freezeWithProvenance({ repoRoot: dir });

    expect(frozen.tree!.fingerprint).toBe(capturePassTree({ cwd: dir })!.fingerprint);
    expect(frozen.tree!.dirtyBytes > 0).toBe(true);
    frozen.frozen?.release();
  });

  /**
   * A→B→A across the freeze, driven for real: the writer commits B, the freeze happens, the writer resets to
   * A. Both endpoint captures then read A and AGREE, so the before/after bracket alone would record A over a
   * copy that holds B. Only the third reading can say otherwise.
   *
   * The comparison is re-run by hand against the copy `freezeWithProvenance` actually took while the tree held
   * B, because the dance has to happen INSIDE the window that function owns and it cannot be made to pause
   * mid-freeze. Asserting the refusal is the point: a version of this case that only compared two separately
   * taken snapshots would be asserting a property of git rather than of this clause, and would survive
   * deleting the clause entirely.
   */
  it("refuses a checkout that moved to B, was frozen, and came back to A", () => {
    const dir = seededRepo();
    const a = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir }).trim();
    writeFileSync(join(dir, "tracked.txt"), "content B\n");
    gitInTemp({ args: ["commit", "-aqm", "B"], cwd: dir });
    // The freeze happens while the tree holds B.
    const frozen = freezeWithProvenance({ repoRoot: dir });
    gitInTemp({ args: ["reset", "-q", "--hard", a], cwd: dir });

    // The bracket agrees: both endpoints are read from the restored tree, which is A.
    const restored = capturePassTree({ cwd: dir });
    const settled = stableTree({
      after: restored,
      before: restored,
      liveContentTree: captureContentTree({ repoRoot: dir })._unsafeUnwrap(),
      snapshotContentTree: frozen.frozen!.contentTree,
    });

    expect(settled).toBeUndefined();
    expect(restored!.headSha).toBe(a);
    expect(frozen.frozen!.contentTree === captureContentTree({ repoRoot: dir })._unsafeUnwrap()).toBe(false);
    frozen.frozen?.release();
  });

  /**
   * No git, no snapshot, no provenance — and no throw. A missing provenance line must never stop a pass
   * running, which is why `capturePassTree` returns `undefined` rather than failing.
   */
  it("returns no provenance and the live root when the directory is not a repository", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "slopweaver-freeze-norepo-"));
    fixtureDirs.push(notARepo);

    const frozen = freezeWithProvenance({ repoRoot: notARepo });

    expect(frozen.tree).toBeUndefined();
    expect(frozen.frozen).toBeUndefined();
    expect(frozen.readRoot).toBe(notARepo);
  });
});
