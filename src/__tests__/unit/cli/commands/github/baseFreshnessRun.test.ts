import { describe, expect, it } from "vitest";

import {
  type BaseFreshnessRunDeps,
  measureAvailableBaseFreshness,
  measureRequiredBaseFreshness,
} from "../../../../../cli/commands/github/baseFreshnessRun.js";
import { GithubVerbErrors, type GithubVerbResult } from "../../../../../cli/commands/github/errors.js";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { RevertedPath } from "../../../../../outbound/github/mergeGuard.js";
import type { PrTarget } from "../../../../../outbound/github/types.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const HEAD_SHA = "1111111111111111111111111111111111111111";
const BASE_SHA = "2222222222222222222222222222222222222222";

/** A plain fake `GithubPushDeps` — no `vi.fn`, just closures over pre-scripted maps. */
function fakeGit({
  reads = {},
  writeOk = true,
}: {
  reads?: Readonly<Record<string, string>>;
  writeOk?: boolean;
} = {}): { git: GithubPushDeps; outLines: string[] } {
  const outLines: string[] = [];
  return {
    git: {
      cwd: () => "/repo",
      doorLedger: memoryDoorLedger().port,
      out: ({ line }) => outLines.push(line),
      readGit: ({ args }) => {
        const command = args.join(" ");
        const value = reads[command];
        if (value !== undefined) {
          return value;
        }
        throw new Error(`unexpected read: ${command}`);
      },
      writeGit: () => (writeOk ? ok(undefined) : err("fetch failed")),
    },
    outLines,
  };
}

/** Deps whose `isAncestor` and `newPrivateRef` are scripted directly, rather than shelling real git. */
function depsFor({
  git,
  ancestorResult,
  reverted = [],
  driftResult = ok(3),
}: {
  git: GithubPushDeps;
  ancestorResult: GithubVerbResult<boolean>;
  reverted?: readonly RevertedPath[];
  driftResult?: GithubVerbResult<number>;
}): BaseFreshnessRunDeps {
  return {
    countCommitsAhead: () => driftResult,
    git,
    isAncestor: () => ancestorResult,
    measureReverted: () => reverted,
    newPrivateRef: () => "refs/slopweaver/fetch/test",
  };
}

describe("measureRequiredBaseFreshness", () => {
  it("reports fresh when the fetched base is an ancestor of the head", () => {
    const { git } = fakeGit({ reads: { "rev-parse refs/slopweaver/fetch/test^{commit}": BASE_SHA } });
    const result = measureRequiredBaseFreshness({
      cwd: "/repo",
      defaultBranch: "main",
      deps: depsFor({ ancestorResult: ok(true), git }),
      headSha: HEAD_SHA,
      remote: "origin",
    });
    expect(unwrap(result)).toEqual({
      baseBranch: "main",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      kind: "fresh",
      remote: "origin",
      reverted: [],
    });
  });

  it("carries the reverted-files measurement through, even on an otherwise fresh base", () => {
    const { git } = fakeGit({ reads: { "rev-parse refs/slopweaver/fetch/test^{commit}": BASE_SHA } });
    const result = measureRequiredBaseFreshness({
      cwd: "/repo",
      defaultBranch: "main",
      deps: depsFor({
        ancestorResult: ok(true),
        git,
        reverted: [{ path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" }],
      }),
      headSha: HEAD_SHA,
      remote: "origin",
    });
    expect(unwrap(result).reverted).toEqual([{ path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" }]);
  });

  it("still returns the freshness verdict, with an empty reverted list, when measuring reverts throws", () => {
    const { git, outLines } = fakeGit({ reads: { "rev-parse refs/slopweaver/fetch/test^{commit}": BASE_SHA } });
    const result = measureRequiredBaseFreshness({
      cwd: "/repo",
      defaultBranch: "main",
      deps: {
        ...depsFor({ ancestorResult: ok(true), git }),
        measureReverted: () => {
          throw new Error("git diff exploded");
        },
      },
      headSha: HEAD_SHA,
      remote: "origin",
    });
    expect(unwrap(result)).toEqual({
      baseBranch: "main",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      kind: "fresh",
      remote: "origin",
      reverted: [],
    });
    expect(outLines.some((line) => line.includes("could not measure reverted files"))).toBe(true);
  });

  it("reports base-moved when the fetched base is not an ancestor of the head", () => {
    const { git } = fakeGit({ reads: { "rev-parse refs/slopweaver/fetch/test^{commit}": BASE_SHA } });
    const result = measureRequiredBaseFreshness({
      cwd: "/repo",
      defaultBranch: "main",
      deps: depsFor({ ancestorResult: ok(false), git }),
      headSha: HEAD_SHA,
      remote: "origin",
    });
    expect(unwrap(result)).toEqual({
      baseBranch: "main",
      baseSha: BASE_SHA,
      behindBy: 3,
      headSha: HEAD_SHA,
      kind: "base-moved",
      remote: "origin",
      reverted: [],
    });
  });

  // An uncountable drift must not turn a measurable base-moved into an unmeasurable error: it is an input to
  // the queue relaxation alone, so `undefined` leaves the ordinary refusal exactly where it was.
  it("carries an uncountable drift as undefined rather than failing the measurement", () => {
    const { git } = fakeGit({ reads: { "rev-parse refs/slopweaver/fetch/test^{commit}": BASE_SHA } });
    const result = measureRequiredBaseFreshness({
      cwd: "/repo",
      defaultBranch: "main",
      deps: depsFor({
        ancestorResult: ok(false),
        driftResult: err(GithubVerbErrors.revListUnparsed({ cwd: "/repo", text: "shallow clone" })),
        git,
      }),
      headSha: HEAD_SHA,
      remote: "origin",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      baseBranch: "main",
      baseSha: BASE_SHA,
      behindBy: undefined,
      headSha: HEAD_SHA,
      kind: "base-moved",
      remote: "origin",
      reverted: [],
    });
  });

  it("never counts the drift on a fresh base", () => {
    const { git } = fakeGit({ reads: { "rev-parse refs/slopweaver/fetch/test^{commit}": BASE_SHA } });
    const result = measureRequiredBaseFreshness({
      cwd: "/repo",
      defaultBranch: "main",
      deps: depsFor({
        ancestorResult: ok(true),
        driftResult: err(GithubVerbErrors.revListUnparsed({ cwd: "/repo", text: "never called" })),
        git,
      }),
      headSha: HEAD_SHA,
      remote: "origin",
    });
    expect(unwrap(result)).toEqual({
      baseBranch: "main",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      kind: "fresh",
      remote: "origin",
      reverted: [],
    });
  });

  it("is Err when the fetch itself fails, and still attempts cleanup", () => {
    const { git, outLines } = fakeGit({ writeOk: false });
    const result = measureRequiredBaseFreshness({
      cwd: "/repo",
      defaultBranch: "main",
      deps: depsFor({ ancestorResult: ok(true), git }),
      headSha: HEAD_SHA,
      remote: "origin",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(
      GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["fetch failed"] }),
    );
    // Cleanup still ran (and itself failed, since nothing was fetched) — surfaced, not swallowed.
    expect(outLines.some((line) => line.includes("could not delete private ref"))).toBe(true);
  });

  it("is Err when the ancestry check itself fails, never collapsed into a freshness verdict", () => {
    const { git } = fakeGit({ reads: { "rev-parse refs/slopweaver/fetch/test^{commit}": BASE_SHA } });
    const result = measureRequiredBaseFreshness({
      cwd: "/repo",
      defaultBranch: "main",
      deps: depsFor({ ancestorResult: err(GithubVerbErrors.ancestryFailed({ cause: "merge-base exploded" })), git }),
      headSha: HEAD_SHA,
      remote: "origin",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(GithubVerbErrors.ancestryFailed({ cause: "merge-base exploded" }));
  });
});

describe("measureAvailableBaseFreshness", () => {
  const target: PrTarget = { base: "main", head: "feature", owner: "acme", repo: "widgets" };

  it("skips a different-owner fork head", () => {
    const { git } = fakeGit();
    const result = measureAvailableBaseFreshness({
      cwd: "/repo",
      deps: depsFor({ ancestorResult: ok(true), git }),
      remote: "origin",
      target: { ...target, head: "someoneelse:feature" },
    });
    expect(unwrap(result)).toMatchObject({ kind: "skipped" });
  });

  it("skips when there is no readable origin remote", () => {
    const git: GithubPushDeps = {
      cwd: () => "/repo",
      doorLedger: memoryDoorLedger().port,
      out: () => {},
      readGit: () => {
        throw new Error("not a git repository");
      },
      writeGit: () => ok(undefined),
    };
    const result = measureAvailableBaseFreshness({
      cwd: "/repo",
      deps: depsFor({ ancestorResult: ok(true), git }),
      remote: "origin",
      target,
    });
    expect(unwrap(result)).toMatchObject({ kind: "skipped" });
  });

  it("skips when origin does not point at the target repository", () => {
    const { git } = fakeGit({ reads: { "remote get-url origin": "https://github.com/other/repo.git" } });
    const result = measureAvailableBaseFreshness({
      cwd: "/repo",
      deps: depsFor({ ancestorResult: ok(true), git }),
      remote: "origin",
      target,
    });
    expect(unwrap(result)).toMatchObject({ kind: "skipped" });
  });

  it("skips when the local branch does not exist in this checkout", () => {
    const { git } = fakeGit({ reads: { "remote get-url origin": "https://github.com/acme/widgets.git" } });
    const result = measureAvailableBaseFreshness({
      cwd: "/repo",
      deps: depsFor({ ancestorResult: ok(true), git }),
      remote: "origin",
      target,
    });
    expect(unwrap(result)).toMatchObject({ kind: "skipped" });
  });

  it("skips when the remote cannot be reached over the available Git transport", () => {
    const { git } = fakeGit({
      reads: {
        "remote get-url origin": "https://github.com/acme/widgets.git",
        "rev-parse refs/heads/feature": HEAD_SHA,
      },
    });
    const throwingGit: GithubPushDeps = {
      ...git,
      readGit: (input) => {
        if (input.args[0] === "ls-remote") {
          throw new Error("could not resolve host");
        }
        return git.readGit(input);
      },
    };
    const result = measureAvailableBaseFreshness({
      cwd: "/repo",
      deps: depsFor({ ancestorResult: ok(true), git: throwingGit }),
      remote: "origin",
      target,
    });
    expect(unwrap(result)).toMatchObject({ kind: "skipped" });
  });

  it("measures and reports fresh once every structural prerequisite is present", () => {
    const { git } = fakeGit({
      reads: {
        "ls-remote --symref origin HEAD": "ref: refs/heads/main\tHEAD",
        "remote get-url origin": "https://github.com/acme/widgets.git",
        "rev-parse refs/heads/feature": HEAD_SHA,
        "rev-parse refs/slopweaver/fetch/test^{commit}": BASE_SHA,
      },
    });
    const result = measureAvailableBaseFreshness({
      cwd: "/repo",
      deps: depsFor({ ancestorResult: ok(true), git }),
      remote: "origin",
      target,
    });
    expect(unwrap(result)).toEqual({
      baseBranch: "main",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      kind: "fresh",
      remote: "origin",
      reverted: [],
    });
  });
});
