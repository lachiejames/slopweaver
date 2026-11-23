/*
 * The staleness facts `github stack restack` measures before it plans: a pull request whose base the remote
 * lacks, or whose head this checkout lacks, is named as residue rather than planned. Both read Git only
 * through the injected `readGit`, so neither reaches a real repository.
 */
import { describe, expect, it } from "vitest";

import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import { gatherFacts } from "../../../../../cli/commands/github/restackForestFacts.js";
import type { StackVerbDeps } from "../../../../../cli/commands/github/stackVerbDeps.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

/** A dependency the measurement must never reach. */
function unused(): never {
  throw new Error("gatherFacts reached an edge it must not use");
}

/** Deps whose only live edge is a `readGit` answering the named refs and throwing for every other. */
function depsAnswering({
  answers,
  reads,
}: {
  answers: ReadonlyMap<string, string>;
  reads: { args: readonly string[]; cwd: string }[];
}): StackVerbDeps {
  const readGit: GithubPushDeps["readGit"] = ({ args, cwd }) => {
    reads.push({ args, cwd });
    const answer = answers.get(args.join(" "));
    if (answer === undefined) {
      throw new Error(`fatal: no answer for git ${args.join(" ")}`);
    }
    return answer;
  };
  return {
    git: { cwd: unused, doorLedger: memoryDoorLedger().port, out: unused, readGit, writeGit: unused },
    makeApi: unused,
    now: unused,
    out: unused,
    token: unused,
  };
}

describe("gatherFacts", () => {
  it("names a pull request whose base the remote does not have, and plans nothing for it", () => {
    const reads: { args: readonly string[]; cwd: string }[] = [];
    const gathered = gatherFacts({
      deps: depsAnswering({ answers: new Map<string, string>(), reads }),
      openPrs: [{ baseRef: "gone", headRef: "feature", headSha: "head-sha", number: 41 }],
      remote: "upstream",
      repoRoot: "/repo",
    });

    expect(gathered.residue).toEqual(["#41 (feature) is based on gone, which upstream does not have"]);
    expect(gathered.pullRequests).toEqual([]);
    expect(gathered.baseTips.size).toBe(0);
    expect(reads).toEqual([{ args: ["rev-parse", "refs/remotes/upstream/gone"], cwd: "/repo" }]);
  });

  it("names a pull request whose head this checkout does not have, even with its base measured", () => {
    const reads: { args: readonly string[]; cwd: string }[] = [];
    const gathered = gatherFacts({
      deps: depsAnswering({ answers: new Map([["rev-parse refs/remotes/origin/main", "base-sha"]]), reads }),
      openPrs: [{ baseRef: "main", headRef: "feature", headSha: "head-sha", number: 42 }],
      remote: "origin",
      repoRoot: "/repo",
    });

    expect(gathered.residue).toEqual([
      "#42 (feature) reports head head-sha, which this checkout does not have even after fetching — it may have " +
        "moved mid-run",
    ]);
    expect(gathered.pullRequests).toEqual([]);
    expect(gathered.baseTips.size).toBe(0);
    expect(reads).toEqual([
      { args: ["rev-parse", "refs/remotes/origin/main"], cwd: "/repo" },
      { args: ["cat-file", "-e", "head-sha^{commit}"], cwd: "/repo" },
    ]);
  });
});
