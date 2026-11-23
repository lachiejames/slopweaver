/**
 * The listing every gate scans, asserted against real git rather than against a restatement of its format.
 *
 * `workingTreeFilesOf` read `git ls-files` as newline-delimited text and trimmed each line. git prints a
 * tracked path whose name begins with a space UNQUOTED, so ` probe.sh` arrived as `probe.sh` — aliasing a
 * different tracked file, which the scan then read twice while never reading the offender. Every gate in
 * `src/devLint/` and `src/hygiene/scan.ts` takes its subjects from this one function, so that was the same
 * hole in all of them.
 *
 * Real git, per `.claude/rules/testing.md`'s fixture allowance: the subject IS git's own output format, and
 * a fake listing would only prove that this file agrees with itself.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { partialListingLines, workingTreeFilesContaining, workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const REAL_GIT = { timeout: REAL_GIT_TIMEOUT_MS };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A repository holding exactly the named files, each with its own contents, built with the sanctioned runner. */
function scratchRepo({ files, label }: { files: readonly string[]; label: string }): string {
  const dir = mkdtempSync(join(tmpdir(), `slopweaver-wtf-${label}-`));
  dirs.push(dir);
  gitInTemp({ args: ["init", "--initial-branch=main"], cwd: dir });
  for (const file of files) {
    writeFileSync(join(dir, file), `contents of ${file}\n`);
  }
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  return dir;
}

describe("partialListingLines", () => {
  it("names git's warnings over a directory or a file it could not read, and its error and fatal lines", () => {
    const stderr = [
      "warning: could not open directory 'hidden/': Permission denied",
      "warning: unable to access 'x/.gitignore': Permission denied",
      "error: something git itself failed",
      "fatal: index file corrupt",
      "",
    ].join("\n");
    expect(partialListingLines({ stderr })).toEqual([
      "warning: could not open directory 'hidden/': Permission denied",
      "warning: unable to access 'x/.gitignore': Permission denied",
      "error: something git itself failed",
      "fatal: index file corrupt",
    ]);
  });

  it("lets a diagnostic over a whole listing through", () => {
    expect(partialListingLines({ stderr: "benign-fsmonitor-diagnostic\n" })).toEqual([]);
  });

  it("answers nothing for an empty stderr", () => {
    expect(partialListingLines({ stderr: "" })).toEqual([]);
  });
});

describe("workingTreeFilesOf over a path git prints unquoted", () => {
  it("keeps a leading space, so the name cannot alias another tracked file", REAL_GIT, () => {
    const dir = scratchRepo({ files: [" probe.sh", "probe.sh"], label: "space" });
    expect(workingTreeFilesOf({ root: dir })).toEqual([" probe.sh", "probe.sh"]);
  });

  it("keeps a TRAILING space, which a trim also removed", REAL_GIT, () => {
    const dir = scratchRepo({ files: ["probe.sh ", "probe.sh"], label: "trail" });
    expect(workingTreeFilesOf({ root: dir })).toEqual(["probe.sh", "probe.sh "]);
  });

  it("answers ordinary names unchanged, sorted, with nothing empty in it", REAL_GIT, () => {
    const dir = scratchRepo({ files: ["b.ts", "a.ts"], label: "plain" });
    expect(workingTreeFilesOf({ root: dir })).toEqual(["a.ts", "b.ts"]);
  });

  it("refuses a listing git cut short at an unreadable directory, which it only warns about", REAL_GIT, () => {
    const dir = scratchRepo({ files: ["a.ts"], label: "hidden" });
    mkdirSync(join(dir, "hidden"));
    writeFileSync(join(dir, "hidden", "evil.ts"), "export const x = 1;\n");
    chmodSync(join(dir, "hidden"), 0o000);
    try {
      expect(() => workingTreeFilesOf({ root: dir })).toThrow("so the listing is partial");
    } finally {
      chmodSync(join(dir, "hidden"), 0o755);
    }
  });

  it("refuses a cut-short listing under a translated locale, whose warning no English prefix matches", REAL_GIT, () => {
    // Homebrew git under `LC_ALL=de_DE.UTF-8` warned `Warnung: konnte Verzeichnis … nicht öffnen`.
    const dir = scratchRepo({ files: ["a.ts"], label: "locale" });
    mkdirSync(join(dir, "hidden"));
    writeFileSync(join(dir, "hidden", "evil.ts"), "export const x = 1;\n");
    chmodSync(join(dir, "hidden"), 0o000);
    process.env["LC_ALL"] = "de_DE.UTF-8";
    process.env["LANGUAGE"] = "de";
    try {
      expect(() => workingTreeFilesOf({ root: dir })).toThrow("warning: could not open directory");
    } finally {
      delete process.env["LC_ALL"];
      delete process.env["LANGUAGE"];
      chmodSync(join(dir, "hidden"), 0o755);
    }
  });

  it("refuses a listing built over a .gitignore git could not read", REAL_GIT, () => {
    const dir = scratchRepo({ files: ["a.ts"], label: "ignore" });
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.ts"), "export const b = 1;\n");
    writeFileSync(join(dir, ".gitignore"), "ignored.ts\n");
    chmodSync(join(dir, ".gitignore"), 0o000);
    try {
      expect(() => workingTreeFilesOf({ root: dir })).toThrow("unable to access");
    } finally {
      chmodSync(join(dir, ".gitignore"), 0o644);
    }
  });

  it("lists a whole tree under GIT_TRACE, whose stderr diagnostics are not a warning", REAL_GIT, () => {
    const dir = scratchRepo({ files: ["a.ts", "b.ts"], label: "trace" });
    process.env["GIT_TRACE"] = "1";
    try {
      expect(workingTreeFilesOf({ root: dir })).toEqual(["a.ts", "b.ts"]);
    } finally {
      delete process.env["GIT_TRACE"];
    }
  });

  it("lists a whole tree under an fsmonitor hook that writes git's own warning text to stderr", REAL_GIT, () => {
    // Counterexample: the hook's stderr is not git's, so it never reaches the listing's check.
    const dir = scratchRepo({ files: ["a.ts", "b.ts"], label: "fsmon" });
    const hook = join(dir, "fsmonitor-hook");
    writeFileSync(hook, "#!/bin/sh\necho \"warning: could not open directory 'x/': Permission denied\" >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    gitInTemp({ args: ["config", "core.fsmonitor", hook], cwd: dir });
    expect(workingTreeFilesOf({ root: dir })).toEqual(["a.ts", "b.ts", "fsmonitor-hook"]);
  });

  it("refuses a listing that collapses an untracked nested repository to one directory entry", REAL_GIT, () => {
    // git lists `src/hidden/` with exit 0 and no warning, and never `src/hidden/evil.ts`.
    const dir = scratchRepo({ files: ["a.ts"], label: "nested" });
    mkdirSync(join(dir, "src", "hidden"), { recursive: true });
    gitInTemp({ args: ["init", "--initial-branch=main"], cwd: join(dir, "src", "hidden") });
    writeFileSync(join(dir, "src", "hidden", "evil.ts"), "export const x = 1;\n");
    expect(() => workingTreeFilesOf({ root: dir })).toThrow("listed src/hidden/ as a nested repository");
  });

  it("still refuses to call an unlistable tree clean", REAL_GIT, () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-wtf-empty-"));
    dirs.push(dir);
    gitInTemp({ args: ["init", "--initial-branch=main"], cwd: dir });
    expect(() => workingTreeFilesOf({ root: dir })).toThrow("refusing to report a clean scan");
  });
});

/** A repository whose tracked files hold the given contents, plus whatever a case adds untracked afterwards. */
function contentRepo({ files, label }: { files: Readonly<Record<string, string>>; label: string }): string {
  const dir = mkdtempSync(join(tmpdir(), `slopweaver-wtc-${label}-`));
  dirs.push(dir);
  gitInTemp({ args: ["init", "--initial-branch=main"], cwd: dir });
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  return dir;
}

/** The one selection every case below asks for, so each differs only in the tree it builds. */
function selectFlags({ root }: { root: string }): readonly string[] {
  return workingTreeFilesContaining({
    fixedStrings: ["--channels", "--discover-channels"],
    pathspecs: ["*.md", "*.ts"],
    root,
  });
}

describe("workingTreeFilesContaining", () => {
  it("selects a tracked and an untracked hit, sorted, never an ignored one or another extension", REAL_GIT, () => {
    const dir = contentRepo({
      files: {
        ".gitignore": "ignored.md\n",
        "a.json": "--channels\n",
        "quiet.md": "nothing here\n",
        "z/tracked.ts": "x --channels y\n",
      },
      label: "plain",
    });
    writeFileSync(join(dir, "b.md"), "an untracked --channels\n");
    writeFileSync(join(dir, "ignored.md"), "--channels\n");
    expect(selectFlags({ root: dir })).toEqual(["b.md", "z/tracked.ts"]);
  });

  it("ORs its strings, so a file holding only the second is selected too", REAL_GIT, () => {
    const dir = contentRepo({ files: { "a.md": "--channels\n", "deep/b.md": "--discover-channels\n" }, label: "or" });
    expect(selectFlags({ root: dir })).toEqual(["a.md", "deep/b.md"]);
  });

  it("answers no candidate over a tree where nothing matches", REAL_GIT, () => {
    const dir = contentRepo({ files: { "a.md": "nothing\n", "b.ts": "export {};\n" }, label: "none" });
    expect(selectFlags({ root: dir })).toEqual([]);
  });

  it("matches past a NUL byte, where git's binary heuristic would otherwise decide", REAL_GIT, () => {
    const dir = contentRepo({ files: { "a.ts": "head\0 --channels\n", "b.ts": "x\n" }, label: "nul" });
    expect(selectFlags({ root: dir })).toEqual(["a.ts"]);
  });

  it("hands back a symlink, tracked or not, because grep searches the link and a read follows it", REAL_GIT, () => {
    const dir = contentRepo({ files: { "target.txt": "--channels\n" }, label: "link" });
    symlinkSync("target.txt", join(dir, "tracked.md"));
    gitInTemp({ args: ["add", "tracked.md"], cwd: dir });
    symlinkSync("target.txt", join(dir, "untracked.ts"));
    expect(selectFlags({ root: dir })).toEqual(["tracked.md", "untracked.ts"]);
  });

  it(
    "hands back a tracked file deleted from disk, so the caller's read fails rather than skipping it",
    REAL_GIT,
    () => {
      const dir = contentRepo({ files: { "gone.ts": "--channels\n", "kept.md": "x\n" }, label: "gone" });
      rmSync(join(dir, "gone.ts"));
      expect(selectFlags({ root: dir })).toEqual(["gone.ts"]);
    },
  );

  it("hands back an assume-unchanged and a skip-worktree entry, which grep answers from the index", REAL_GIT, () => {
    const dir = contentRepo({ files: { "a.md": "quiet\n", "b.ts": "quiet\n", "c.md": "quiet\n" }, label: "trust" });
    gitInTemp({ args: ["update-index", "--assume-unchanged", "a.md"], cwd: dir });
    gitInTemp({ args: ["update-index", "--skip-worktree", "b.ts"], cwd: dir });
    writeFileSync(join(dir, "a.md"), "edited on disk: --channels\n");
    writeFileSync(join(dir, "b.ts"), "edited on disk: --channels\n");
    expect(selectFlags({ root: dir })).toEqual(["a.md", "b.ts"]);
  });

  it("refuses a tree holding an untracked nested repository, which grep skips in silence", REAL_GIT, () => {
    const dir = contentRepo({ files: { "a.md": "x\n" }, label: "nested" });
    mkdirSync(join(dir, "inner"));
    gitInTemp({ args: ["init", "--initial-branch=main"], cwd: join(dir, "inner") });
    writeFileSync(join(dir, "inner", "evil.md"), "--channels\n");
    expect(() => selectFlags({ root: dir })).toThrow("as a nested repository");
  });

  it("refuses a selection over an untracked directory it could not open", REAL_GIT, () => {
    const dir = contentRepo({ files: { "a.md": "x\n" }, label: "hidden" });
    mkdirSync(join(dir, "hidden"));
    writeFileSync(join(dir, "hidden", "evil.md"), "--channels\n");
    chmodSync(join(dir, "hidden"), 0o000);
    try {
      expect(() => selectFlags({ root: dir })).toThrow("so the listing is partial");
    } finally {
      chmodSync(join(dir, "hidden"), 0o755);
    }
  });

  it("refuses a selection over a tracked file grep could not read, which it only reports on stderr", REAL_GIT, () => {
    const dir = contentRepo({ files: { "a.md": "x\n", "locked.md": "--channels\n" }, label: "locked" });
    chmodSync(join(dir, "locked.md"), 0o000);
    try {
      expect(() => selectFlags({ root: dir })).toThrow("so its selection is not whole");
    } finally {
      chmodSync(join(dir, "locked.md"), 0o644);
    }
  });

  it("selects the same files under hostile grep config and an ambient pathspec mode", REAL_GIT, () => {
    const dir = contentRepo({ files: { "a.md": "--channels\n", "sub/b.ts": "--discover-channels\n" }, label: "env" });
    gitInTemp({ args: ["config", "grep.patternType", "perl"], cwd: dir });
    gitInTemp({ args: ["config", "grep.fallbackToNoIndex", "true"], cwd: dir });
    gitInTemp({ args: ["config", "submodule.recurse", "true"], cwd: dir });
    gitInTemp({ args: ["config", "core.quotePath", "true"], cwd: dir });
    process.env["GIT_LITERAL_PATHSPECS"] = "1";
    try {
      expect(selectFlags({ root: dir })).toEqual(["a.md", "sub/b.ts"]);
    } finally {
      delete process.env["GIT_LITERAL_PATHSPECS"];
    }
  });

  it("refuses an empty fixed string before running anything", () => {
    expect(() => workingTreeFilesContaining({ fixedStrings: [""], pathspecs: ["*.md"], root: tmpdir() })).toThrow(
      "refuses an empty string or one holding a NUL",
    );
  });
});
