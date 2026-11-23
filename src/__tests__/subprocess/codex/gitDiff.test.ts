/**
 * Real-git tests for the diff capture, against a throwaway repository built by `mkdtempSync`.
 *
 * These exist because of a defect that NO amount of pure unit testing would have caught. `git diff
 * --no-index` exits non-zero whenever files differ, so the patch for an untracked file arrives on the
 * thrown error's `stdout` — and that value is a Buffer, not a string. A version of `combinedDiffText` that
 * tested `typeof stdout === "string"` therefore contributed an EMPTY STRING for every untracked file, and
 * silently reviewed a diff with all brand-new files missing. The pure tests passed. The verdict looked
 * plausible. It was caught only by counting `diff --git` headers in a real capture.
 *
 * So the load-bearing assertion in this file is that a NEW file's content actually appears in the diff.
 *
 * Filesystem-only (a temp repo, no network, no shared service), which `.claude/rules/testing.md` permits
 * for exactly this kind of genuine round-trip.
 *
 * EVERY TEST HERE SPAWNS REAL `git` PROCESSES — `init`, three `config`s, `add`, `commit`, `checkout`, then
 * the capture's own four or five invocations. That comfortably exceeds vitest's 5s default under load, so the
 * timeout is raised explicitly rather than left to flake in CI or a pre-push hook (where it did). It is now
 * `REAL_GIT_TIMEOUT_MS` from `tempGitRepo`, applied at DESCRIBE level and shared with the other two git
 * suites — which flaked the same way on four full-gate runs before they were given the same treatment.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureReviewDiff, resolveRepoRoot } from "../../../codex/gitDiff.js";
import { stripGitEnv } from "../../../codex/gitRun.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A repo with one commit on `base`, so a merge-base exists to diff against. */
function repoWithBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-git-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", "base");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "kept.txt"), "original\n");
  git("add", "-A");
  git("commit", "-m", "base");
  git("checkout", "-b", "work");
  return dir;
}

function capture({ dir, maxBytes = 10_000_000 }: { dir: string; maxBytes?: number }) {
  const result = captureReviewDiff({ base: "base", cwd: dir, maxBytes });
  expect(result.isOk()).toBe(true);
  return result._unsafeUnwrap();
}

/** Real git process spawns are slow; see the file header. Explicit, not inherited. */
describe("captureReviewDiff against a real repository", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("includes an UNTRACKED file's content — the omission that a plausible verdict once hid", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "brand-new.ts"), "export const added = 1;\n");
    const captured = capture({ dir });
    expect(captured.isOk()).toBe(true);
    const text = captured.isOk() ? captured.value.text : "";
    expect(text).toContain("brand-new.ts");
    expect(text).toContain("export const added = 1;");
  });

  it("includes a tracked modification", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "kept.txt"), "changed\n");
    const captured = capture({ dir });
    const text = captured.isOk() ? captured.value.text : "";
    expect(text).toContain("+++ b/kept.txt");
    expect(text).toContain("+changed");
  });

  it("includes BOTH a tracked modification and an untracked addition in one diff", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "kept.txt"), "changed\n");
    writeFileSync(join(dir, "extra.ts"), "export const extra = 2;\n");
    const text = (() => {
      const captured = capture({ dir });
      return captured.isOk() ? captured.value.text : "";
    })();
    expect(text).toContain("+changed");
    expect(text).toContain("export const extra = 2;");
  });

  it("includes a STAGED change, so the diff matches the files on disk", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "kept.txt"), "staged\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    const captured = capture({ dir });
    const text = captured.isOk() ? captured.value.text : "";
    expect(text).toContain("+staged");
  });

  it("records the base and HEAD shas, so a later commit is detectable", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "kept.txt"), "changed\n");
    const captured = capture({ dir });
    const diff = captured.isOk() ? captured.value : undefined;
    expect(diff?.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(diff?.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(diff?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores a gitignored file — ignored paths are out of scope by definition", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, ".gitignore"), "secret.txt\n");
    writeFileSync(join(dir, "secret.txt"), "do not review me\n");
    const captured = capture({ dir });
    const text = captured.isOk() ? captured.value.text : "";
    expect(text).not.toContain("do not review me");
  });

  it("REFUSES a binary addition rather than sending an encoded blob", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
    const captured = capture({ dir });
    expect(captured.isOk()).toBe(false);
    expect(captured.isErr() ? captured.error.kind : "").toBe("binary");
  });

  it("REFUSES an empty diff when nothing changed", () => {
    const captured = capture({ dir: repoWithBase() });
    expect(captured.isOk()).toBe(false);
    expect(captured.isErr() ? captured.error.kind : "").toBe("empty");
  });

  it("REFUSES an oversized diff rather than truncating it", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "big.ts"), `export const x = "${"a".repeat(5000)}";\n`);
    const captured = capture({ dir, maxBytes: 100 });
    expect(captured.isOk()).toBe(false);
    expect(captured.isErr() ? captured.error.kind : "").toBe("too-large");
  });

  it("does NOT mistake ordinary source containing `160000` for a submodule", () => {
    // The submodule detector once matched its own source this way, refusing a perfectly good diff.
    const dir = repoWithBase();
    writeFileSync(join(dir, "modes.ts"), 'export const gitlink = line.includes(" 160000");\n');
    const captured = capture({ dir });
    expect(captured.isOk()).toBe(true);
  });

  it("does NOT mistake prose mentioning `Subproject commit` for a submodule", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "notes.md"), "A submodule diff shows a Subproject commit line.\n");
    const captured = capture({ dir });
    expect(captured.isOk()).toBe(true);
  });

  it("handles a file in a nested new directory", () => {
    const dir = repoWithBase();
    mkdirSync(join(dir, "deep", "nested"), { recursive: true });
    writeFileSync(join(dir, "deep", "nested", "file.ts"), "export const deep = 3;\n");
    const captured = capture({ dir });
    const text = captured.isOk() ? captured.value.text : "";
    expect(text).toContain("export const deep = 3;");
  });

  it("handles a filename containing a space", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "has space.ts"), "export const spaced = 4;\n");
    const captured = capture({ dir });
    const text = captured.isOk() ? captured.value.text : "";
    expect(text).toContain("export const spaced = 4;");
  });

  it("is byte-identical across two captures of the same state, so every property judges one diff", () => {
    const dir = repoWithBase();
    writeFileSync(join(dir, "kept.txt"), "changed\n");
    const first = capture({ dir });
    const second = capture({ dir });
    const a = first.isOk() ? first.value.sha256 : "a";
    const b = second.isOk() ? second.value.sha256 : "b";
    expect(a).toBe(b);
  });
});

describe("isolation from a git hook's environment", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reads the repository at `cwd` even when GIT_DIR points somewhere else", () => {
    // A git hook exports GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE, and those OVERRIDE cwd. Without stripping
    // them, `codex review` run from a pre-push hook would diff the hook's repo — a review of the wrong code
    // that still produces a confident verdict and a complete artifact.
    const dir = repoWithBase();
    writeFileSync(join(dir, "only-here.ts"), "export const onlyHere = 1;\n");
    const elsewhere = repoWithBase();
    const previous = process.env["GIT_DIR"];
    process.env["GIT_DIR"] = join(elsewhere, ".git");
    try {
      const captured = capture({ dir });
      const text = captured.isOk() ? captured.value.text : "";
      expect(text).toContain("export const onlyHere = 1;");
    } finally {
      if (previous === undefined) {
        delete process.env["GIT_DIR"];
      } else {
        process.env["GIT_DIR"] = previous;
      }
    }
  });
});

describe("stripGitEnv", () => {
  it("drops an upper-case GIT_ key", () => {
    expect(stripGitEnv({ env: { GIT_DIR: "/elsewhere/.git", PATH: "/usr/bin" } })).toEqual({ PATH: "/usr/bin" });
  });

  it("drops a LOWER-CASE git_ key — Windows resolves it as GIT_ and would honour it", () => {
    // This is the assertion that actually holds the Windows guarantee. An end-to-end test cannot: on macOS
    // and Linux a lower-case `git_dir` is never read by git at all, so such a test passes whether the bug is
    // present or not. Found by the review verbs on their own merged diff (property `r1-git-env`).
    expect(stripGitEnv({ env: { git_dir: "/elsewhere/.git", PATH: "/usr/bin" } })).toEqual({ PATH: "/usr/bin" });
  });

  it("drops a MIXED-case Git_ key", () => {
    expect(stripGitEnv({ env: { Git_Work_Tree: "/elsewhere", PATH: "/usr/bin" } })).toEqual({ PATH: "/usr/bin" });
  });

  it("keeps a key that merely CONTAINS git, since only the prefix redirects git", () => {
    expect(stripGitEnv({ env: { MY_GIT_HELPER: "x", PATH: "/usr/bin" } })).toEqual({
      MY_GIT_HELPER: "x",
      PATH: "/usr/bin",
    });
  });

  it("drops an undefined value rather than passing it through as undefined", () => {
    expect(stripGitEnv({ env: { DEFINED: "y", UNSET: undefined } })).toEqual({ DEFINED: "y" });
  });

  it("returns an empty environment unchanged", () => {
    expect(stripGitEnv({ env: {} })).toEqual({});
  });
});

describe("resolveRepoRoot", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("resolves the root of a real repository", () => {
    const dir = repoWithBase();
    const result = resolveRepoRoot({ cwd: dir });
    expect(result.isOk()).toBe(true);
    // macOS reports /var as a symlink to /private/var, so compare the basename rather than the full path.
    expect(result._unsafeUnwrap().endsWith(dir.split("/").pop()!)).toBe(true);
  });

  it("returns a typed io error outside a repository", () => {
    const outside = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    fixtureDirs.push(outside);
    const result = resolveRepoRoot({ cwd: outside });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe("io");
  });
});
