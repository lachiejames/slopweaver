/**
 * The already-landed measurement's own edges: what it measures, and every shape it declines to measure.
 *
 * The load-bearing property is that it fails OPEN. A missing checkout, a mismatched remote, a fetch that
 * failed and a git that could not answer are all `skipped` — only a positive patch-id answer ever reaches
 * the gate, because a shallow clone makes this measurement wrong rather than absent.
 */
import { describe, expect, it } from "vitest";

import {
  type AlreadyLandedRunDeps,
  measureAvailableAlreadyLanded,
} from "../../../../../cli/commands/github/alreadyLandedRun.js";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import type { PrTarget } from "../../../../../outbound/github/types.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

// register-class: re-derives-or-rebuilds-what-already-exists (docs/recurring-failure-register/bindings.md)

const TARGET: PrTarget = { base: "main", head: "a-branch", owner: "acme", repo: "widget" };
const HEAD_SHA = "1111111111111111111111111111111111111111";

const REMOTE_READS: Readonly<Record<string, string>> = {
  "remote get-url origin": "git@github.com:acme/widget.git",
  "rev-parse refs/heads/a-branch": HEAD_SHA,
  "rev-parse refs/slopweaver/fetch/test^{commit}": "2222222222222222222222222222222222222222",
};

/** A plain fake `GithubPushDeps` — no `vi.fn`, just closures over pre-scripted maps. */
function fakeGit({
  reads = REMOTE_READS,
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

/** Deps whose patch-id detector is scripted directly, rather than shelling real git. */
function depsFor({ git, absorbed }: { git: GithubPushDeps; absorbed: boolean | null }): AlreadyLandedRunDeps {
  return { absorbed: () => absorbed, git, newPrivateRef: () => "refs/slopweaver/fetch/test" };
}

describe("measureAvailableAlreadyLanded", () => {
  it("reports landed when every commit is already patch-identical to the base", () => {
    const { git } = fakeGit();
    const measured = measureAvailableAlreadyLanded({
      cwd: "/repo",
      deps: depsFor({ absorbed: true, git }),
      remote: "origin",
      target: TARGET,
    });
    expect(unwrap(measured)).toStrictEqual({
      baseBranch: "origin/main",
      headBranch: "a-branch",
      kind: "landed",
    });
  });

  it("reports not-landed when the branch carries work the base does not have", () => {
    const { git } = fakeGit();
    const measured = measureAvailableAlreadyLanded({
      cwd: "/repo",
      deps: depsFor({ absorbed: false, git }),
      remote: "origin",
      target: TARGET,
    });
    expect(unwrap(measured)).toStrictEqual({ kind: "not-landed" });
  });

  it("SKIPS rather than refuses when git cannot answer, because an unanswerable comparison is not a finding", () => {
    const { git } = fakeGit();
    const measured = measureAvailableAlreadyLanded({
      cwd: "/repo",
      deps: depsFor({ absorbed: null, git }),
      remote: "origin",
      target: TARGET,
    });
    expect(unwrap(measured).kind).toBe("skipped");
  });

  it("SKIPS when the base branch could not be fetched", () => {
    const { git } = fakeGit({ writeOk: false });
    const measured = measureAvailableAlreadyLanded({
      cwd: "/repo",
      deps: depsFor({ absorbed: true, git }),
      remote: "origin",
      target: TARGET,
    });
    expect(unwrap(measured).kind).toBe("skipped");
  });

  it("deletes the private ref it minted, on the landed path", () => {
    const { git, outLines } = fakeGit();
    measureAvailableAlreadyLanded({
      cwd: "/repo",
      deps: depsFor({ absorbed: true, git }),
      remote: "origin",
      target: TARGET,
    });
    expect(outLines).toStrictEqual([]);
  });

  it("SKIPS a different-owner fork head, which is never measured locally", () => {
    const { git } = fakeGit();
    const measured = measureAvailableAlreadyLanded({
      cwd: "/repo",
      deps: depsFor({ absorbed: true, git }),
      remote: "origin",
      target: { ...TARGET, head: "someone-else:a-branch" },
    });
    expect(unwrap(measured).kind).toBe("skipped");
  });

  it("SKIPS when the remote points at a different repository", () => {
    const { git } = fakeGit({ reads: { ...REMOTE_READS, "remote get-url origin": "git@github.com:other/thing.git" } });
    const measured = measureAvailableAlreadyLanded({
      cwd: "/repo",
      deps: depsFor({ absorbed: true, git }),
      remote: "origin",
      target: TARGET,
    });
    expect(unwrap(measured).kind).toBe("skipped");
  });

  it("SKIPS when the head branch does not exist in this checkout", () => {
    const { git } = fakeGit({
      reads: {
        "remote get-url origin": "git@github.com:acme/widget.git",
        "rev-parse refs/slopweaver/fetch/test^{commit}": "2222222222222222222222222222222222222222",
      },
    });
    const measured = measureAvailableAlreadyLanded({
      cwd: "/repo",
      deps: depsFor({ absorbed: true, git }),
      remote: "origin",
      target: TARGET,
    });
    expect(unwrap(measured).kind).toBe("skipped");
  });

  it("measures against the target's OWN base, not the remote's default branch", () => {
    const fetches: string[] = [];
    const { git } = fakeGit();
    const deps: AlreadyLandedRunDeps = {
      absorbed: ({ trunk }) => {
        fetches.push(trunk);
        return false;
      },
      git: { ...git, writeGit: ({ args }) => (fetches.push(args.join(" ")), ok(undefined)) },
      newPrivateRef: () => "refs/slopweaver/fetch/test",
    };
    measureAvailableAlreadyLanded({
      cwd: "/repo",
      deps,
      remote: "origin",
      target: { ...TARGET, base: "release-3" },
    });
    expect(fetches[0]).toBe("fetch origin refs/heads/release-3:refs/slopweaver/fetch/test");
  });
});
