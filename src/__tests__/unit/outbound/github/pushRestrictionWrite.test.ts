import { ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { PushRestrictionErrors } from "../../../../outbound/github/pushRestrictionErrors.js";
import { parseBranchPushRule, parseUserNodeId } from "../../../../outbound/github/pushRestrictionParse.js";
import {
  describeRestriction,
  type GithubPushRestrictionApi,
  neighboursMoved,
  ruleHoldsTarget,
  setAndConfirmPushRestriction,
} from "../../../../outbound/github/pushRestrictionWrite.js";

/** One rule node as GitHub's GraphQL answers it. */
function ruleNode({
  pattern,
  restrictsPushes = false,
  actors = [],
  allowanceTotal = actors.length,
}: {
  pattern: string;
  restrictsPushes?: boolean;
  actors?: readonly Record<string, unknown>[];
  allowanceTotal?: number;
}): Record<string, unknown> {
  return {
    id: `rule-${pattern}`,
    isAdminEnforced: false,
    pattern,
    pushAllowances: {
      nodes: actors.map((actor) => ({ actor })),
      totalCount: allowanceTotal,
    },
    requiresApprovingReviews: false,
    requiresCodeOwnerReviews: false,
    restrictsPushes,
  };
}

function payload({ nodes }: { nodes: readonly Record<string, unknown>[] }): unknown {
  return { repository: { branchProtectionRules: { nodes, totalCount: nodes.length } } };
}

describe("parseBranchPushRule", () => {
  it("picks the rule whose pattern is exactly the branch and shapes every actor kind", () => {
    const data = payload({
      nodes: [
        ruleNode({ pattern: "release/*" }),
        ruleNode({
          actors: [
            { __typename: "User", login: "ada" },
            { __typename: "Team", slug: "platform" },
            { __typename: "App", slug: "renovate" },
          ],
          pattern: "main",
          restrictsPushes: true,
        }),
      ],
    });

    const rule = unwrap(parseBranchPushRule({ branch: "main", data, identity: "o/r" }));

    expect(rule.ruleId).toBe("rule-main");
    expect(rule.restrictsPushes).toBe(true);
    expect(rule.allowances).toEqual([
      { kind: "user", name: "ada" },
      { kind: "team", name: "platform" },
      { kind: "app", name: "renovate" },
    ]);
  });

  it("refuses a glob rule that merely matches, naming every pattern it saw", () => {
    const data = payload({ nodes: [ruleNode({ pattern: "ma*" })] });

    const error = unwrapErr(parseBranchPushRule({ branch: "main", data, identity: "o/r" }));

    expect(error).toEqual(PushRestrictionErrors.noRule({ branch: "main", identity: "o/r", patterns: ["ma*"] }));
    expect(error.message).toContain("(patterns: ma*)");
  });

  it("refuses an allowance page that does not hold every actor", () => {
    const data = payload({
      nodes: [ruleNode({ actors: [{ __typename: "User", login: "a" }], allowanceTotal: 2, pattern: "main" })],
    });

    const error = unwrapErr(parseBranchPushRule({ branch: "main", data, identity: "o/r" }));

    expect(error.code).toBe("MALFORMED_PAYLOAD");
    expect(error.message).toContain("lists 1 of 2 allowances");
  });

  it("refuses an actor of a type it cannot name", () => {
    const data = payload({ nodes: [ruleNode({ actors: [{ __typename: "Bot" }], pattern: "main" })] });

    expect(unwrapErr(parseBranchPushRule({ branch: "main", data, identity: "o/r" })).code).toBe("MALFORMED_PAYLOAD");
  });

  it("refuses a payload with no rules connection", () => {
    expect(unwrapErr(parseBranchPushRule({ branch: "main", data: { repository: null }, identity: "o/r" })).code).toBe(
      "MALFORMED_PAYLOAD",
    );
  });
});

describe("parseUserNodeId", () => {
  it("returns the node id", () => {
    expect(unwrap(parseUserNodeId({ data: { user: { id: "U_1", login: "a" } }, login: "a" }))).toBe("U_1");
  });

  it("names a login GitHub does not know", () => {
    expect(unwrapErr(parseUserNodeId({ data: { user: null }, login: "ghost" })).message).toBe(
      'no GitHub user has the login "ghost"',
    );
  });
});

describe("ruleHoldsTarget", () => {
  const restricted = { allowances: [{ kind: "user" as const, name: "Ada" }], restrictsPushes: true };

  it("matches logins case-insensitively", () => {
    expect(ruleHoldsTarget({ rule: restricted, target: { kind: "restrict", logins: ["ada"] } })).toBe(true);
  });

  it("does not count a team of the same name as the user", () => {
    const team = { allowances: [{ kind: "team" as const, name: "ada" }], restrictsPushes: true };

    expect(ruleHoldsTarget({ rule: team, target: { kind: "restrict", logins: ["ada"] } })).toBe(false);
  });

  it("is unrestricted only with no stale allowance left behind", () => {
    expect(ruleHoldsTarget({ rule: { allowances: [], restrictsPushes: false }, target: { kind: "unrestrict" } })).toBe(
      true,
    );
    expect(ruleHoldsTarget({ rule: { ...restricted, restrictsPushes: false }, target: { kind: "unrestrict" } })).toBe(
      false,
    );
  });
});

describe("describeRestriction", () => {
  it("prints each state in one line", () => {
    expect(describeRestriction({ rule: { allowances: [], restrictsPushes: false } })).toBe("unrestricted");
    expect(describeRestriction({ rule: { allowances: [], restrictsPushes: true } })).toBe("restricted to nobody");
    expect(
      describeRestriction({
        rule: {
          allowances: [
            { kind: "user", name: "b" },
            { kind: "app", name: "a" },
          ],
          restrictsPushes: true,
        },
      }),
    ).toBe("restricted to app:a, user:b");
  });
});

/** A plain fake whose read observes whatever the last update stored. */
function fakeApi({
  users,
  updates,
  ignoreWrites = false,
}: {
  users: Readonly<Record<string, string>>;
  updates: { restrictsPushes: boolean; actorIds: readonly string[] }[];
  ignoreWrites?: boolean;
}): GithubPushRestrictionApi {
  const stored = { actorIds: [] as readonly string[], restrictsPushes: false };
  const loginOf = Object.fromEntries(Object.entries(users).map(([login, id]) => [id, login]));
  return {
    readRules: () =>
      ResultAsync.fromSafePromise(
        Promise.resolve(
          payload({
            nodes: [
              ruleNode({
                actors: stored.actorIds.map((id) => ({ __typename: "User", login: loginOf[id] })),
                pattern: "main",
                restrictsPushes: stored.restrictsPushes,
              }),
            ],
          }),
        ),
      ),
    update: ({ restrictsPushes, actorIds }) => {
      updates.push({ actorIds: [...actorIds], restrictsPushes });
      if (!ignoreWrites) {
        stored.actorIds = [...actorIds];
        stored.restrictsPushes = restrictsPushes;
      }
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    },
    userId: ({ login }) =>
      ResultAsync.fromSafePromise(
        Promise.resolve({ user: users[login] === undefined ? null : { id: users[login], login } }),
      ),
  };
}

const unrestrictedRule = {
  allowances: [],
  isAdminEnforced: false,
  pattern: "main",
  requiresApprovingReviews: false,
  requiresCodeOwnerReviews: false,
  restrictsPushes: false,
  ruleId: "rule-main",
};

describe("neighboursMoved", () => {
  it("is silent when only the restriction changed", () => {
    expect(
      neighboursMoved({
        after: { ...unrestrictedRule, allowances: [{ kind: "user", name: "a" }], restrictsPushes: true },
        before: unrestrictedRule,
      }),
    ).toBe(undefined);
  });

  it("names a read-back that found a different rule", () => {
    expect(neighboursMoved({ after: { ...unrestrictedRule, ruleId: "rule-2" }, before: unrestrictedRule })).toBe(
      "a different rule (rule-2, was rule-main)",
    );
  });

  it("names a neighbouring field the write moved", () => {
    expect(neighboursMoved({ after: { ...unrestrictedRule, isAdminEnforced: true }, before: unrestrictedRule })).toBe(
      "isAdminEnforced true, was false",
    );
  });
});

describe("setAndConfirmPushRestriction", () => {
  it("resolves the logins, sends their node ids once and confirms by read-back", async () => {
    const updates: { restrictsPushes: boolean; actorIds: readonly string[] }[] = [];

    const result = await setAndConfirmPushRestriction({
      api: fakeApi({ updates, users: { ada: "U_1" } }),
      branch: "main",
      identity: "o/r",
      owner: "o",
      repo: "r",
      rule: unrestrictedRule,
      target: { kind: "restrict", logins: ["ada"] },
    });

    expect(updates).toEqual([{ actorIds: ["U_1"], restrictsPushes: true }]);
    expect(unwrap(result).allowances).toEqual([{ kind: "user", name: "ada" }]);
  });

  it("refuses an unknown login before sending anything", async () => {
    const updates: { restrictsPushes: boolean; actorIds: readonly string[] }[] = [];

    const result = await setAndConfirmPushRestriction({
      api: fakeApi({ updates, users: {} }),
      branch: "main",
      identity: "o/r",
      owner: "o",
      repo: "r",
      rule: unrestrictedRule,
      target: { kind: "restrict", logins: ["ghost"] },
    });

    expect(unwrapErr(result).code).toBe("UNKNOWN_USER");
    expect(updates).toEqual([]);
  });

  it("reports a read-back that did not take", async () => {
    const updates: { restrictsPushes: boolean; actorIds: readonly string[] }[] = [];

    const result = await setAndConfirmPushRestriction({
      api: fakeApi({ ignoreWrites: true, updates, users: { ada: "U_1" } }),
      branch: "main",
      identity: "o/r",
      owner: "o",
      repo: "r",
      rule: unrestrictedRule,
      target: { kind: "restrict", logins: ["ada"] },
    });

    expect(unwrapErr(result).message).toBe(
      "GitHub accepted the push restriction for o/r@main but the read-back is unrestricted rather than restricted to user:ada",
    );
  });
});
