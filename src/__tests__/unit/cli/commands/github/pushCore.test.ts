import { describe, expect, it } from "vitest";
import { type GithubPushPlan, hookSatisfiedPushArgs, prePushHookStdin } from "../../../../../admit/githubPush.js";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import {
  GITHUB_PUSH_FLAG_NAMES,
  type GithubPushArgs,
  githubPushDoorRequest,
  githubPushPlan,
  githubRepoFromRemote,
  invocationDir,
  parseGithubPushArgs,
  parseRemoteSnapshot,
  pushStandingDir,
} from "../../../../../cli/commands/github/pushCore.js";
import { err, ok } from "../../../../../lib/result.js";
import { salvagePushArgs } from "../../../../../worktree/salvagePush.js";

const LOCAL_SHA = "1111111111111111111111111111111111111111";
const REMOTE_SHA = "2222222222222222222222222222222222222222";

/** Unwrap a successful argument parse, throwing on the wrong arm. */
function parsedArgs({ argv }: { argv: readonly string[] }): GithubPushArgs {
  const parsed = parseGithubPushArgs({ argv });
  if (!parsed.isOk()) throw new Error(parsed.error.join("; "));
  return parsed.value;
}

/** Unwrap a successful push plan, throwing on the wrong arm. */
function planned({ args, branch = "feature" }: { args: GithubPushArgs; branch?: string }): GithubPushPlan {
  const result = githubPushPlan({
    args,
    facts: {
      branch,
      defaultBranch: "main",
      localSha: LOCAL_SHA,
      remoteBranchSha: REMOTE_SHA,
      repo: "owner/repo",
      repoRoot: "/repo",
    },
  });
  if (!result.isOk()) throw new Error(result.error.message);
  return result.value;
}

const NO_ACK = { acknowledge: [], acknowledgeAll: false, reason: undefined };

describe("parseGithubPushArgs", () => {
  it("defaults to origin and a normal push", () => {
    expect(parsedArgs({ argv: [] })).toEqual({
      baseFreshnessAcknowledgement: NO_ACK,
      cwd: undefined,
      dryRun: false,
      forceWithLease: false,
      home: undefined,
      orphanAbove: [],
      remote: "origin",
    });
  });

  it("parses every documented override", () => {
    expect(
      parsedArgs({
        argv: [
          "--cwd",
          "/repo",
          "--remote",
          "upstream",
          "--home",
          "/state",
          "--force-with-lease",
          "--self-review",
          "review.json",
          "--orphan-above",
          "41,42",
          "--dry-run",
        ],
      }),
    ).toEqual({
      baseFreshnessAcknowledgement: NO_ACK,
      cwd: "/repo",
      dryRun: true,
      forceWithLease: true,
      home: "/state",
      orphanAbove: [41, 42],
      remote: "upstream",
      selfReviewSource: "review.json",
    });
  });

  it("parses the base-freshness acknowledgement flags", () => {
    expect(
      parsedArgs({ argv: ["--acknowledge", "base-moved", "--acknowledge-all", "--reason", "known flake"] })
        .baseFreshnessAcknowledgement,
    ).toEqual({ acknowledge: ["base-moved"], acknowledgeAll: true, reason: "known flake" });
  });

  it("refuses a blank remote and an unknown flag", () => {
    expect(parseGithubPushArgs({ argv: ["--remote", ""] })).toEqual(err(["--remote must not be blank"]));
    expect(parseGithubPushArgs({ argv: ["--unknown"] }).isOk()).toBe(false);
  });

  it("requires --reason alongside --acknowledge-all", () => {
    expect(parseGithubPushArgs({ argv: ["--acknowledge-all"] })).toEqual(
      err(['--acknowledge-all must be paired with --reason "…" explaining why every finding is accepted']),
    );
  });

  it("advertises exactly the parser's flags", () => {
    expect(GITHUB_PUSH_FLAG_NAMES.toSorted()).toEqual(
      [
        "--cwd",
        "--remote",
        "--home",
        "--dry-run",
        "--force-with-lease",
        "--self-review",
        "--acknowledge",
        "--acknowledge-all",
        "--reason",
        "--orphan-above",
      ].toSorted(),
    );
  });
});

describe("githubRepoFromRemote", () => {
  it("accepts HTTPS, SSH URL and SCP-like remotes without retaining credentials or host aliases", () => {
    expect(githubRepoFromRemote({ url: "https://token@example.test/owner/repo.git" })).toBe("owner/repo");
    expect(githubRepoFromRemote({ url: "ssh://git@example.test/owner/repo.git" })).toBe("owner/repo");
    expect(githubRepoFromRemote({ url: "git@github-personal:owner/repo.git" })).toBe("owner/repo");
  });

  it("refuses local paths and repository paths that are not owner/name", () => {
    expect(githubRepoFromRemote({ url: "/tmp/repo.git" })).toBeUndefined();
    expect(githubRepoFromRemote({ url: "git@example.test:owner/team/repo.git" })).toBeUndefined();
  });
});

describe("parseRemoteSnapshot", () => {
  it("returns the default branch and exact target SHA", () => {
    expect(
      parseRemoteSnapshot({
        branch: "feature",
        text: `ref: refs/heads/main\tHEAD\n${LOCAL_SHA}\tHEAD\n${REMOTE_SHA}\trefs/heads/feature\n`,
      }),
    ).toEqual(ok({ branchSha: REMOTE_SHA, defaultBranch: "main" }));
  });

  it("represents an absent target branch without inventing a SHA", () => {
    expect(parseRemoteSnapshot({ branch: "new", text: `ref: refs/heads/main\tHEAD\n${LOCAL_SHA}\tHEAD\n` })).toEqual(
      ok({ branchSha: undefined, defaultBranch: "main" }),
    );
  });

  it("refuses when the remote default branch cannot be proved", () => {
    expect(parseRemoteSnapshot({ branch: "feature", text: `${REMOTE_SHA}\trefs/heads/feature\n` })).toEqual(
      err(GithubVerbErrors.remoteDefaultUnreported()),
    );
  });

  it("refuses a malformed target SHA instead of treating an existing branch as absent", () => {
    expect(
      parseRemoteSnapshot({
        branch: "feature",
        text: `ref: refs/heads/main\tHEAD\n${LOCAL_SHA}\tHEAD\nnot-a-sha\trefs/heads/feature\n`,
      }),
    ).toEqual(err(GithubVerbErrors.remoteShaInvalid({ ref: "refs/heads/feature" })));
  });
});

describe("githubPushPlan", () => {
  it("emits only current-branch to same-name remote-branch refspecs", () => {
    expect(planned({ args: parsedArgs({ argv: [] }) }).gitArgs).toEqual([
      "push",
      "--set-upstream",
      "origin",
      `${LOCAL_SHA}^{commit}:refs/heads/feature`,
    ]);
  });

  it("makes a force-with-lease exact against the measured remote SHA", () => {
    expect(planned({ args: parsedArgs({ argv: ["--force-with-lease"] }) }).gitArgs).toEqual([
      "push",
      "--set-upstream",
      `--force-with-lease=refs/heads/feature:${REMOTE_SHA}`,
      "origin",
      `${LOCAL_SHA}^{commit}:refs/heads/feature`,
    ]);
  });

  it("leases against absence when the remote branch does not exist yet", () => {
    const args = parsedArgs({ argv: ["--force-with-lease"] });
    const result = githubPushPlan({
      args,
      facts: {
        branch: "new-branch",
        defaultBranch: "main",
        localSha: LOCAL_SHA,
        remoteBranchSha: undefined,
        repo: "owner/repo",
        repoRoot: "/repo",
      },
    });
    if (!result.isOk()) throw new Error(result.error.message);
    expect(result.value.gitArgs).toEqual([
      "push",
      "--set-upstream",
      "--force-with-lease=refs/heads/new-branch:",
      "origin",
      `${LOCAL_SHA}^{commit}:refs/heads/new-branch`,
    ]);
  });

  it("refuses the remote default branch", () => {
    expect(
      githubPushPlan({
        args: parsedArgs({ argv: [] }),
        facts: {
          branch: "main",
          defaultBranch: "main",
          localSha: LOCAL_SHA,
          remoteBranchSha: REMOTE_SHA,
          repo: "owner/repo",
          repoRoot: "/repo",
        },
      }),
    ).toEqual(err(GithubVerbErrors.pushDefaultBranch({ defaultBranch: "main" })));
  });

  it("describes the door write without a credential-bearing URL", () => {
    const plan = planned({ args: parsedArgs({ argv: ["--force-with-lease"] }) });
    expect(githubPushDoorRequest({ home: "/state", plan })).toEqual({
      action: { kind: "verb", noun: "github", verb: "push" },
      artifact: {
        branch: "feature",
        forceWithLease: true,
        localSha: LOCAL_SHA,
        remote: "origin",
        remoteBranchSha: REMOTE_SHA,
        repo: "owner/repo",
      },
      meta: { createsWorkItem: false, effect: "external-write", home: "/state", requiresApproval: false },
    });
  });

  it("records a remote branch the remote does not have yet as JSON null", () => {
    const plan = { ...planned({ args: parsedArgs({ argv: [] }) }), remoteBranchSha: undefined };
    expect(githubPushDoorRequest({ home: "/state", plan }).artifact).toEqual({
      branch: "feature",
      forceWithLease: false,
      localSha: LOCAL_SHA,
      remote: "origin",
      remoteBranchSha: null,
      repo: "owner/repo",
    });
  });
});

describe("invocationDir", () => {
  it("stands where the process was run when no --cwd was passed", () => {
    expect(invocationDir({ cwd: undefined })).toBe(process.cwd());
  });

  it("stands in the named directory", () => {
    expect(invocationDir({ cwd: "/repo-alpha" })).toBe("/repo-alpha");
  });
});

describe("pushStandingDir", () => {
  const deps = { cwd: (): string => "/driver-cwd" };

  it("asks the injected working-directory edge when no --cwd was passed", () => {
    expect(pushStandingDir({ args: {}, deps })).toBe("/driver-cwd");
  });

  it("stands in the named directory, even an empty one, without asking the edge", () => {
    expect(pushStandingDir({ args: { cwd: "/repo-alpha" }, deps })).toBe("/repo-alpha");
    expect(pushStandingDir({ args: { cwd: "" }, deps })).toBe("");
  });
});

describe("prePushHookStdin", () => {
  // Measured against a real `git push --set-upstream origin <sha>^{commit}:refs/heads/<branch>`:
  // the local ref is the source refspec as typed, and an absent remote branch is forty zeros.
  it("spells the line git feeds the hook, with the remote SHA it read", () => {
    const plan = planned({ args: parsedArgs({ argv: [] }) });
    expect(prePushHookStdin({ plan })).toBe(`${LOCAL_SHA}^{commit} ${LOCAL_SHA} refs/heads/feature ${REMOTE_SHA}\n`);
  });

  it("names an absent remote branch with forty zeros, as git does", () => {
    const plan = { ...planned({ args: parsedArgs({ argv: [] }) }), remoteBranchSha: undefined };
    expect(prePushHookStdin({ plan })).toBe(
      `${LOCAL_SHA}^{commit} ${LOCAL_SHA} refs/heads/feature ${"0".repeat(40)}\n`,
    );
  });
});

describe("hookSatisfiedPushArgs", () => {
  it("puts --no-verify first, ahead of the lease and refspec", () => {
    const plan = planned({ args: parsedArgs({ argv: ["--force-with-lease"] }) });
    expect(hookSatisfiedPushArgs({ gitArgs: plan.gitArgs })).toEqual([
      "push",
      "--no-verify",
      "--set-upstream",
      `--force-with-lease=refs/heads/feature:${REMOTE_SHA}`,
      "origin",
      `${LOCAL_SHA}^{commit}:refs/heads/feature`,
    ]);
  });

  it("refuses to decorate an argv that is not a push", () => {
    expect(() => hookSatisfiedPushArgs({ gitArgs: ["fetch", "origin"] })).toThrow("not a push argv: fetch origin");
  });

  it("finds push behind git's own global options, which is the salvage push's real argv", () => {
    const gitArgs = salvagePushArgs({ sha: "c0ffee", target: "salvage/tree-2c840eb4", url: "git@h:o/r.git" });

    expect(hookSatisfiedPushArgs({ gitArgs })).toEqual([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "push",
      "--no-verify",
      "--recurse-submodules=no",
      "--no-follow-tags",
      "--force-with-lease=refs/heads/salvage/tree-2c840eb4:",
      "git@h:o/r.git",
      "c0ffee^{commit}:refs/heads/salvage/tree-2c840eb4",
    ]);
  });

  it("does not mistake a -C value for the subcommand", () => {
    expect(hookSatisfiedPushArgs({ gitArgs: ["-C", "push", "push", "origin", "main"] })).toEqual([
      "-C",
      "push",
      "push",
      "--no-verify",
      "origin",
      "main",
    ]);
  });

  it("refuses an argv that is only global options and never reaches a subcommand", () => {
    expect(() => hookSatisfiedPushArgs({ gitArgs: ["-c", "core.fsmonitor=false"] })).toThrow(
      "not a push argv: -c core.fsmonitor=false",
    );
  });

  it("refuses a non-push subcommand sitting behind global options", () => {
    expect(() => hookSatisfiedPushArgs({ gitArgs: ["-c", "core.fsmonitor=false", "fetch", "origin"] })).toThrow(
      "not a push argv: -c core.fsmonitor=false fetch origin",
    );
  });
});
