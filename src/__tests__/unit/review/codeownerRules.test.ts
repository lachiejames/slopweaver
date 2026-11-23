import { describe, expect, it } from "vitest";

import { approvedTeamsOf, codeownerReviewState } from "../../../review/codeownerRules.js";
import { parseCodeowners } from "../../../review/codeowners.js";

/** A repository whose paths invoke three different rules — one per directory the fixtures change. */
const RULES = parseCodeowners({
  content: ["* @org/everyone", "/api/ @a-colleague", "/apps/data/ @org/data", "/infra/ @org/infra\n"].join("\n"),
});

const state = ({
  changedPaths,
  approved = [],
  approvedTeams = [],
  requested = [],
  authorLogin = "the-owner",
}: {
  changedPaths: readonly string[];
  approved?: readonly string[];
  approvedTeams?: readonly string[];
  requested?: readonly string[];
  authorLogin?: string;
}): ReturnType<typeof codeownerReviewState> =>
  codeownerReviewState({
    approvedLogins: new Set(approved),
    approvedTeams: new Set(approvedTeams),
    authorLogin,
    changedPaths,
    requestedReviewers: requested,
    rules: RULES,
  });

describe("codeownerReviewState", () => {
  // A REGRESSION, as a test. Three rows told the owner to merge pull requests their codeowners
  // had not approved, and the one that was confidently wrong named a real required approver whose tick
  // satisfied ONE rule while two team rules were still owed. One satisfied rule is not all of them.
  it("refuses to read ready with one rule satisfied and two still owed", () => {
    const answer = state({
      approved: ["a-colleague"],
      changedPaths: ["api/handler.ts", "apps/data/main.ts", "infra/stack.ts"],
      requested: ["data", "infra"],
    });
    expect(answer.verdict).toBe("unsatisfied");
    expect(answer.rules.map((rule) => rule.satisfaction)).toEqual(["satisfied", "unsatisfied", "unsatisfied"]);
    expect(answer.owed.map((rule) => rule.pattern)).toEqual(["/apps/data/", "/infra/"]);
    expect(answer.why).toContain("2 of 3 codeowner rules still owe a review");
  });

  it("reads satisfied only when every invoked rule has an approval", () => {
    const answer = state({ approved: ["a-colleague"], changedPaths: ["api/handler.ts"] });
    expect(answer.verdict).toBe("satisfied");
    expect(answer.owed).toEqual([]);
    expect(answer.why).toBe("");
    expect(answer.rules[0]!.satisfiedBy).toBe("a-colleague");
  });

  it("says a team is owed while GitHub still has a review request out to it", () => {
    const answer = state({ changedPaths: ["apps/data/main.ts"], requested: ["data"] });
    expect(answer.verdict).toBe("unsatisfied");
    expect(answer.rules[0]!.why).toContain("still has a review request out to @org/data");
  });

  // Team membership is in nothing this read fetches, so an approval from a member is invisible. `unknown`
  // is the honest answer, and it is never `satisfied` — asserting ready is the costly error.
  it("answers unknown for a team with no outstanding request, never satisfied", () => {
    const answer = state({ approved: ["somebody-else"], changedPaths: ["apps/data/main.ts"] });
    expect(answer.verdict).toBe("unknown");
    expect(answer.rules[0]!.satisfaction).toBe("unknown");
    expect(answer.rules[0]!.why).toContain("team membership is not in this read");
  });

  // A live pull request: every team carried an on-behalf-of approval and the rules read
  // `5/6 unproven`, because only the request register was consulted.
  it("satisfies a team rule from an approval GitHub recorded on the team's behalf", () => {
    const answer = state({
      approved: ["a-colleague"],
      approvedTeams: ["org/data", "org/everyone"],
      changedPaths: ["README.md", "api/handler.ts", "apps/data/main.ts"],
    });
    expect(answer.verdict).toBe("satisfied");
    expect(answer.rules.map((rule) => rule.satisfiedBy)).toEqual(["org/everyone", "a-colleague", "org/data"]);
    expect(answer.rules[2]!.why).toBe(
      "GitHub recorded an approval on behalf of @org/data, which satisfies `/apps/data/`",
    );
  });

  it("matches an on-behalf-of team however CODEOWNERS cased the token, and leaves an unapproved team unknown", () => {
    const answer = codeownerReviewState({
      approvedLogins: new Set<string>(),
      approvedTeams: new Set(["org/data"]),
      authorLogin: "the-owner",
      changedPaths: ["apps/data/main.ts", "infra/stack.ts"],
      requestedReviewers: [],
      rules: parseCodeowners({ content: "/apps/data/ @Org/Data\n/infra/ @org/infra\n" }),
    });
    expect(answer.rules.map((rule) => rule.satisfaction)).toEqual(["satisfied", "unknown"]);
    expect(answer.verdict).toBe("unknown");
  });
});

describe("approvedTeamsOf", () => {
  it("collects the teams an approval still standing was recorded on behalf of, lower-cased", () => {
    const teams = approvedTeamsOf({
      approvedLogins: new Set(["a-member"]),
      reviews: [{ login: "A-Member", onBehalfOf: ["Org/Data", ""], state: "APPROVED" }],
    });
    expect([...teams]).toEqual(["org/data"]);
  });

  // An approval the same reviewer later replaced with a change request no longer speaks for the team: the
  // caller's `approvedLogins` drops them, so the team drops with them.
  it("drops a team whose approver's latest opinion is no longer an approval", () => {
    const teams = approvedTeamsOf({
      approvedLogins: new Set<string>(),
      reviews: [
        { login: "a-member", onBehalfOf: ["org/data"], state: "APPROVED" },
        { login: "a-member", onBehalfOf: [], state: "CHANGES_REQUESTED" },
      ],
    });
    expect([...teams]).toEqual([]);
  });

  it("never reads a dismissed approval as one", () => {
    const teams = approvedTeamsOf({
      approvedLogins: new Set(["a-member"]),
      reviews: [{ login: "a-member", onBehalfOf: ["org/data"], state: "DISMISSED" }],
    });
    expect([...teams]).toEqual([]);
  });
});

describe("codeownerReviewState, continued", () => {
  it("satisfies a multi-owner rule from any one of its owners", () => {
    const answer = codeownerReviewState({
      approvedLogins: new Set(["second-owner"]),
      approvedTeams: new Set<string>(),
      authorLogin: "the-owner",
      changedPaths: ["api/handler.ts"],
      requestedReviewers: [],
      rules: parseCodeowners({ content: "/api/ @first-owner @second-owner\n" }),
    });
    expect(answer.verdict).toBe("satisfied");
    expect(answer.rules[0]!.satisfiedBy).toBe("second-owner");
  });

  it("reports a rule the author alone owns as unsatisfied with nobody able to clear it", () => {
    const answer = codeownerReviewState({
      approvedLogins: new Set<string>(),
      approvedTeams: new Set<string>(),
      authorLogin: "the-owner",
      changedPaths: ["api/handler.ts"],
      requestedReviewers: [],
      rules: parseCodeowners({ content: "/api/ @the-owner\n" }),
    });
    expect(answer.verdict).toBe("unsatisfied");
    expect(answer.rules[0]!.clearableBy).toEqual([]);
    expect(answer.rules[0]!.why).toBe("`/api/` is owned only by the author, so nobody can ever satisfy it");
  });

  it("names only the owners a chase could reach, never the author", () => {
    const answer = codeownerReviewState({
      approvedLogins: new Set<string>(),
      approvedTeams: new Set<string>(),
      authorLogin: "the-owner",
      changedPaths: ["api/handler.ts"],
      requestedReviewers: ["eng"],
      rules: parseCodeowners({ content: "/api/ @the-owner @org/eng\n" }),
    });
    expect(answer.rules[0]!.clearableBy).toEqual(["@org/eng"]);
  });

  it("requires nothing when the changed paths invoke no rule at all", () => {
    const answer = codeownerReviewState({
      approvedLogins: new Set<string>(),
      approvedTeams: new Set<string>(),
      authorLogin: "the-owner",
      changedPaths: ["README.md"],
      requestedReviewers: [],
      rules: parseCodeowners({ content: "/api/ @a-colleague\n" }),
    });
    expect(answer.verdict).toBe("none");
    expect(answer.rules).toEqual([]);
    expect(answer.why).toBe("the changed paths invoke no CODEOWNERS rule, so ownership requires no approval");
  });

  it("groups every path that invoked one rule under that single requirement", () => {
    const answer = state({ approved: ["a-colleague"], changedPaths: ["api/one.ts", "api/two.ts"] });
    expect(answer.rules).toHaveLength(1);
    expect(answer.rules[0]!.paths).toEqual(["api/one.ts", "api/two.ts"]);
  });
});
