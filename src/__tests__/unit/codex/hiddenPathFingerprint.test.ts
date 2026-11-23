/**
 * Real-git round trips for a tree git is not fully watching — the assume-unchanged and skip-worktree paths
 * `captureTreeFingerprint` folds in by content rather than refusing.
 *
 * Filesystem use is the sanctioned round-trip kind (`testing.md`): the property is whether git, as actually
 * invoked, lets an edit through, and a fake git would only agree with itself.
 */

import { appendFileSync, chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { capturePassTree, captureTreeFingerprint } from "../../../codex/gitDiff.js";
import { assumeUnchangedPaths, hiddenPathsText } from "../../../codex/hiddenPaths.js";
import { seedTemplate } from "../../seedTemplate.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * The seeded repository every case copies, committed ONCE per file and never written: its `init`, two `config`
 * calls, `add` and `commit` were a fifth of this file's git spawns. A copy carries the index's stale stat data,
 * which git content-checks rather than trusts, so a copy reads exactly as the seed did; a path marked hidden is
 * read by content against HEAD's blob by the capture under test, never by stat.
 */
let template: string | undefined;

afterAll(() => {
  if (template !== undefined) {
    rmSync(template, { force: true, recursive: true });
  }
});

/** The seeded template, built by whichever case asks first. */
function templateRepo(): string {
  if (template !== undefined) {
    return template;
  }
  template = seedTemplate({ prefix: "slopweaver-hidden-template-", seed });
  return template;
}

/** A fresh repository with one committed file: a copy of the seeded template. */
function seededRepo(): string {
  const source = templateRepo();
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-hidden-"));
  fixtureDirs.push(dir);
  cpSync(source, dir, { recursive: true });
  return dir;
}

/** Commit one file into a new repository at `dir`, with real git. */
function seed({ dir }: { dir: string }): void {
  gitInTemp({ args: ["init", "-q"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  writeFileSync(join(dir, "tracked.txt"), "one\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-qm", "seed"], cwd: dir });
}

/**
 * `git diff` OMITS a file marked assume-unchanged or skip-worktree even when its contents changed, so a
 * fingerprint taken over the diff alone is blind to it and would report CURRENT for a tree that moved. The
 * capture used to refuse, and that refusal killed the landing floor in every acme-admin worktree, whose
 * postinstall marks one path skip-worktree on every install. It now compares the hidden path's content to
 * HEAD's blob instead: an edit moves the digest, and an untouched marked path moves nothing.
 */
describe("captureTreeFingerprint and a tree git is not fully watching", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("fingerprints a marked, untouched path exactly as the same tree unmarked", () => {
    const dir = seededRepo();
    const unmarked = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tracked.txt"], cwd: dir });

    const marked = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(marked.digest).toBe(unmarked.digest);
    expect(marked.dirtyBytes).toBe(0);
  });

  // The original false-freshness repro, now caught by looking rather than by refusing.
  it("moves when an assume-unchanged path is edited, though git diff reports nothing", () => {
    const dir = seededRepo();
    gitInTemp({ args: ["update-index", "--assume-unchanged", "tracked.txt"], cwd: dir });
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    appendFileSync(join(dir, "tracked.txt"), "an edit git will not report\n");
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(gitInTemp({ args: ["diff", "HEAD"], cwd: dir })).toBe("");
    expect(after.digest === before.digest).toBe(false);
    expect(after.dirtyBytes > 0).toBe(true);
  });

  it("moves when a skip-worktree path is edited, and returns once its bytes match HEAD again", () => {
    const dir = seededRepo();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tracked.txt"], cwd: dir });
    const clean = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    writeFileSync(join(dir, "tracked.txt"), "customer\n");
    const switched = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();
    writeFileSync(join(dir, "tracked.txt"), "one\n");
    const restored = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(switched.digest === clean.digest).toBe(false);
    expect(restored.digest).toBe(clean.digest);
  });

  it("moves when a skip-worktree path is deleted from disk", () => {
    const dir = seededRepo();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tracked.txt"], cwd: dir });
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    rmSync(join(dir, "tracked.txt"));
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(after.digest === before.digest).toBe(false);
  });

  // `git diff` reports a mode change on identical content, so a hidden one must move the digest too.
  it("moves when a skip-worktree path only gains the executable bit", () => {
    const dir = seededRepo();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tracked.txt"], cwd: dir });
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    chmodSync(join(dir, "tracked.txt"), 0o755);
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(after.digest === before.digest).toBe(false);
  });

  it("holds a committed symlink still while its target is unchanged and moves when it is repointed", () => {
    const dir = seededRepo();
    symlinkSync("tracked.txt", join(dir, "link"));
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "link"], cwd: dir });
    const unmarked = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();
    gitInTemp({ args: ["update-index", "--skip-worktree", "link"], cwd: dir });
    const marked = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    rmSync(join(dir, "link"));
    symlinkSync("elsewhere.txt", join(dir, "link"));
    const repointed = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(marked.digest).toBe(unmarked.digest);
    expect(repointed.digest === marked.digest).toBe(false);
  });

  it("reads the hidden path from the repository root when captured from a subdirectory", () => {
    const dir = seededRepo();
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "inner.txt"), "inner\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "sub"], cwd: dir });
    gitInTemp({ args: ["update-index", "--skip-worktree", "tracked.txt"], cwd: dir });
    const fromRoot = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    const fromSub = captureTreeFingerprint({ cwd: join(dir, "sub") })._unsafeUnwrap();

    expect(fromSub.digest).toBe(fromRoot.digest);
  });

  it("records provenance for a marked tree rather than reporting it unknown", () => {
    const dir = seededRepo();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tracked.txt"], cwd: dir });

    expect(capturePassTree({ cwd: dir })!.fingerprint).toBe(
      captureTreeFingerprint({ cwd: dir })._unsafeUnwrap().digest,
    );
  });
  it("names a marked path HEAD does not hold, and moves when it is edited", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, "staged.txt"), "staged\n");
    gitInTemp({ args: ["add", "staged.txt"], cwd: dir });
    gitInTemp({ args: ["update-index", "--skip-worktree", "staged.txt"], cwd: dir });
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    appendFileSync(join(dir, "staged.txt"), "edited\n");
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(after.digest === before.digest).toBe(false);
  });

  it("lists exactly the marked paths, and names one only once its content leaves HEAD's blob", () => {
    const dir = seededRepo();
    expect(assumeUnchangedPaths({ cwd: dir })).toEqual([]);
    gitInTemp({ args: ["update-index", "--skip-worktree", "tracked.txt"], cwd: dir });
    const paths = assumeUnchangedPaths({ cwd: dir });
    const headSha = gitInTemp({ args: ["rev-parse", "HEAD:tracked.txt"], cwd: dir }).trim();

    const untouched = hiddenPathsText({ cwd: dir, paths });
    writeFileSync(join(dir, "tracked.txt"), "two\n");
    const editedSha = gitInTemp({ args: ["hash-object", "tracked.txt"], cwd: dir }).trim();
    const edited = hiddenPathsText({ cwd: dir, paths });

    expect(paths).toEqual(["tracked.txt"]);
    expect(untouched).toBe("");
    expect(edited).toBe(`hidden tracked.txt head=100644 ${headSha} worktree=100644 ${editedSha}`);
    expect(hiddenPathsText({ cwd: dir, paths: [] })).toBe("");
  });

  it("moves when a directory replaces a skip-worktree file", () => {
    const dir = seededRepo();
    gitInTemp({ args: ["update-index", "--skip-worktree", "tracked.txt"], cwd: dir });
    const before = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    rmSync(join(dir, "tracked.txt"));
    mkdirSync(join(dir, "tracked.txt"));
    const after = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();

    expect(after.digest === before.digest).toBe(false);
  });
});
