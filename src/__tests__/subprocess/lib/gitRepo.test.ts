/**
 * Real-git round-trip for {@link currentBranchOf}, {@link repoRootFromDirectory} and
 * {@link workingTreeFilesOf}, against a throwaway repository built by `mkdtempSync`.
 *
 * {@link workingTreeFilesOf} is here rather than in the unit lane because the property under test is what
 * `git ls-files` itself reports across the three classes a working tree holds at once — committed, present
 * but uncommitted, and ignored — and only a real `git init` plus a real `git add` produces them. `git-in-tests`
 * refuses any git spawn outside `../../tempGitRepo.ts`'s `gitInTemp`, which is what this lane exists for.
 *
 * `currentBranchOf` anchors on the CALLER's file rather than `cwd` (see `../../../lib/gitRepo.ts`'s module
 * header on why), so these tests hand it a `file://` URL under the temp repo rather than an actual source
 * file — `git -C` only needs the directory to exist, not the file the URL names. `repoRootFromDirectory`
 * anchors on an explicit directory instead — the variant `cmux/pluginDir.ts`'s `spawnerRootFrom` uses so a
 * plugin-dir decision never depends on where its own module happens to live on disk (see that
 * file's header).
 *
 * Filesystem-only (a temp repo, no network, no shared service), which `.claude/rules/testing.md` permits for
 * exactly this kind of genuine round-trip.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  currentBranchOf,
  repoRootFromDirectory,
  trackedTreeFilesOf,
  workingTreeFilesOf,
} from "../../../lib/gitRepo.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp git repo with one commit on a named branch. */
function repoOnBranch({ branch }: { branch: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "git-repo-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", branch);
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("commit", "--allow-empty", "-m", "seed");
  return dir;
}

/** `currentBranchOf` anchored on a path inside `dir`, without a real file at that path. */
function branchOf({ dir }: { dir: string }): string | undefined {
  return currentBranchOf({ importMetaUrl: `file://${dir}/anywhere.ts` });
}

describe(
  "currentBranchOf",
  () => {
    it("reads the branch of the repository containing the anchor file", () => {
      const dir = repoOnBranch({ branch: "a-feature-branch" });
      expect(branchOf({ dir })).toBe("a-feature-branch");
    });

    it("reports undefined on a detached HEAD rather than the literal string HEAD", () => {
      const dir = repoOnBranch({ branch: "main" });
      gitInTemp({ args: ["checkout", "--detach", "HEAD"], cwd: dir });
      expect(branchOf({ dir })).toBeUndefined();
    });
  },
  REAL_GIT_TIMEOUT_MS,
);

describe(
  "repoRootFromDirectory",
  () => {
    it("resolves the root of the repository containing the given directory", () => {
      const dir = repoOnBranch({ branch: "main" });
      expect(repoRootFromDirectory({ dir })).toBe(realpathSync(dir));
    });

    it("resolves the same root from a subdirectory of the repository", () => {
      const dir = repoOnBranch({ branch: "main" });
      const nested = mkdtempSync(join(dir, "nested-"));
      fixtureDirs.push(nested);
      expect(repoRootFromDirectory({ dir: nested })).toBe(realpathSync(dir));
    });

    it("throws for a directory that is not a git repository", () => {
      const bare = mkdtempSync(join(tmpdir(), "not-a-repo-"));
      fixtureDirs.push(bare);
      expect(() => repoRootFromDirectory({ dir: bare })).toThrow();
    });

    it("keeps a root whose own name ends in a space, which `.trim()` would turn into a sibling's", () => {
      // The two checkouts are DIFFERENT directories whose names differ only by that space, and each holds
      // a file the other does not — so a root that came back trimmed would resolve to the sibling and the
      // final assertion would read the wrong file rather than merely reading a differently-spelled path.
      const parent = mkdtempSync(join(tmpdir(), "trailing-space-"));
      fixtureDirs.push(parent);
      const spaced = join(parent, "repo ");
      const sibling = join(parent, "repo");
      mkdirSync(spaced);
      mkdirSync(sibling);
      for (const [dir, file] of [
        [spaced, "only-in-spaced.ts"],
        [sibling, "only-in-sibling.ts"],
      ] as const) {
        writeFileSync(join(dir, file), "export const x = 1;\n");
        gitInTemp({ args: ["init", "-q", "."], cwd: dir });
        gitInTemp({ args: ["add", "-A"], cwd: dir });
      }

      const resolved = repoRootFromDirectory({ dir: spaced });
      expect(resolved).toBe(realpathSync(spaced));
      expect(resolved.endsWith(" ")).toBe(true);
      expect(gitInTemp({ args: ["ls-files"], cwd: resolved })).toBe("only-in-spaced.ts");
    });
  },
  REAL_GIT_TIMEOUT_MS,
);

/**
 * A fresh temp git repo holding all three classes at once: `committed.ts` in the index, `uncommitted.ts`
 * present on disk and never added, and `ignored.ts` named by `.gitignore`. `nested/deep.ts` is there so the
 * pathspec case has something to narrow away.
 */
function repoWithAllThreeClasses(): string {
  const dir = mkdtempSync(join(tmpdir(), "git-listing-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, ".gitignore"), "ignored.ts\n");
  writeFileSync(join(dir, "committed.ts"), "export const a = 1;\n");
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "nested", "deep.ts"), "export const b = 2;\n");
  git("add", ".gitignore", "committed.ts", "nested/deep.ts");
  git("commit", "-m", "seed");
  writeFileSync(join(dir, "uncommitted.ts"), "export const c = 3;\n");
  writeFileSync(join(dir, "ignored.ts"), "export const d = 4;\n");
  return dir;
}

describe(
  "workingTreeFilesOf",
  () => {
    it("lists committed AND uncommitted files, and never an ignored one", () => {
      const root = repoWithAllThreeClasses();
      expect(workingTreeFilesOf({ root })).toEqual([".gitignore", "committed.ts", "nested/deep.ts", "uncommitted.ts"]);
    });

    it("keeps an uncommitted file that a pathspec selects, and drops what the pathspec excludes", () => {
      const root = repoWithAllThreeClasses();
      writeFileSync(join(root, "nested", "fresh.ts"), "export const e = 5;\n");
      expect(workingTreeFilesOf({ pathspec: "nested", root })).toEqual(["nested/deep.ts", "nested/fresh.ts"]);
    });

    it("sorts the merged listing, which git itself does not — it prints untracked paths first", () => {
      const root = repoWithAllThreeClasses();
      writeFileSync(join(root, "aaa.ts"), "export const f = 6;\n");
      const raw = gitInTemp({ args: ["ls-files", "--cached", "--others", "--exclude-standard"], cwd: root });
      expect(raw.split("\n")[0]).toBe("aaa.ts");
      expect(raw.split("\n")[1]).toBe("uncommitted.ts");
      expect(workingTreeFilesOf({ root })).toEqual([
        ".gitignore",
        "aaa.ts",
        "committed.ts",
        "nested/deep.ts",
        "uncommitted.ts",
      ]);
    });

    it("throws rather than reporting a clean scan when the listing is empty", () => {
      const root = repoWithAllThreeClasses();
      expect(() => workingTreeFilesOf({ pathspec: "no-such-tree", root })).toThrow("refusing to report a clean scan");
    });
  },
  REAL_GIT_TIMEOUT_MS,
);

describe(
  "trackedTreeFilesOf",
  () => {
    it("lists only what git tracks — never an uncommitted or an ignored file", () => {
      const root = repoWithAllThreeClasses();
      expect(trackedTreeFilesOf({ root })).toEqual([".gitignore", "committed.ts", "nested/deep.ts"]);
    });

    it("keeps a path beginning with a space intact, because the read is NUL-delimited", () => {
      const root = repoWithAllThreeClasses();
      writeFileSync(join(root, " spaced.ts"), "export const g = 7;\n");
      gitInTemp({ args: ["add", " spaced.ts"], cwd: root });
      expect(trackedTreeFilesOf({ pathspec: " spaced.ts", root })).toEqual([" spaced.ts"]);
    });

    it("throws rather than counting zero when a pathspec selects nothing tracked", () => {
      const root = repoWithAllThreeClasses();
      expect(() => trackedTreeFilesOf({ pathspec: "uncommitted.ts", root })).toThrow("refusing to report a clean scan");
    });
  },
  REAL_GIT_TIMEOUT_MS,
);
