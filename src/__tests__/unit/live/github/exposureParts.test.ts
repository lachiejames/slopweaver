/**
 * The parts `github exposure inventory` composes, each on its own: the door-answer mapping, the git half over a
 * one-branch repository, and the surfaces the repository document decides. Plain fakes, no network.
 */
import { describe, expect, it } from "vitest";

import { toIngestError } from "../../../../lib/ingestError.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { readGithubExposureGit } from "../../../../live/github/exposureGit.js";
import type { GithubExposureSeam } from "../../../../live/github/exposureListing.js";
import type { GithubExposureCallId, GithubExposureReadFailure } from "../../../../live/github/exposureModel.js";
import { githubExposureAnswer } from "../../../../live/github/exposureRead.js";
import { discussionsResult, settingsResult, wikiResult } from "../../../../live/github/exposureSurfaces.js";

/** A seam answering a few calls and an empty list (or a 404 for a document) for every other. */
function seamOf({
  answers,
}: {
  answers: Partial<
    Record<GithubExposureCallId, (args: { params: Readonly<Record<string, string | number>> }) => unknown>
  >;
}): GithubExposureSeam {
  return {
    get: ({ call, params }) => {
      const answer = answers[call];
      const read: Result<unknown, GithubExposureReadFailure> = answer === undefined ? ok([]) : ok(answer({ params }));
      return Promise.resolve(read);
    },
    graphql: () => Promise.resolve(err({ message: "no graphql here", status: undefined })),
  };
}

describe("githubExposureAnswer", () => {
  it("passes a value through and keeps GitHub's status on a failure", () => {
    expect(unwrap(githubExposureAnswer({ called: ok({ id: 1 }) }))).toEqual({ id: 1 });
    const failure = toIngestError({
      error: Object.assign(new Error("Not Found"), { status: 404 }),
      operation: "github.exposure.rest",
      provider: "github",
    });
    expect(unwrapErr(githubExposureAnswer({ called: err(failure) }))).toEqual({ message: "Not Found", status: 404 });
  });
});

describe("readGithubExposureGit", () => {
  it("counts one branch, its commit and that commit's distinct blobs", async () => {
    const seam = seamOf({
      answers: {
        commits: () => [
          { commit: { author: { email: "a@users.noreply.github.com" }, tree: { sha: "tree-1" } }, sha: "c1" },
        ],
        "git-tree": () => ({
          tree: [
            { path: "a.md", sha: "blob-a", type: "blob" },
            { path: "b.md", sha: "blob-a", type: "blob" },
            { path: "docs", sha: "tree-2", type: "tree" },
            { path: "docs/c.md", sha: "blob-c", type: "blob" },
          ],
          truncated: false,
        }),
        "matching-refs": ({ params }) =>
          params["ref"] === "heads" ? [{ object: { sha: "c1", type: "commit" }, ref: "refs/heads/main" }] : [],
      },
    });
    const git = await readGithubExposureGit({
      maxPages: 3,
      owner: "acme",
      pulls: [],
      pullsComplete: true,
      repo: "widgets",
      seam,
    });
    expect(git.commitShas).toEqual(["c1"]);
    expect(git.commitGaps).toEqual([]);
    expect(
      git.results.map((result) => [
        result.surface,
        result.state.kind,
        "count" in result.state ? result.state.count : -1,
      ]),
    ).toEqual([
      ["refs", "counted", 1],
      ["pull-refs-of-deleted-branches", "counted", 0],
      ["commits", "counted", 1],
      ["commit-identities", "counted", 1],
      ["file-history", "counted", 2],
    ]);
  });

  it("calls a truncated tree a gap, so file history is a lower bound", async () => {
    const seam = seamOf({
      answers: {
        commits: () => [{ commit: { tree: { sha: "tree-1" } }, sha: "c1" }],
        "git-tree": () => ({ tree: [{ path: "a.md", sha: "blob-a", type: "blob" }], truncated: true }),
        "matching-refs": ({ params }) =>
          params["ref"] === "heads" ? [{ object: { sha: "c1", type: "commit" }, ref: "refs/heads/main" }] : [],
      },
    });
    const git = await readGithubExposureGit({
      maxPages: 3,
      owner: "acme",
      pulls: [],
      pullsComplete: true,
      repo: "widgets",
      seam,
    });
    expect(git.results.find((result) => result.surface === "file-history")!.state).toEqual({
      detail: "1 distinct file version(s) across 1 root tree(s)",
      kind: "partial",
      observedAtLeast: 1,
      why: ["a root tree answer was truncated by GitHub"],
    });
  });
});

describe("the surfaces the repository document decides", () => {
  it("prints settings as flags and presence, never a value", () => {
    const repository = {
      description: "a private plan",
      has_issues: true,
      has_wiki: false,
      topics: ["x"],
      visibility: "private",
    };
    expect(settingsResult({ repository }).state).toEqual({
      count: 1,
      detail:
        "visibility private; wiki off, pages off, discussions off, issues on; description set, homepage empty, 1 topic(s)",
      kind: "counted",
      limits: [],
    });
  });

  it("calls the wiki out of the API's reach when on, and not enabled when off", () => {
    expect(wikiResult({ repository: { has_wiki: true } }).state.kind).toBe("not-readable-by-api");
    expect(wikiResult({ repository: { has_wiki: false } }).state.kind).toBe("not-enabled");
  });

  it("reads no discussions when the repository turns them off", async () => {
    const seam = seamOf({ answers: {} });
    expect(await discussionsResult({ owner: "acme", repo: "widgets", repository: {}, seam })).toEqual({
      state: { detail: "discussions are off in the repository settings", kind: "not-enabled" },
      surface: "discussions",
    });
  });
});
