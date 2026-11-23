/**
 * The fake review-state seam the `runGithubLanding` harness hands the landing verb: a fleet read that answers from
 * a list of pages, with every other leg answering the same canned way.
 */
import type { GithubReviewStateDeps } from "../../../../../../cli/commands/github/reviewStateRun.js";
import { err, ok } from "../../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import type { PrLivePage } from "../../../../../../live/github/reviewState.js";
import { EMPTY_REVIEW_ROSTER } from "../../../../../../review/reviewRoster.js";

/**
 * Builds the review-state seam over the given fleet pages; a page past the end is a FAILED read.
 *
 * @returns the review-state dependencies the landing verb reads GitHub through
 */
export function fakeReviewState({
  pages,
  monotonicMs,
  writeDiagnostic,
  writeOut,
}: {
  pages: readonly PrLivePage[];
  monotonicMs: GithubReviewStateDeps["monotonicMs"];
  writeDiagnostic: GithubReviewStateDeps["writeDiagnostic"];
  writeOut: GithubReviewStateDeps["writeOut"];
}): GithubReviewStateDeps {
  let page = 0;
  return {
    api: () => ({
      codeowners: () => Promise.resolve(ok({ content: "* @acme/eng\n", path: "CODEOWNERS" })),
      fleetPage: () => {
        const current = pages[page];
        page += 1;
        // A page past the end is a FAILED read rather than a throw: `pages: []` is how a test says GitHub
        // would not answer at all, and a fake that threw could not express it.
        return Promise.resolve(
          current === undefined ? err(GithubLiveErrors.readFailed({ message: "GitHub answered 502" })) : ok(current),
        );
      },
      pr: () => Promise.resolve(ok(pages[0]!.pullRequests[0]!)),
    }),
    baseDistances:
      () =>
      ({ subjects }) =>
        Promise.resolve(
          subjects.map(() => ({ kind: "read", value: { aheadBy: 1, behindBy: 3, status: "DIVERGED" } }) as const),
        ),
    checksCompletion: () => () =>
      Promise.resolve(err(GithubLiveErrors.readFailed({ message: "this fixture carries no whole check list" }))),
    mergeableRecheck:
      () =>
      ({ subjects }) =>
        Promise.resolve(
          subjects.map(
            (subject) => ({ kind: "read", value: { headOid: subject.headOid, mergeable: "MERGEABLE" } }) as const,
          ),
        ),
    conflictPaths: () => ({ kind: "paths", paths: ["package.json"] }),
    corpusMentions: () => ok([]),
    slackIdentity: () => ({ ownerSlackUserId: "U1", selfUserIds: [] }),
    corpusThrough: () => "2026-09-09T00:00:00Z",
    monotonicMs,
    pageDeadline: () => new Promise(() => undefined),
    now: () => new Date("2026-09-09T12:30:00.000Z"),
    requiredContexts: () => Promise.resolve(ok(["build"])),
    resolveRepo: () => ok({ owner: "acme", repo: "widgets" }),
    resolveRepository: () => Promise.reject(new Error("landing passes no resolution verb, so never asks this seam")),
    roster: () => Promise.resolve(ok(EMPTY_REVIEW_ROSTER)),
    slackConversations: () => undefined,
    askReadings: () => ok(new Map()),
    slackSearch: () => undefined,
    writeDiagnostic,
    writeOut,
  };
}
