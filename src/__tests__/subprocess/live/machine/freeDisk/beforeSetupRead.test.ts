/**
 * The `before-setup-copy` read over real git and a real tree: `insideGitRepository` answers git's own question,
 * and `observeBeforeSetupCopy` derives the copy beside a temp main checkout, walks it, and counts every `.git`
 * entry in it. The verb's own tests fake this read; this file is the one that runs it. `gitInTemp` per
 * `src/__tests__/tempGitRepo.ts` builds every fixture.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { insideGitRepository, observeBeforeSetupCopy } from "../../../../../live/machine/freeDisk/beforeSetupRead.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh directory under the per-file temp root, resolved through links, removed after the test. */
function freshDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "before-setup-")));
  fixtureDirs.push(dir);
  return dir;
}

/** A main checkout git knows, and its `.before-setup` sibling holding one 64 KiB file. */
function checkoutWithCopy(): { main: string; copy: string } {
  const parent = freshDir();
  const main = join(parent, "repo");
  mkdirSync(main);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  const copy = `${main}.before-setup`;
  mkdirSync(join(copy, "src"), { recursive: true });
  writeFileSync(join(copy, "src", "data.bin"), Buffer.alloc(64 * 1024, 1));
  return { copy, main };
}

describe("insideGitRepository over real git", REAL_GIT_SUITE, () => {
  it("is true inside a repository", () => {
    const { main } = checkoutWithCopy();

    expect(unwrap(insideGitRepository({ dir: main }))).toBe(true);
  });

  it("is false on git's own not-a-repository answer", () => {
    expect(unwrap(insideGitRepository({ dir: freshDir() }))).toBe(false);
  });

  it("is a failed read, never false, for a directory that is not there", () => {
    const missing = join(freshDir(), "gone");

    expect(unwrapErr(insideGitRepository({ dir: missing })).code).toBe("READ_FAILED");
  });
});

describe("observeBeforeSetupCopy over a real tree", REAL_GIT_SUITE, () => {
  it("walks the declared checkout's copy and finds no git entry and no enclosing repository", () => {
    const { main, copy } = checkoutWithCopy();

    const read = unwrap(observeBeforeSetupCopy({ cwd: main, declaredMainCheckouts: [main] }));

    expect(read).toMatchObject({
      checkout: "declared",
      copy: { kind: "directory", path: copy, state: "present", usage: { multiLinkFiles: 0, singleLinkFiles: 1 } },
      gitEntries: 0,
      insideGitRepository: false,
      mainCheckout: main,
    });
  });

  it("counts the one single-link file's own blocks as what removing the copy frees", () => {
    const { main, copy } = checkoutWithCopy();
    const fileBytes = statSync(join(copy, "src", "data.bin")).blocks * 512;

    expect(unwrap(observeBeforeSetupCopy({ cwd: main, declaredMainCheckouts: [main] }))).toMatchObject({
      copy: { usage: { allocatedBytes: fileBytes, freeableBytes: fileBytes } },
    });
  });

  it("counts a symlink named .git inside the copy", () => {
    const { main, copy } = checkoutWithCopy();
    symlinkSync(join(main, ".git"), join(copy, "src", ".git"));

    expect(unwrap(observeBeforeSetupCopy({ cwd: main, declaredMainCheckouts: [main] }))).toMatchObject({
      checkout: "declared",
      gitEntries: 1,
    });
  });

  it("derives nothing for a checkout the declared list does not hold", () => {
    const { main } = checkoutWithCopy();

    expect(unwrap(observeBeforeSetupCopy({ cwd: main, declaredMainCheckouts: [] }))).toEqual({
      checkout: "undeclared",
      kind: "before-setup-copy",
      mainCheckout: main,
    });
  });
});
