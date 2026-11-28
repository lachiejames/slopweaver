/**
 * The built-CLI hook's shell, driven over a plain injected git seam, an injected emit seam and a real
 * throwaway checkout directory. Nothing here spawns esbuild: what is under test is the ROUTING — that a
 * checkout with no built tree is skipped before any git read, that a squash merge reaches the INDEX
 * comparison, that a move touching only tests reports current, and that a failed git diff reports as
 * unchecked rather than as clean.
 *
 * The `git` seam is a plain function passed in, not a mock: it answers from a literal table of the exact
 * argument lists the code under test is expected to ask for, so an unexpected question answers `undefined`
 * and the test reddens.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BUILD_MANIFEST_FILE } from "../../../builtCli/staleness.js";
import type { CheckoutInspectDeps } from "../../../checkouts/inspect.js";
import type { RefMoveBuildOutcome } from "../../../checkouts/refMoveBuild.js";
import {
  rebuildNow,
  rebuildOutcomeOf,
  refMoveDevBuildArgv,
  runRefMoveBuild,
} from "../../../checkouts/refMoveBuildRun.js";

describe("refMoveDevBuildArgv", () => {
  it("runs dev build from source with --yield-to-lap, so a pull never stalls 120 s through a lap", () => {
    expect(refMoveDevBuildArgv()).toEqual(["src/cli/index.ts", "dev", "build", "--yield-to-lap"]);
  });
});

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";

const dirs: string[] = [];

/** A throwaway checkout directory, removed after the test that minted it. */
function checkoutDir({ built }: { built: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "ref-build-"));
  dirs.push(dir);
  if (built) {
    mkdirSync(join(dir, "dist-cli"), { recursive: true });
    writeFileSync(join(dir, "dist-cli", BUILD_MANIFEST_FILE), '{"builtAtIso":"x","stamps":[]}\n');
  }
  return dir;
}

/** A git seam answering one literal question, and `undefined` to anything else. */
function gitAnswering({ table }: { table: Readonly<Record<string, string>> }): CheckoutInspectDeps {
  return {
    git: ({ args }) => table[args.join(" ")],
    mtimeMs: () => undefined,
  };
}

const rebuilt: { cwd: string; why: string }[] = [];

/** The emit seam: records the call and reports success, so the routing is provable without a build. */
function fakeRebuild({ cwd, why }: { cwd: string; why: string }): RefMoveBuildOutcome {
  rebuilt.push({ cwd, why });
  return { detail: "4166 file(s)", did: "rebuilt", why };
}

afterEach(() => {
  rebuilt.length = 0;
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

describe("runRefMoveBuild", () => {
  it("skips a checkout with no built tree, before it asks git anything", () => {
    const cwd = checkoutDir({ built: false });

    const outcome = runRefMoveBuild({
      args: [OLD_SHA, NEW_SHA, "1"],
      cwd,
      deps: gitAnswering({ table: {} }),
      hook: "post-checkout",
      rebuild: fakeRebuild,
    });

    expect(outcome.did).toBe("skipped");
    expect(outcome.why).toBe("this checkout has no dist-cli, so nothing here can be stale");
    expect(rebuilt).toEqual([]);
  });

  it("rebuilds when a branch checkout brought in source", () => {
    const cwd = checkoutDir({ built: true });

    const outcome = runRefMoveBuild({
      args: [OLD_SHA, NEW_SHA, "1"],
      cwd,
      deps: gitAnswering({
        table: { [`diff --name-only ${OLD_SHA} ${NEW_SHA}`]: "docs/a.md\nsrc/cli/main.ts\n" },
      }),
      hook: "post-checkout",
      rebuild: fakeRebuild,
    });

    expect(outcome.did).toBe("rebuilt");
    expect(outcome.why).toBe("the move changed src/cli/main.ts and 0 other built file(s)");
    expect(rebuilt).toEqual([{ cwd, why: "the move changed src/cli/main.ts and 0 other built file(s)" }]);
  });

  it("reads a SQUASH merge off the index, which leaves ORIG_HEAD and HEAD on one commit", () => {
    const cwd = checkoutDir({ built: true });

    const outcome = runRefMoveBuild({
      args: ["1"],
      cwd,
      deps: gitAnswering({
        table: {
          "rev-parse HEAD": OLD_SHA,
          "rev-parse ORIG_HEAD": OLD_SHA,
          [`diff --cached --name-only ${OLD_SHA}`]: "src/builtCli/guard.ts\n",
        },
      }),
      hook: "post-merge",
      rebuild: fakeRebuild,
    });

    expect(outcome.did).toBe("rebuilt");
    expect(rebuilt.length).toBe(1);
  });

  it("reports current — not rebuilt — when the move touched only the test lane", () => {
    const cwd = checkoutDir({ built: true });

    const outcome = runRefMoveBuild({
      args: [OLD_SHA, NEW_SHA, "1"],
      cwd,
      deps: gitAnswering({
        table: { [`diff --name-only ${OLD_SHA} ${NEW_SHA}`]: "src/__tests__/unit/a.test.ts\n" },
      }),
      hook: "post-checkout",
      rebuild: fakeRebuild,
    });

    expect(outcome.did).toBe("current");
    expect(outcome.why).toBe("the move changed 1 file(s), none of them built");
    expect(rebuilt).toEqual([]);
  });

  it("reports unchecked — never clean — when git could not diff the move", () => {
    const cwd = checkoutDir({ built: true });

    const outcome = runRefMoveBuild({
      args: [OLD_SHA, NEW_SHA, "1"],
      cwd,
      deps: gitAnswering({ table: {} }),
      hook: "post-checkout",
      rebuild: fakeRebuild,
    });

    expect(outcome.did).toBe("skipped");
    expect(outcome.why).toBe("git could not diff the move, so nothing here knows what it brought in");
  });

  it("skips a file checkout, which moves no ref", () => {
    const cwd = checkoutDir({ built: true });

    const outcome = runRefMoveBuild({
      args: [OLD_SHA, NEW_SHA, "0"],
      cwd,
      deps: gitAnswering({ table: {} }),
      hook: "post-checkout",
      rebuild: fakeRebuild,
    });

    expect(outcome.did).toBe("skipped");
    expect(outcome.why).toBe("a file checkout, which moves no ref");
  });
});

describe("rebuildOutcomeOf", () => {
  const why = "the move brought in source the built tree was compiled from";

  it("reports the build's own verdict line when it succeeded", () => {
    const outcome = rebuildOutcomeOf({
      run: { status: 0, stderr: "", stdout: "dev build: 4189 file(s) emitted\ndev build: PASS\n" },
      why,
    });

    expect(outcome).toEqual({ detail: "dev build: PASS", did: "rebuilt", why });
  });

  it("still reports rebuilt when a successful build printed nothing", () => {
    const outcome = rebuildOutcomeOf({ run: { status: 0, stderr: "", stdout: "" }, why });

    expect(outcome).toEqual({ detail: "dev build exited 0", did: "rebuilt", why });
  });

  it("names the first stderr line of a build that failed", () => {
    const outcome = rebuildOutcomeOf({
      run: { status: 1, stderr: "esbuild: could not resolve #lib/x.js\nsecond line\n", stdout: "" },
      why,
    });

    expect(outcome).toEqual({ detail: "esbuild: could not resolve #lib/x.js", did: "failed", why });
  });

  // A hook line reading only `failed` tells the next session nothing, so a silent failure names its code.
  it("names the exit code when a failed build printed no stderr", () => {
    const outcome = rebuildOutcomeOf({ run: { status: 2, stderr: "   \n", stdout: "" }, why });

    expect(outcome).toEqual({ detail: "dev build exited 2", did: "failed", why });
  });

  it("names a null status, which is how a killed build arrives", () => {
    const outcome = rebuildOutcomeOf({ run: { status: null, stderr: "", stdout: "" }, why });

    expect(outcome).toEqual({ detail: "dev build exited null", did: "failed", why });
  });
});

describe("rebuildNow", () => {
  it("asks the emit seam for the checkout it was given and reads what it returned", () => {
    const asked: string[] = [];

    const outcome = rebuildNow({
      cwd: "/repo",
      runBuild: ({ cwd }) => {
        asked.push(cwd);
        return { status: 0, stderr: "", stdout: "dev build: PASS\n" };
      },
      why: "a source file moved",
    });

    expect(asked).toEqual(["/repo"]);
    expect(outcome).toEqual({ detail: "dev build: PASS", did: "rebuilt", why: "a source file moved" });
  });
});
