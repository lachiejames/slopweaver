/**
 * The hook's effectful shell, driven over a plain injected git seam and a real throwaway checkout directory.
 *
 * Every case here stops SHORT of running yarn — the install itself is `runImmutableInstall`'s subprocess and
 * is proved end to end against a real lockfile-changing ref move, not here. What this file holds down is the
 * wiring: that a squash merge reaches the INDEX comparison rather than the empty `ORIG_HEAD..HEAD` one, that
 * a `--deps shared` worktree is refused before anything writes to the tree other checkouts read, and that a
 * git read which simply failed reports as unchecked rather than as clean.
 *
 * The `git` seam is a plain function passed in, not a mock: it answers from a literal table of the exact
 * argument lists the code under test is expected to ask for, so an unexpected question answers `undefined`
 * and the test reddens.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CheckoutInspectDeps } from "../../../checkouts/inspect.js";
import { runRefMoveInstall } from "../../../checkouts/refMoveInstallRun.js";
import { unwrap } from "../../../lib/result.js";
import { withDepsLock } from "../../../worktree/depsLock.js";

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";

const dirs: string[] = [];

/** A throwaway checkout directory, removed after the test that minted it. */
function checkoutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ref-move-"));
  dirs.push(dir);
  return dir;
}

/** A throwaway checkout with a `.git` directory, so its deps lock has a git directory to live in. */
function gitCheckoutDir(): string {
  const dir = checkoutDir();
  mkdirSync(join(dir, ".git"));
  return dir;
}

/** The git answers that make a post-checkout move change `yarn.lock`, so the hook installs. */
const LOCKFILE_MOVE = new Map([[`diff --name-only ${OLD_SHA} ${NEW_SHA}`, "yarn.lock"]]);

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A git seam that answers only the exact argument lists it was given, and `undefined` to anything else. */
function gitSeam({ answers }: { answers: ReadonlyMap<string, string> }): CheckoutInspectDeps {
  return {
    git: ({ args }) => answers.get(args.join(" ")),
    mtimeMs: () => undefined,
  };
}

describe("runRefMoveInstall", () => {
  it("refuses a `--deps shared` worktree before it reads a single ref", () => {
    const dir = checkoutDir();
    const shared = checkoutDir();
    symlinkSync(shared, join(dir, "node_modules"));
    const outcome = runRefMoveInstall({
      args: [OLD_SHA, NEW_SHA, "1"],
      cwd: dir,
      deps: gitSeam({ answers: new Map() }),
      hook: "post-checkout",
    });
    expect(outcome).toEqual({
      did: "skipped",
      why: "node_modules is a symlink into a shared tree other checkouts read",
    });
  });

  it("reports a real `node_modules` directory as not shared, and goes on to look at the move", () => {
    const dir = checkoutDir();
    writeFileSync(join(dir, "node_modules"), "", "utf8"); // a plain file: present, and not a symlink
    const outcome = runRefMoveInstall({
      args: [OLD_SHA, NEW_SHA, "1"],
      cwd: dir,
      deps: gitSeam({
        answers: new Map([[`diff --name-only ${OLD_SHA} ${NEW_SHA}`, "src/foo.ts\ndocs/bar.md"]]),
      }),
      hook: "post-checkout",
    });
    expect(outcome).toEqual({
      did: "current",
      why: "the move changed 2 file(s), none of them dependency-defining",
    });
  });

  it("reads a post-merge's own refs and compares ORIG_HEAD against HEAD", () => {
    const outcome = runRefMoveInstall({
      args: ["0"],
      cwd: checkoutDir(),
      deps: gitSeam({
        answers: new Map([
          ["rev-parse HEAD", NEW_SHA],
          ["rev-parse ORIG_HEAD", OLD_SHA],
          [`diff --name-only ${OLD_SHA} ${NEW_SHA}`, "README.md"],
        ]),
      }),
      hook: "post-merge",
    });
    expect(outcome).toEqual({
      did: "current",
      why: "the move changed 1 file(s), none of them dependency-defining",
    });
  });

  // The falsifiable half of the squash arm: the commits comparison is answered with an EMPTY diff — what git
  // really returns for `ORIG_HEAD..HEAD` after a squash — so a run that took that arm would report "current"
  // over a lockfile it never saw. Only the index comparison finds `yarn.lock` here.
  it("takes the INDEX comparison on a squash merge, where the commit diff is empty", () => {
    const dir = gitCheckoutDir();
    const outcome = runRefMoveInstall({
      args: ["1"],
      cwd: dir,
      deps: gitSeam({
        answers: new Map([
          ["rev-parse HEAD", OLD_SHA],
          ["rev-parse ORIG_HEAD", OLD_SHA],
          [`diff --name-only ${OLD_SHA} ${OLD_SHA}`, ""],
          [`diff --cached --name-only ${OLD_SHA}`, "yarn.lock"],
        ]),
      }),
      hook: "post-merge",
      install: ({ cwd, why }) => ({ detail: `installed in ${cwd}`, did: "installed", why }),
    });
    expect(outcome).toEqual({
      detail: `installed in ${dir}`,
      did: "installed",
      why: "the move changed yarn.lock",
    });
  });

  it("installs holding the checkout's deps lock, so no provision can start inside the hook's install", () => {
    const dir = gitCheckoutDir();
    const provisionsRefused: boolean[] = [];
    const outcome = runRefMoveInstall({
      args: [OLD_SHA, NEW_SHA, "1"],
      cwd: dir,
      deps: gitSeam({ answers: LOCKFILE_MOVE }),
      hook: "post-checkout",
      install: ({ cwd, why }) => {
        provisionsRefused.push(withDepsLock({ act: () => undefined, waitMs: 0, worktree: cwd }).isErr());
        return { detail: "installed", did: "installed", why };
      },
    });
    expect(outcome).toEqual({ detail: "installed", did: "installed", why: "the move changed yarn.lock" });
    expect(provisionsRefused).toEqual([true]);
  });

  it("installs nothing, and names the failure, while a provision holds the checkout's deps lock", () => {
    const dir = gitCheckoutDir();
    const installs: string[] = [];
    const outcome = unwrap(
      withDepsLock({
        act: () =>
          runRefMoveInstall({
            args: [OLD_SHA, NEW_SHA, "1"],
            cwd: dir,
            deps: gitSeam({ answers: LOCKFILE_MOVE }),
            hook: "post-checkout",
            install: ({ cwd, why }) => {
              installs.push(cwd);
              return { detail: "installed", did: "installed", why };
            },
          }),
        waitMs: 0,
        worktree: dir,
      }),
    );
    expect(outcome).toEqual({
      detail: expect.stringContaining("another process holds this checkout's node_modules, so nothing was installed: "),
      did: "failed",
      why: "the move changed yarn.lock",
    });
    expect(installs).toEqual([]);
  });

  it("reports a diff git could not take as unchecked, never as clean", () => {
    const outcome = runRefMoveInstall({
      args: [OLD_SHA, NEW_SHA, "1"],
      cwd: checkoutDir(),
      deps: gitSeam({ answers: new Map() }),
      hook: "post-checkout",
    });
    expect(outcome).toEqual({
      did: "skipped",
      why: "git could not diff the move, so nothing here knows what it brought in",
    });
  });
});
