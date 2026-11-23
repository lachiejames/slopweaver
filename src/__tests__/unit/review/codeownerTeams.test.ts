import { describe, expect, it } from "vitest";

import { codeownerReviewState } from "../../../review/codeownerRules.js";
import { parseCodeowners } from "../../../review/codeowners.js";
import { clearanceExpression, codeownerTeamRequirement } from "../../../review/codeownerTeams.js";

/**
 * A repository shaped like the one the owner asked about: a default line, one directory owned by a single
 * team, two SEPARATE directories owned by the same second team, one directory two teams share, and one a
 * named person owns alongside a team.
 */
const RULES = parseCodeowners({
  content: [
    "* @org/everyone",
    "/apps/one/ @org/alpha",
    "/apps/two/ @org/beta",
    "/apps/three/ @org/beta",
    "/apps/shared/ @org/alpha @org/beta",
    "/apps/mixed/ @org/alpha @a-colleague",
    "/scripts/ @a-colleague\n",
  ].join("\n"),
});

const answer = ({
  changedPaths,
  approved = [],
  requested = [],
  authorLogin = "the-owner",
}: {
  changedPaths: readonly string[];
  approved?: readonly string[];
  requested?: readonly string[];
  authorLogin?: string;
}): ReturnType<typeof codeownerReviewState> =>
  codeownerReviewState({
    approvedLogins: new Set(approved),
    approvedTeams: new Set<string>(),
    authorLogin,
    changedPaths,
    requestedReviewers: requested,
    rules: RULES,
  });

describe("codeownerTeamRequirement", () => {
  // THE OWNER'S ASK, as a test: two directories owned by two different teams is an AND, and the
  // whole point is that the same two tokens mean something else when one rule names both of them.
  it("reads two separately-owned directories as an AND over both teams", () => {
    const teams = answer({
      changedPaths: ["apps/one/a.ts", "apps/two/b.ts"],
      requested: ["alpha", "beta"],
    }).teams;
    expect(teams.quantifier).toBe("every");
    expect(teams.expression).toBe("@org/alpha AND @org/beta");
    expect(teams.sentence).toBe(
      "@org/alpha AND @org/beta — AND: every one of those teams owes its own review (2 team requirements across 2 rules)",
    );
    expect(teams.teams).toEqual(["@org/alpha", "@org/beta"]);
  });

  it("reads one directory two teams share as an OR, from the identical two tokens", () => {
    const teams = answer({ changedPaths: ["apps/shared/a.ts"], requested: ["alpha", "beta"] }).teams;
    expect(teams.quantifier).toBe("any");
    expect(teams.expression).toBe("@org/alpha OR @org/beta");
    expect(teams.sentence).toBe(
      "@org/alpha OR @org/beta — OR: any ONE of those teams satisfies it (1 team requirement across 1 rule)",
    );
  });

  // MEASURED on a live pull request: three invoked rules, two team requirements. A reader told
  // "3 rules" concludes three approvals; GitHub needs two, because one approval clears every rule its
  // author owns.
  it("folds two rules owned by the same team into ONE requirement, and says so beside the rule count", () => {
    const teams = answer({
      changedPaths: ["apps/one/a.ts", "apps/two/b.ts", "apps/three/c.ts"],
      requested: ["alpha", "beta"],
    }).teams;
    expect(teams.groups.length).toBe(2);
    expect(teams.groups[1]!.patterns).toEqual(["/apps/two/", "/apps/three/"]);
    expect(teams.expression).toBe("@org/alpha AND @org/beta");
    expect(teams.sentence).toBe(
      "@org/alpha AND @org/beta — AND: every one of those teams owes its own review (2 team requirements across 3 rules)",
    );
  });

  it("binds a shared rule with parentheses only when there is a second requirement to bind it against", () => {
    const teams = answer({
      changedPaths: ["apps/shared/a.ts", "apps/one/b.ts"],
      requested: ["alpha", "beta"],
    }).teams;
    expect(teams.expression).toBe("@org/alpha AND (@org/alpha OR @org/beta)");
    expect(teams.quantifier).toBe("every");
  });

  it("names one owning team without inventing a connective for it", () => {
    const teams = answer({ changedPaths: ["apps/one/a.ts"], requested: ["alpha"] }).teams;
    expect(teams.quantifier).toBe("single");
    expect(teams.sentence).toBe("@org/alpha — the only owning team (1 team requirement across 1 rule)");
  });

  it("says a named person can clear the rule instead, rather than asserting the team is the only route", () => {
    const teams = answer({ changedPaths: ["apps/mixed/a.ts"], requested: ["alpha"] }).teams;
    expect(teams.groups[0]!.alsoClearableBy).toEqual(["@a-colleague"]);
    expect(teams.sentence).toBe(
      "@org/alpha — the only owning team (1 team requirement across 1 rule); a named person can clear " +
        "the same rule instead of the team — @org/alpha or @a-colleague",
    );
  });

  it("says no team owes anything when the only invoked rule names a person", () => {
    const teams = answer({ changedPaths: ["scripts/run.sh"] }).teams;
    expect(teams.quantifier).toBe("none");
    expect(teams.expression).toBe("");
    expect(teams.teams).toEqual([]);
    expect(teams.sentence).toBe(
      "no invoked CODEOWNERS rule names a team, so ownership is owed by named people rather than by any team",
    );
  });

  it("distinguishes an empty rule set from a rule set with no team in it", () => {
    const teams = codeownerTeamRequirement({ rules: [] });
    expect(teams.quantifier).toBe("none");
    expect(teams.sentence).toBe("no CODEOWNERS rule was invoked at all, so no team owes a review");
  });

  it("marks a team requirement whose approval has landed, so the expression never reads as all still owed", () => {
    const teams = answer({
      approved: ["a-colleague"],
      changedPaths: ["apps/two/a.ts", "apps/mixed/b.ts"],
      requested: ["beta"],
    }).teams;
    expect(teams.groups[1]!.satisfaction).toBe("satisfied");
    expect(teams.expression).toBe("@org/beta AND @org/alpha [approved]");
  });

  // Two rules the SAME team owns fold into one group even when a person cleared one of them, and the group
  // is unsatisfied — the person's approval says nothing about the other rule that team still owes.
  it("does not read a person-cleared rule as clearing the same team's other rule", () => {
    const teams = answer({
      approved: ["a-colleague"],
      changedPaths: ["apps/one/a.ts", "apps/mixed/b.ts"],
      requested: ["alpha"],
    }).teams;
    expect(teams.groups.length).toBe(1);
    expect(teams.groups[0]!.satisfaction).toBe("unsatisfied");
    expect(teams.expression).toBe("@org/alpha");
  });

  it("folds an unsatisfied rule over an unknown one into unsatisfied, never the other way", () => {
    const teams = answer({
      changedPaths: ["apps/two/a.ts", "apps/three/b.ts"],
      requested: ["beta"],
    }).teams;
    expect(teams.groups.length).toBe(1);
    expect(teams.groups[0]!.satisfaction).toBe("unsatisfied");
  });
});

describe("clearanceExpression", () => {
  it("joins two owed rules with AND, which a space-joined token list could never say", () => {
    const owed = answer({
      changedPaths: ["apps/one/a.ts", "apps/two/b.ts"],
      requested: ["alpha", "beta"],
    }).owed;
    expect(clearanceExpression({ owed })).toBe("@org/alpha AND @org/beta");
  });

  it("joins one rule's own owners with OR, and keeps a named person in the expression", () => {
    const owed = answer({ changedPaths: ["apps/mixed/a.ts"], requested: ["alpha"] }).owed;
    expect(clearanceExpression({ owed })).toBe("@a-colleague OR @org/alpha");
  });

  it("dedupes two owed rules the same owners can clear, because one approval clears both", () => {
    const owed = answer({
      changedPaths: ["apps/two/a.ts", "apps/three/b.ts"],
      requested: ["beta"],
    }).owed;
    expect(owed.length).toBe(2);
    expect(clearanceExpression({ owed })).toBe("@org/beta");
  });

  it("is empty when the only owed rule is one nobody but the author owns", () => {
    const owed = answer({ authorLogin: "a-colleague", changedPaths: ["scripts/run.sh"] }).owed;
    expect(owed.length).toBe(1);
    expect(clearanceExpression({ owed })).toBe("");
  });
});
