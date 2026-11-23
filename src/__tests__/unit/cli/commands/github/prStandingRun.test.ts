/**
 * `github pr standing`'s shell over plain recording edges: which address it refuses before reading, which exit a
 * failed read gets, that a base branch GitHub answers 404 for classic protection, an empty ruleset list and
 * `protected: false` for reads as requiring no review, and that an unreadable base is said rather than failing
 * the whole answer.
 */
import { describe, expect, it } from "vitest";

import { type GithubPrStandingDeps, runGithubPrStanding } from "../../../../../cli/commands/github/prStandingRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { GithubReadGraphql, GithubReadRest } from "../../../../../live/github/read.js";

const PR = "https://github.com/acme/acme-admin/pull/18158";
const READ_AT = "2026-09-30T12:00:00.000Z";

/** The by-number node for a pull request with no reviews, no requests and no checks, against a side branch. */
const NODE = {
  author: { __typename: "User", login: "octocat" },
  baseRefName: "policy-mirror-dogfood",
  headRefName: "infr-1071",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  number: 18158,
  repository: { defaultBranchRef: { name: "staging" }, nameWithOwner: "acme/acme-admin" },
  reviewDecision: null,
  reviewRequests: { nodes: [], pageInfo: { hasNextPage: false } },
  reviewThreads: { nodes: [], pageInfo: { hasNextPage: false }, totalCount: 0 },
  reviews: { nodes: [], totalCount: 0 },
  title: "backup-restore and change-log evidence",
  url: PR,
};

/** GitHub's classic-protection 404, an empty ruleset list and `protected: false`: a branch nothing protects. */
const UNPROTECTED_REST: GithubReadRest = async ({ route }) => {
  if (route.endsWith("/protection")) {
    return err(GithubLiveErrors.readFailed({ message: "404 Branch not protected" }));
  }
  if (route.startsWith("GET /repos/{owner}/{repo}/branches/")) {
    return ok({ data: { name: "policy-mirror-dogfood", protected: false } });
  }
  return ok({ data: [] });
};

/** Plain recording edges; `graphql` and `rest` decide what the reads return. */
function edges({ graphql, rest }: { graphql: GithubReadGraphql; rest: GithubReadRest }): {
  deps: GithubPrStandingDeps;
  out: string[];
  diag: string[];
  routes: string[];
} {
  const out: string[] = [];
  const diag: string[] = [];
  const routes: string[] = [];
  return {
    deps: {
      graphql: () => graphql,
      nowIso: () => READ_AT,
      out: ({ line }) => out.push(line),
      rest: () => async (args) => {
        routes.push(`${args.route} ${String(args.params["branch"])}`);
        return rest(args);
      },
      writeDiagnostic: ({ line }) => diag.push(line),
    },
    diag,
    out,
    routes,
  };
}

const ANSWERS: GithubReadGraphql = async () => ok({ repository: { pullRequest: NODE } });

describe("runGithubPrStanding", () => {
  it("refuses an issue address as usage, before any read", async () => {
    const run = edges({ graphql: ANSWERS, rest: UNPROTECTED_REST });
    const issue = "https://github.com/acme/acme-admin/issues/7";
    expect(await runGithubPrStanding({ deps: run.deps, rest: [issue] })).toBe(EXIT_USAGE);
    expect(run.routes).toEqual([]);
    expect(run.diag).toEqual([`${issue} is not a pull-request address`]);
  });

  it("exits 1 with the read's own message when the pull-request read fails, reading no base", async () => {
    const run = edges({
      graphql: async () => err(GithubLiveErrors.readFailed({ message: "graphql 502" })),
      rest: UNPROTECTED_REST,
    });
    expect(await runGithubPrStanding({ deps: run.deps, rest: [PR] })).toBe(EXIT_ERROR);
    expect(run.diag).toEqual(["graphql 502"]);
    expect(run.routes).toEqual([]);
  });

  it("answers a pull request with no reviews against an unprotected base: none approved, none needed", async () => {
    const run = edges({ graphql: ANSWERS, rest: UNPROTECTED_REST });
    expect(await runGithubPrStanding({ deps: run.deps, rest: [PR, "--json"] })).toBe(EXIT_OK);
    expect(run.routes).toEqual([
      "GET /repos/{owner}/{repo}/branches/{branch}/protection policy-mirror-dogfood",
      "GET /repos/{owner}/{repo}/rules/branches/{branch} policy-mirror-dogfood",
      "GET /repos/{owner}/{repo}/branches/{branch} policy-mirror-dogfood",
    ]);
    const standing = JSON.parse(run.out.join("\n")) as {
      base: unknown;
      reviews: { approvedBy: unknown; requested: unknown; reviewDecision: unknown };
      sentence: string;
      readAtIso: string;
    };
    expect(standing.base).toEqual({
      defaultBranch: "staging",
      name: "policy-mirror-dogfood",
      protected: false,
      review: { kind: "none" },
    });
    expect(standing.reviews.approvedBy).toEqual([]);
    expect(standing.reviews.requested).toEqual([]);
    expect(standing.reviews.reviewDecision).toBe("");
    expect(standing.readAtIso).toBe(READ_AT);
    expect(standing.sentence).toContain(
      "It targets policy-mirror-dogfood, which is unprotected and requires no review — so no approval is " +
        "needed to merge it. " +
        "No person has approved it.",
    );
  });

  it("still answers, exit 0, when the base branch's rules cannot be read — and says so", async () => {
    const run = edges({
      graphql: ANSWERS,
      rest: async () => err(GithubLiveErrors.readFailed({ message: "403 Resource not accessible" })),
    });
    expect(await runGithubPrStanding({ deps: run.deps, rest: [PR] })).toBe(EXIT_OK);
    expect(run.out[2]).toContain(
      "whether that branch requires a review could not be read (403 Resource not accessible)",
    );
  });
});
