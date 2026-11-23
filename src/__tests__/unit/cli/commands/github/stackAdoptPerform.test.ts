/*
 * The in-door half of `github stack adopt`, driven directly: the freshness re-read refuses before any Git edge
 * is reached, whether GitHub cannot answer or the pull request moved since it was planned. The rebase, push
 * and registration paths stay covered through the verb's public entrypoint.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import type { GithubStackAdoptPlan } from "../../../../../cli/commands/github/stackAdoptCore.js";
import { reconfirmAndPerform } from "../../../../../cli/commands/github/stackAdoptPerform.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { fakeApi } from "../../../../githubPrHarness.js";

const HEAD_SHA = "3".repeat(40);

/** The child pull request as it was read while planning. */
function previewedPr(): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "acme/widgets",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "acme:top", ref: "top", repoFullName: "acme/widgets", sha: HEAD_SHA },
    htmlUrl: "https://example.invalid/pr/100",
    mergedAtIso: undefined,
    nodeId: "PR_100",
    number: 100,
    stack: undefined,
    state: "open",
    title: "t",
    updatedAtIso: "2026-11-06T00:00:00Z",
  };
}

const PLAN: GithubStackAdoptPlan = {
  baseBranch: "main",
  branch: "top",
  defaultBranch: "main",
  headSha: HEAD_SHA,
  overrideNotices: [],
  owner: "acme",
  prNumber: 100,
  repo: "widgets",
  repoRoot: "/repo",
};

/** Git edges that throw on any call, so a refusal that reached the rebase or the push fails the test. */
function unreachableGit(): GithubPushDeps {
  return {
    cwd: () => "/repo",
    doorLedger: unreachableDoorLedger(),
    out: () => undefined,
    readGit: ({ args }) => {
      throw new Error(`no Git read belongs before freshness passes: ${args.join(" ")}`);
    },
    writeGit: ({ args }) => {
      throw new Error(`no Git write belongs before freshness passes: ${args.join(" ")}`);
    },
  };
}

describe("reconfirmAndPerform", () => {
  it("answers failed with the re-read error when GitHub cannot return the pull request", async () => {
    const api = fakeApi({
      getPr: () => errAsync({ kind: "http" as const, message: "502 bad gateway", operation: "getPr" }),
    });
    const outcome = await reconfirmAndPerform({
      api,
      git: unreachableGit(),
      home: "/unused-home",
      now: () => new Date("2026-11-06T00:00:00Z"),
      plan: PLAN,
      previewedPr: previewedPr(),
      remote: "origin",
    });
    expect(outcome).toEqual({
      kind: "failed",
      reason: "could not re-read PR #100 before writing: 502 bad gateway",
    });
  });

  it("answers failed naming the head commit when the pull request moved since planning", async () => {
    const moved: WrittenPr = { ...previewedPr(), head: { ...previewedPr().head, sha: "4".repeat(40) } };
    const api = fakeApi({ getPr: () => okAsync(moved) });
    const outcome = await reconfirmAndPerform({
      api,
      git: unreachableGit(),
      home: "/unused-home",
      now: () => new Date("2026-11-06T00:00:00Z"),
      plan: PLAN,
      previewedPr: previewedPr(),
      remote: "origin",
    });
    expect(outcome).toEqual({
      kind: "failed",
      reason:
        "the head commit changed between reading this pull request and adopting it, so nothing was sent. " +
        "Re-run to work from the current state",
    });
  });
});
