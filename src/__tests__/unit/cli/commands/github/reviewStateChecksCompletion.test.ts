import { describe, expect, it } from "vitest";

import { completeTruncatedChecks } from "../../../../../cli/commands/github/reviewStateChecksCompletion.js";
import { err, ok } from "../../../../../lib/result.js";
import { DISTANCE_NOT_REQUESTED } from "../../../../../live/github/baseDistance.js";
import type { FetchGithubChecks, GithubChecksSnapshot } from "../../../../../live/github/checks.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { PrLiveState } from "../../../../../live/github/reviewState.js";

/** A head's checks snapshot, one page or whole. */
const snapshot = (over: Partial<GithubChecksSnapshot> = {}): GithubChecksSnapshot => ({
  baseRef: undefined,
  checks: [],
  headSha: "head-1",
  mergeable: undefined,
  residue: [],
  rollupState: "SUCCESS",
  supersededChecks: [],
  truncated: false,
  ...over,
});

/** One live pull request, truncated unless told otherwise. */
const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "author-login",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "staging",
  changedPaths: [],
  changedPathsTruncated: false,
  checks: snapshot({ baseRef: "staging", mergeable: "MERGEABLE", residue: ["one page of 100"], truncated: true }),
  checksRead: { kind: "read" },
  checksTruncated: true,
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  createdAtIso: "2026-10-01T00:00:00Z",
  defaultBranch: "staging",
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  headOid: "head-1",
  headRefName: "feature/one",
  headRepoSlug: "acme/widgets",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  number: 7,
  queueEntry: undefined,
  repoSlug: "acme/widgets",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  reviewsTruncated: false,
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "a title",
  updatedAtIso: "2026-10-01T01:00:00Z",
  url: "https://github.com/acme/widgets/pull/7",
  ...over,
});

/** A fetcher answering one fixed result, recording every address it was asked for. */
function fetcher({ answer }: { answer: Awaited<ReturnType<FetchGithubChecks>> }): {
  fetchChecks: FetchGithubChecks;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    fetchChecks: ({ owner, repo, number, limit }) => {
      asked.push(`${owner}/${repo}#${String(number)} ${String(limit)}`);
      return Promise.resolve(answer);
    },
  };
}

describe("completeTruncatedChecks", () => {
  it("replaces a truncated head's checks with the whole list, keeping the fleet read's base and mergeability", async () => {
    const seam = fetcher({ answer: ok(snapshot({ rollupState: "FAILURE" })) });
    const problems: string[] = [];
    const [completed] = await completeTruncatedChecks({
      concurrency: 2,
      deps: { fetchChecks: seam.fetchChecks, onProblem: (line) => problems.push(line) },
      prs: [pr()],
      totalLimit: 500,
    });
    expect(seam.asked).toStrictEqual(["acme/widgets#7 500"]);
    expect(completed!.checksTruncated).toBe(false);
    expect(completed!.checks).toStrictEqual(
      snapshot({ baseRef: "staging", mergeable: "MERGEABLE", rollupState: "FAILURE" }),
    );
    expect(problems).toStrictEqual([]);
  });

  it("never asks about a head the fleet page already held whole, and returns the same list untouched", async () => {
    const seam = fetcher({ answer: ok(snapshot()) });
    const whole = [pr({ checks: snapshot(), checksTruncated: false })];
    const answered = await completeTruncatedChecks({
      concurrency: 2,
      deps: { fetchChecks: seam.fetchChecks, onProblem: () => undefined },
      prs: whole,
      totalLimit: 500,
    });
    expect(answered).toBe(whole);
    expect(seam.asked).toStrictEqual([]);
  });

  it("keeps fleet order when only the middle pull request is truncated", async () => {
    const seam = fetcher({ answer: ok(snapshot({ headSha: "head-2" })) });
    const answered = await completeTruncatedChecks({
      concurrency: 1,
      deps: { fetchChecks: seam.fetchChecks, onProblem: () => undefined },
      prs: [
        pr({ checksTruncated: false, number: 1 }),
        pr({ headOid: "head-2", number: 2 }),
        pr({ checksTruncated: false, number: 3 }),
      ],
      totalLimit: 500,
    });
    expect(answered.map((one) => `${String(one.number)} ${String(one.checksTruncated)}`)).toStrictEqual([
      "1 false",
      "2 false",
      "3 false",
    ]);
    expect(seam.asked).toStrictEqual(["acme/widgets#2 500"]);
  });

  it("leaves the row truncated and names the failure when the re-read errs", async () => {
    const seam = fetcher({ answer: err(GithubLiveErrors.readFailed({ message: "GitHub answered 502" })) });
    const problems: string[] = [];
    const original = pr();
    const [answered] = await completeTruncatedChecks({
      concurrency: 2,
      deps: { fetchChecks: seam.fetchChecks, onProblem: (line) => problems.push(line) },
      prs: [original],
      totalLimit: 500,
    });
    expect(answered).toBe(original);
    expect(problems).toStrictEqual([
      "could not complete acme/widgets#7's checks past the first page: GitHub answered 502",
    ]);
  });

  it("leaves the row truncated when the head is still past the limit, rather than reading the partial list green", async () => {
    const seam = fetcher({ answer: ok(snapshot({ residue: ["past 500"], truncated: true })) });
    const problems: string[] = [];
    const original = pr();
    const [answered] = await completeTruncatedChecks({
      concurrency: 2,
      deps: { fetchChecks: seam.fetchChecks, onProblem: (line) => problems.push(line) },
      prs: [original],
      totalLimit: 500,
    });
    expect(answered).toBe(original);
    expect(problems).toStrictEqual([
      "acme/widgets#7 still carries more than 500 check contexts, so its CI stays unknown",
    ]);
  });

  it("refuses a slug that is not owner/name without asking GitHub", async () => {
    const seam = fetcher({ answer: ok(snapshot()) });
    const problems: string[] = [];
    await completeTruncatedChecks({
      concurrency: 2,
      deps: { fetchChecks: seam.fetchChecks, onProblem: (line) => problems.push(line) },
      prs: [pr({ repoSlug: "" })],
      totalLimit: 500,
    });
    expect(seam.asked).toStrictEqual([]);
    expect(problems).toStrictEqual(["could not complete #7's checks: its repository slug is not owner/name"]);
  });
});
