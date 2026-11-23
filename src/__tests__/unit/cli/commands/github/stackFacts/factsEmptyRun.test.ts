/*
 * `stackFactsForEntries` over an empty run: no facts and no residue, with no Git read, pull-request read or
 * ancestry question asked.
 */
import { describe, expect, it } from "vitest";

import { stackFactsForEntries } from "../../../../../../cli/commands/github/stackFacts.js";
import { ancestryFake, apiFake, gitFake, SHA_WT_LISTED, worktree } from "./harness.js";

describe("stackFactsForEntries", () => {
  it("returns no facts and no residue for an empty run, reading nothing", async () => {
    const { git, reads } = gitFake({ answers: [] });
    const { api, calls: prCalls } = apiFake({ answers: new Map() });
    const { isAncestor, calls: ancestryCalls } = ancestryFake({ answers: new Map() });

    const result = await stackFactsForEntries({
      context: {
        api,
        defaultBranch: "trunk-nova",
        git,
        isAncestor,
        owner: "owner-orbit",
        registeredNumbers: new Set([970]),
        remote: "mirror-pulse",
        repo: "repo-quartz",
        repoRoot: "/repo-radar",
        stackNumber: 97,
      },
      entries: [],
      firstPosition: 7,
      worktrees: [worktree({ branch: "idle-sonar", headSha: SHA_WT_LISTED, path: "/wt-sonar" })],
    });

    expect(result).toEqual({ facts: [], residue: [] });
    expect(prCalls).toEqual([]);
    expect(reads).toEqual([]);
    expect(ancestryCalls).toEqual([]);
  });
});
