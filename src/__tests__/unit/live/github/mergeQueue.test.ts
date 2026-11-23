import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseProtectionContexts } from "../../../../live/github/branchProtection.js";
import { parseRequiredCheckContexts } from "../../../../live/github/branchRules.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../live/github/errors.js";
import { makeGithubMergeQueueReads, parseMergeQueue, parseMergeQueuePr } from "../../../../live/github/mergeQueue.js";
import { REVIEW_REQUESTS_SELECTION } from "../../../../live/github/reviewRequests.js";
import { IDENTITY, prData } from "./mergeQueueFixture.js";

/** Drops one selection from a shaped payload, standing in for a query that never asked for it. */
function withoutMergeStateStatus({ data }: { data: unknown }): unknown {
  const shaped = data as { repository: { pullRequest: Record<string, unknown> } };
  const pullRequest = { ...shaped.repository.pullRequest };
  delete pullRequest["mergeStateStatus"];
  return { repository: { pullRequest } };
}

describe("parseMergeQueuePr", () => {
  it("shapes an unqueued, approved, green pull request", () => {
    const pr = unwrap(
      parseMergeQueuePr({
        data: prData({
          contexts: [
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-02T00:00:00Z" },
              conclusion: "SUCCESS",
              name: "build",
              status: "COMPLETED",
            },
          ],
          reviews: [{ author: { login: "reviewer-one" }, state: "APPROVED" }],
        }),
        identity: IDENTITY,
      }),
    );
    expect(pr.number).toBe(9);
    expect(pr.nodeId).toBe("PR_kwabc");
    expect(pr.baseRefName).toBe("main");
    // The base COMMIT, which a ratchet bump is judged against at the landing.
    expect(pr.baseRefOid).toBe("ba5e0000");
    // The head BRANCH, not just the head commit: the landing guards associate a local checkout by both.
    expect(pr.headRefName).toBe("feature");
    expect(pr.headOid).toBe("cafe1234");
    expect(pr.state).toBe("OPEN");
    expect(pr.isDraft).toBe(false);
    expect(pr.reviewDecision).toBe("APPROVED");
    expect(pr.mergeable).toBe("MERGEABLE");
    expect(pr.approvedBy).toEqual(["reviewer-one"]);
    expect(pr.checks.rollupState).toBe("SUCCESS");
    expect(pr.entry).toBe(undefined);
  });

  it("shapes a queue entry, carrying position, state and the estimate", () => {
    const pr = unwrap(
      parseMergeQueuePr({
        data: prData({ entry: { estimatedTimeToMerge: 420, position: 3, state: "AWAITING_CHECKS" } }),
        identity: IDENTITY,
      }),
    );
    expect(pr.entry).toEqual({ estimatedSecondsToMerge: 420, position: 3, state: "AWAITING_CHECKS" });
  });

  it("reports a missing estimate as undefined rather than zero", () => {
    const pr = unwrap(
      parseMergeQueuePr({ data: prData({ entry: { position: 1, state: "QUEUED" } }), identity: IDENTITY }),
    );
    expect(pr.entry).toEqual({ estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" });
  });

  it("keeps only approvals out of the opinionated reviews", () => {
    const pr = unwrap(
      parseMergeQueuePr({
        data: prData({
          reviews: [
            { author: { login: "one" }, state: "CHANGES_REQUESTED" },
            { author: { login: "two" }, state: "APPROVED" },
          ],
        }),
        identity: IDENTITY,
      }),
    );
    expect(pr.approvedBy).toEqual(["two"]);
  });

  it("reports a null review decision as undefined rather than an empty string", () => {
    const pr = unwrap(parseMergeQueuePr({ data: prData({ reviewDecision: null }), identity: IDENTITY }));
    expect(pr.reviewDecision).toBe(undefined);
  });

  it("classifies GitHub's own merge status, because the door re-asks rather than trusting the fleet read", () => {
    const clean = unwrap(parseMergeQueuePr({ data: prData({ mergeStateStatus: "CLEAN" }), identity: IDENTITY }));
    expect(clean.githubMergeStatus).toEqual({ kind: "mergeable", status: "CLEAN" });
    const blocked = unwrap(parseMergeQueuePr({ data: prData({ mergeStateStatus: "BLOCKED" }), identity: IDENTITY }));
    expect(blocked.githubMergeStatus).toEqual({ kind: "blocked", status: "BLOCKED" });
    const behind = unwrap(parseMergeQueuePr({ data: prData({ mergeStateStatus: "BEHIND" }), identity: IDENTITY }));
    expect(behind.githubMergeStatus).toEqual({ kind: "unproven", status: "BEHIND" });
  });

  it("reads a null merge status as unread, never as a token that would clear a pending request", () => {
    const pr = unwrap(parseMergeQueuePr({ data: prData({ mergeStateStatus: null }), identity: IDENTITY }));
    expect(pr.githubMergeStatus).toEqual({ kind: "unread", why: "GitHub returned a null mergeStateStatus for it" });
  });

  it("reads an ABSENT merge status as unread, so dropping the query field cannot press a row", () => {
    // The dangerous direction here is silence reading as green: a selection removed from PR_QUERY leaves the
    // field undefined, and the door would then be deciding a code-owner exception on nothing at all.
    const pr = unwrap(parseMergeQueuePr({ data: withoutMergeStateStatus({ data: prData({}) }), identity: IDENTITY }));
    expect(pr.githubMergeStatus).toEqual({ kind: "unread", why: "this read carried no mergeStateStatus for it" });
  });

  it("refuses a payload with no pull request at that address", () => {
    const failure = unwrapErr(parseMergeQueuePr({ data: { repository: {} }, identity: IDENTITY }));
    expect(failure.code).toBe("NOT_FOUND");
  });

  it("refuses a pull request GitHub returned with no head commit", () => {
    const failure = unwrapErr(
      parseMergeQueuePr({
        data: {
          repository: {
            pullRequest: {
              baseRefName: "main",
              baseRefOid: "ba5e0000",
              body: "",
              headRefName: "feature",
              commits: { nodes: [] },
              id: "PR_x",
              mergeable: "MERGEABLE",
              number: 9,
              state: "OPEN",
              url: "https://example.invalid/pr/9",
            },
          },
        },
        identity: IDENTITY,
      }),
    );
    expect(failure.code).toBe("READ_FAILED");
    expect(failure.message).toContain("no head commit");
  });

  it("refuses a pull request GitHub returned without one of its always-present fields", () => {
    const failure = unwrapErr(
      parseMergeQueuePr({ data: { repository: { pullRequest: { number: 9 } } }, identity: IDENTITY }),
    );
    expect(failure.code).toBe("READ_FAILED");
    expect(failure.message).toContain(
      "without one of id, number, body, url, state, mergeable, baseRefName, baseRefOid or headRefName",
    );
  });

  it("carries the pull request body, which the pairing floor reads for named review leftovers", () => {
    const pr = unwrap(parseMergeQueuePr({ data: prData({}), identity: IDENTITY }));
    expect(pr.body).toBe("Fixes the widget.");
  });

  it("refuses a pull request GitHub returned without its body, rather than reading no leftovers as named", () => {
    const shaped = prData({}) as { repository: { pullRequest: Record<string, unknown> } };
    const pullRequest = { ...shaped.repository.pullRequest };
    delete pullRequest["body"];
    const failure = unwrapErr(parseMergeQueuePr({ data: { repository: { pullRequest } }, identity: IDENTITY }));
    expect(failure.code).toBe("READ_FAILED");
    expect(failure.message).toContain("body");
  });

  it("refuses a pull request GitHub returned without its base commit, rather than judging a bump against none", () => {
    const shaped = prData({}) as { repository: { pullRequest: Record<string, unknown> } };
    const pullRequest = { ...shaped.repository.pullRequest };
    delete pullRequest["baseRefOid"];
    const failure = unwrapErr(parseMergeQueuePr({ data: { repository: { pullRequest } }, identity: IDENTITY }));
    expect(failure.code).toBe("READ_FAILED");
    expect(failure.message).toContain("baseRefOid");
  });

  it("refuses a merge queue GitHub returned with no url, rather than reporting a blank one", () => {
    const failure = unwrapErr(
      parseMergeQueue({ branch: "main", data: { repository: { mergeQueue: {} } }, identity: "acme/widget" }),
    );
    expect(failure.code).toBe("READ_FAILED");
    expect(failure.message).toContain("with no url");
  });
});

describe("parseMergeQueue", () => {
  it("shapes a branch that has a queue", () => {
    const queue = unwrap(
      parseMergeQueue({
        branch: "main",
        data: { repository: { mergeQueue: { url: "https://example.invalid/queue" } } },
        identity: "acme/widget",
      }),
    );
    expect(queue).toEqual({ branch: "main", url: "https://example.invalid/queue" });
  });

  it("reports a branch with no queue as undefined rather than a failure", () => {
    const queue = unwrap(
      parseMergeQueue({ branch: "main", data: { repository: { mergeQueue: null } }, identity: "acme/widget" }),
    );
    expect(queue).toBe(undefined);
  });

  it("refuses a payload with no repository at that address", () => {
    const failure = unwrapErr(parseMergeQueue({ branch: "main", data: {}, identity: "acme/widget" }));
    expect(failure.code).toBe("NOT_FOUND");
  });
});

/** A REST seam the GraphQL-only reads below never touch; calling it is itself the failure. */
const unusedRest = async (): Promise<Result<unknown, GithubLiveError>> =>
  err(GithubLiveErrors.readFailed({ message: "the REST seam was called by a GraphQL-only read" }));

describe("makeGithubMergeQueueReads", () => {
  it("asks for the pull request and shapes what comes back", async () => {
    const asked: string[] = [];
    const reads = makeGithubMergeQueueReads({
      rest: unusedRest,
      graphql: async ({ query, variables }) => {
        asked.push(`${query.includes("SlopweaverMergeQueuePr") ? "pr" : "queue"}:${JSON.stringify(variables)}`);
        return ok(prData({}));
      },
    });
    const pr = unwrap(await reads.pr({ number: 9, owner: "acme", repo: "widget" }));
    expect(pr.number).toBe(9);
    expect(asked).toEqual(['pr:{"limit":100,"number":9,"owner":"acme","repo":"widget","requestLimit":20}']);
  });

  it("selects both native-stack fields, so an omitted selection cannot read as 'no stack'", async () => {
    // The parser below treats a half-populated pair as a FAILURE, but it can only see what the QUERY asked
    // for: dropping the selection would make every pull request look ordinary, and route a stack member
    // back down the GraphQL mutation GitHub refuses. So the query itself is asserted.
    const queries: string[] = [];
    const reads = makeGithubMergeQueueReads({
      rest: unusedRest,
      graphql: async ({ query }) => {
        queries.push(query);
        return ok(prData({}));
      },
    });
    await reads.pr({ number: 9, owner: "acme", repo: "widget" });
    expect(queries.length).toBe(1);
    expect(queries[0]).toContain("stack { number baseRefName size }");
    expect(queries[0]).toContain("stackEntry { position }");
  });

  it("selects mergeStateStatus, the one field the code-owner exception is decided on", async () => {
    // The parser answers `unread` when the field is absent, which refuses rather than presses — so the query
    // dropping it would be silent in behaviour and visible only as rows that stopped being enqueued.
    const queries: string[] = [];
    const reads = makeGithubMergeQueueReads({
      rest: unusedRest,
      graphql: async ({ query }) => {
        queries.push(query);
        return ok(prData({}));
      },
    });
    await reads.pr({ number: 9, owner: "acme", repo: "widget" });
    expect(queries.length).toBe(1);
    expect(queries[0]).toContain("mergeable mergeStateStatus");
    // `hasNextPage` answers FALSE on an absent `pageInfo`, so a selection that stopped asking for it would
    // report a capped request page as a complete read — the exact input the code-owner exception releases
    // on.
    expect(queries[0]).toContain(REVIEW_REQUESTS_SELECTION);
    expect(queries[0]).toContain("reviewDecision");
  });

  it("reads a head past one page of contexts WHOLE, so a failure on page two reaches the guard", async () => {
    const passed = { __typename: "CheckRun", conclusion: "SUCCESS", name: "build", status: "COMPLETED" };
    const failed = { __typename: "CheckRun", conclusion: "FAILURE", name: "Required CI", status: "COMPLETED" };
    const asked: string[] = [];
    const reads = makeGithubMergeQueueReads({
      rest: unusedRest,
      graphql: async ({ query }) => {
        const name = /query (\w+)/.exec(query)![1]!;
        asked.push(name);
        if (name === "SlopweaverChecksRollupPage") {
          return ok(prData({ contexts: [failed], pageInfo: { hasNextPage: false } }));
        }
        return ok(prData({ contexts: [passed], pageInfo: { endCursor: "c1", hasNextPage: true } }));
      },
    });
    const pr = unwrap(await reads.pr({ number: 9, owner: "acme", repo: "widget" }));
    expect(asked).toStrictEqual(["SlopweaverMergeQueuePr", "SlopweaverChecksRollup", "SlopweaverChecksRollupPage"]);
    expect(pr.checks.truncated).toBe(false);
    expect(pr.checks.checks.map((check) => `${check.name} ${check.state}`)).toStrictEqual([
      "build passed",
      "Required CI failed",
    ]);
    expect(pr.checks.mergeable).toBe("MERGEABLE");
  });

  it("refuses the read, rather than stitching two commits, when the head moved before the whole re-read", async () => {
    const reads = makeGithubMergeQueueReads({
      rest: unusedRest,
      graphql: async ({ query }) =>
        ok(
          query.includes("SlopweaverMergeQueuePr")
            ? prData({ pageInfo: { endCursor: "c1", hasNextPage: true } })
            : prData({ oid: "beef5678" }),
        ),
    });
    const failure = unwrapErr(await reads.pr({ number: 9, owner: "acme", repo: "widget" }));
    expect(failure.message).toBe(
      "acme/widget#9's head moved from cafe1234 to beef5678 while its checks were read past the first page",
    );
  });

  it("carries a transport failure through the pull-request read untouched", async () => {
    const reads = makeGithubMergeQueueReads({
      rest: unusedRest,
      graphql: async () => err(GithubLiveErrors.readFailed({ message: "transport died" })),
    });
    const failure = unwrapErr(await reads.pr({ number: 9, owner: "acme", repo: "widget" }));
    expect(failure.message).toBe("transport died");
  });

  it("asks the queue read for the branch it was given", async () => {
    const asked: Record<string, unknown>[] = [];
    const reads = makeGithubMergeQueueReads({
      rest: unusedRest,
      graphql: async ({ variables }) => {
        asked.push({ ...variables });
        return ok({ repository: { mergeQueue: { url: "https://example.invalid/q" } } });
      },
    });
    const queue = unwrap(await reads.queue({ branch: "staging", owner: "acme", repo: "widget" }));
    expect(queue).toEqual({ branch: "staging", url: "https://example.invalid/q" });
    expect(asked).toEqual([{ branch: "staging", owner: "acme", repo: "widget" }]);
  });
});

describe("parseRequiredCheckContexts", () => {
  const rules = ({ value }: { value: unknown }): unknown => ({ data: value });

  it("collects every required context, deduped and sorted, across rules", () => {
    const shaped = unwrap(
      parseRequiredCheckContexts({
        branch: "main",
        data: rules({
          value: [
            {
              parameters: { required_status_checks: [{ context: "integration" }, { context: "build" }] },
              type: "required_status_checks",
            },
            { parameters: {}, type: "pull_request" },
            { parameters: { required_status_checks: [{ context: "build" }] }, type: "required_status_checks" },
          ],
        }),
        identity: "acme/widget",
      }),
    );
    expect(shaped).toEqual({ branch: "main", contexts: ["build", "integration"], requiresCodeOwnerReviews: undefined });
  });

  it("answers an empty set for a branch whose rules require no status check — the ungated case", () => {
    const shaped = unwrap(
      parseRequiredCheckContexts({
        branch: "main",
        data: rules({ value: [{ parameters: { required_status_checks: [] }, type: "merge_queue" }] }),
        identity: "acme/widget",
      }),
    );
    expect(shaped).toEqual({ branch: "main", contexts: [], requiresCodeOwnerReviews: undefined });
  });

  it("answers an empty set for a branch with no rules at all", () => {
    const shaped = unwrap(
      parseRequiredCheckContexts({ branch: "main", data: rules({ value: [] }), identity: "acme/widget" }),
    );
    expect(shaped.contexts).toEqual([]);
  });

  it("skips a required_status_checks rule whose entries carry no context string", () => {
    const shaped = unwrap(
      parseRequiredCheckContexts({
        branch: "main",
        data: rules({
          value: [
            { parameters: { required_status_checks: [{ integration_id: 15368 }] }, type: "required_status_checks" },
          ],
        }),
        identity: "acme/widget",
      }),
    );
    expect(shaped.contexts).toEqual([]);
  });

  it("refuses a payload that is not a rules array rather than reading it as ungated", () => {
    const failure = unwrapErr(
      parseRequiredCheckContexts({ branch: "main", data: { data: { message: "Not Found" } }, identity: "acme/widget" }),
    );
    expect(failure.code).toBe("READ_FAILED");
    expect(failure.message).toContain("no rules array");
  });

  it("refuses a FULL page of rules, which may be hiding a required check on the next one", () => {
    const failure = unwrapErr(
      parseRequiredCheckContexts({
        branch: "main",
        data: rules({ value: Array.from({ length: 100 }, () => ({ parameters: {}, type: "pull_request" })) }),
        identity: "acme/widget",
      }),
    );
    expect(failure.message).toBe(
      "GitHub returned a full page of 100 rules for acme/widget on main, so a required check may be on a page this read did not fetch",
    );
  });
});

describe("makeGithubMergeQueueReads required-context read", () => {
  it("asks REST for the branch's effective rules and shapes the contexts", async () => {
    const asked: Record<string, unknown>[] = [];
    const reads = makeGithubMergeQueueReads({
      graphql: async () => ok({ repository: { ref: { branchProtectionRule: { requiredStatusCheckContexts: [] } } } }),
      rest: async ({ route, params }) => {
        asked.push({ route, ...params });
        return ok({
          data: [{ parameters: { required_status_checks: [{ context: "build" }] }, type: "required_status_checks" }],
        });
      },
    });
    const shaped = unwrap(await reads.requiredContexts({ branch: "main", owner: "acme", repo: "widget" }));
    expect(shaped.contexts).toEqual(["build"]);
    expect(asked).toEqual([
      {
        branch: "main",
        owner: "acme",
        per_page: 100,
        repo: "widget",
        route: "GET /repos/{owner}/{repo}/rules/branches/{branch}",
      },
    ]);
  });

  it("carries a REST transport failure through untouched", async () => {
    const reads = makeGithubMergeQueueReads({
      graphql: async () => ok({ repository: { ref: { branchProtectionRule: { requiredStatusCheckContexts: [] } } } }),
      rest: async () => err(GithubLiveErrors.readFailed({ message: "rules read denied" })),
    });
    const failure = unwrapErr(await reads.requiredContexts({ branch: "main", owner: "acme", repo: "widget" }));
    expect(failure.message).toBe("rules read denied");
  });
});

describe("parseProtectionContexts", () => {
  it("reads the contexts CLASSIC branch protection requires", () => {
    const shaped = unwrap(
      parseProtectionContexts({
        data: {
          repository: {
            ref: {
              branchProtectionRule: {
                requiredStatusCheckContexts: ["build", "integration"],
                requiresCodeOwnerReviews: true,
              },
            },
          },
        },
        identity: "acme/widget",
      }),
    );
    expect(shaped.contexts).toEqual(["build", "integration"]);
    expect(shaped.requiresCodeOwnerReviews).toBe(true);
  });

  it("answers empty for a ref with a protection rule that requires no contexts", () => {
    const shaped = unwrap(
      parseProtectionContexts({
        data: {
          repository: {
            ref: { branchProtectionRule: { requiredStatusCheckContexts: [], requiresCodeOwnerReviews: false } },
          },
        },
        identity: "acme/widget",
      }),
    );
    expect(shaped.contexts).toEqual([]);
    expect(shaped.requiresCodeOwnerReviews).toBe(false);
  });

  it("answers UNDEFINED, never false, for the code-owner setting when there is no classic rule at all", () => {
    // The two are different claims: "this branch does not require code-owner review" and "we never found
    // out". A query that does not select the field reads an unread setting as no requirement.
    const shaped = unwrap(
      parseProtectionContexts({
        data: { repository: { ref: { branchProtectionRule: null } } },
        identity: "acme/widget",
      }),
    );
    expect(shaped.contexts).toEqual([]);
    expect(shaped.requiresCodeOwnerReviews).toBe(undefined);
  });

  it("refuses a payload with no repository at that address", () => {
    const failure = unwrapErr(parseProtectionContexts({ data: {}, identity: "acme/widget" }));
    expect(failure.code).toBe("NOT_FOUND");
  });
});

describe("the required-context read unions both governance mechanisms", () => {
  const protectionData = ({ contexts }: { contexts: readonly string[] }): unknown => ({
    repository: { ref: { branchProtectionRule: { requiredStatusCheckContexts: contexts } } },
  });

  it("finds the contexts when only CLASSIC branch protection carries them", async () => {
    const reads = makeGithubMergeQueueReads({
      graphql: async () => ok(protectionData({ contexts: ["build", "integration"] })),
      rest: async () => ok({ data: [{ ruleset_id: 1, type: "repository_transfer" }] }),
    });
    const shaped = unwrap(await reads.requiredContexts({ branch: "main", owner: "acme", repo: "widget" }));
    expect(shaped.contexts).toEqual(["build", "integration"]);
  });

  it("finds the contexts when only a RULESET carries them", async () => {
    const reads = makeGithubMergeQueueReads({
      graphql: async () => ok(protectionData({ contexts: [] })),
      rest: async () =>
        ok({
          data: [{ parameters: { required_status_checks: [{ context: "build" }] }, type: "required_status_checks" }],
        }),
    });
    const shaped = unwrap(await reads.requiredContexts({ branch: "main", owner: "acme", repo: "widget" }));
    expect(shaped.contexts).toEqual(["build"]);
  });

  it("dedupes and sorts across the two, so a branch under both reports each context once", async () => {
    const reads = makeGithubMergeQueueReads({
      graphql: async () => ok(protectionData({ contexts: ["integration", "build"] })),
      rest: async () =>
        ok({
          data: [{ parameters: { required_status_checks: [{ context: "build" }] }, type: "required_status_checks" }],
        }),
    });
    const shaped = unwrap(await reads.requiredContexts({ branch: "main", owner: "acme", repo: "widget" }));
    expect(shaped.contexts).toEqual(["build", "integration"]);
  });

  it("reports empty only when NEITHER mechanism requires anything", async () => {
    const reads = makeGithubMergeQueueReads({
      graphql: async () => ok(protectionData({ contexts: [] })),
      rest: async () => ok({ data: [] }),
    });
    const shaped = unwrap(await reads.requiredContexts({ branch: "main", owner: "acme", repo: "widget" }));
    expect(shaped.contexts).toEqual([]);
  });

  it("fails closed when the classic-protection read fails, rather than reporting the ruleset half alone", async () => {
    const reads = makeGithubMergeQueueReads({
      graphql: async () => err(GithubLiveErrors.readFailed({ message: "protection read denied" })),
      rest: async () => ok({ data: [] }),
    });
    const failure = unwrapErr(await reads.requiredContexts({ branch: "main", owner: "acme", repo: "widget" }));
    expect(failure.message).toBe("protection read denied");
  });
});

describe("parseMergeQueuePr reads native-stack membership", () => {
  const membership = { baseRefName: "staging", number: 16_958, size: 3 };

  it("reads BOTH fields null as an ordinary pull request", () => {
    expect(unwrap(parseMergeQueuePr({ data: prData({}), identity: IDENTITY })).stack).toBeUndefined();
  });

  it("reads a member's stack number, landing branch, size and its own position", () => {
    const pr = unwrap(
      parseMergeQueuePr({
        data: prData({ stack: membership, stackEntry: { position: 2 } }),
        identity: IDENTITY,
      }),
    );
    expect(pr.stack).toStrictEqual({ baseRefName: "staging", number: 16_958, position: 2, size: 3 });
  });

  it("keeps the pull request's OWN base separate from the stack's, because they differ mid-stack", () => {
    const pr = unwrap(
      parseMergeQueuePr({
        data: prData({ stack: membership, stackEntry: { position: 2 } }),
        identity: IDENTITY,
      }),
    );
    expect(pr.baseRefName).toBe("main");
    expect(pr.stack?.baseRefName).toBe("staging");
  });

  it("refuses a stack with no entry beside it rather than reading it as no stack", () => {
    const failure = unwrapErr(parseMergeQueuePr({ data: prData({ stack: membership }), identity: IDENTITY }));
    expect(failure.message).toBe(
      "GitHub returned acme/widget#9 with a half-populated native stack — stack present, stackEntry absent. " +
        "A membership this read cannot understand is never read as 'no stack'.",
    );
  });

  it("refuses an entry with no stack beside it, the same way and for the same reason", () => {
    const failure = unwrapErr(parseMergeQueuePr({ data: prData({ stackEntry: { position: 1 } }), identity: IDENTITY }));
    expect(failure.message).toContain("stack absent, stackEntry present");
  });

  it("refuses a membership missing its landing branch", () => {
    const failure = unwrapErr(
      parseMergeQueuePr({
        data: prData({ stack: { number: 16_958, size: 3 }, stackEntry: { position: 1 } }),
        identity: IDENTITY,
      }),
    );
    expect(failure.message).toBe(
      "GitHub returned acme/widget#9 inside a native stack without one of its number, baseRefName, size or " +
        "the pull request's own position",
    );
  });

  it("refuses a position that is not a positive whole number", () => {
    const failure = unwrapErr(
      parseMergeQueuePr({
        data: prData({ stack: membership, stackEntry: { position: "2" } }),
        identity: IDENTITY,
      }),
    );
    expect(failure.message).toContain("the pull request's own position");
  });
});
