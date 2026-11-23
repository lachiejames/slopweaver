import { describe, expect, it } from "vitest";

import { err, unwrap, unwrapErr } from "../../../../lib/result.js";
import { DISTANCE_NOT_REQUESTED } from "../../../../live/github/baseDistance.js";
import type { GithubChecksSnapshot } from "../../../../live/github/checks.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import type { MergeQueuePrState } from "../../../../live/github/mergeQueue.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";
import type { PrLiveState } from "../../../../live/github/reviewState.js";
import {
  completedPr,
  wholeChecksOutcome,
  wholeMergeQueuePr,
  withWholeChecks,
} from "../../../../live/github/wholeChecks.js";

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

/** One live pull request whose one-page check read was truncated. */
const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "author-login",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "staging",
  changedPaths: [],
  changedPathsTruncated: false,
  checks: snapshot({ baseRef: "staging", mergeable: "MERGEABLE", rollupState: "PENDING", truncated: true }),
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

/** The merge guard's read of the same pull request, its one page truncated. */
const STATE: MergeQueuePrState = {
  approvedBy: [],
  baseRefName: "main",
  baseRefOid: "ba5e0000",
  body: "",
  checks: snapshot({ mergeable: "MERGEABLE", rollupState: "PENDING", truncated: true }),
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  entry: undefined,
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  headOid: "head-1",
  headRefName: "feature",
  isDraft: false,
  mergeable: "MERGEABLE",
  nodeId: "PR_kwabc",
  number: 7,
  reviewDecision: "APPROVED",
  stack: undefined,
  state: "OPEN",
  url: "https://example.invalid/pr/7",
};

/** A GraphQL seam that fails every request and counts them. */
function failingGraphql({ asked }: { asked: string[] }): GithubReadGraphql {
  return ({ query }) => {
    asked.push(query.slice(0, 10));
    return Promise.resolve(err(GithubLiveErrors.readFailed({ message: "GitHub is down" })));
  };
}

describe("wholeChecksOutcome", () => {
  it("completes a pull request from its own head's whole list, keeping the one-page read's base and mergeability", () => {
    expect(wholeChecksOutcome({ pr: pr(), whole: snapshot({ rollupState: "FAILURE" }) })).toEqual({
      kind: "complete",
      pr: {
        ...pr(),
        checks: snapshot({ baseRef: "staging", mergeable: "MERGEABLE", rollupState: "FAILURE" }),
        checksTruncated: false,
      },
    });
  });

  it("never stitches a list read on a different head onto the first", () => {
    expect(wholeChecksOutcome({ pr: pr(), whole: snapshot({ headSha: "head-2" }) })).toEqual({
      kind: "head-moved",
      readHead: "head-2",
    });
  });

  it("leaves a head still truncated past the paged bound as read", () => {
    expect(wholeChecksOutcome({ pr: pr(), whole: snapshot({ truncated: true }) })).toEqual({
      kind: "still-truncated",
    });
  });
});

describe("withWholeChecks", () => {
  it("folds the same head's whole list onto the merge guard's read, keeping its mergeability", () => {
    const folded = unwrap(
      withWholeChecks({ identity: "acme/widgets#7", state: STATE, whole: snapshot({ rollupState: "FAILURE" }) }),
    );

    expect(folded.checks.truncated).toBe(false);
    expect(folded.checks.rollupState).toBe("FAILURE");
    expect(folded.checks.mergeable).toBe("MERGEABLE");
  });

  it("refuses by name when the head moved between the two reads", () => {
    const refused = unwrapErr(
      withWholeChecks({ identity: "acme/widgets#7", state: STATE, whole: snapshot({ headSha: "head-2" }) }),
    );

    expect(refused.code).toBe("READ_FAILED");
    expect(refused.message).toBe(
      "acme/widgets#7's head moved from head-1 to head-2 while its checks were read past the first page",
    );
  });
});

describe("completedPr", () => {
  it("returns a pull request read whole as it was, asking nothing", async () => {
    const asked: string[] = [];
    const whole = pr({ checksTruncated: false });

    expect(await completedPr({ graphql: failingGraphql({ asked }), owner: "acme", pr: whole, repo: "widgets" })).toBe(
      whole,
    );
    expect(asked).toEqual([]);
  });

  it("keeps a truncated pull request as read when the re-read fails, so it stays unknown rather than green", async () => {
    const asked: string[] = [];
    const truncated = pr();

    expect(
      await completedPr({ graphql: failingGraphql({ asked }), owner: "acme", pr: truncated, repo: "widgets" }),
    ).toBe(truncated);
    expect(asked.length).toBeGreaterThan(0);
  });
});

describe("wholeMergeQueuePr", () => {
  it("returns an untruncated read as it was, asking nothing", async () => {
    const asked: string[] = [];
    const whole = { ...STATE, checks: snapshot() };

    expect(
      unwrap(
        await wholeMergeQueuePr({
          graphql: failingGraphql({ asked }),
          identity: "acme/widgets#7",
          number: 7,
          owner: "acme",
          repo: "widgets",
          state: whole,
        }),
      ),
    ).toBe(whole);
    expect(asked).toEqual([]);
  });

  it("fails the guard's read when a truncated head cannot be re-read whole", async () => {
    const refused = unwrapErr(
      await wholeMergeQueuePr({
        graphql: failingGraphql({ asked: [] }),
        identity: "acme/widgets#7",
        number: 7,
        owner: "acme",
        repo: "widgets",
        state: STATE,
      }),
    );

    expect(refused.code).toBe("READ_FAILED");
  });
});
