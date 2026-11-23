import { describe, expect, it } from "vitest";

import {
  type VulnReviewerChoice,
  type VulnReviewerLine,
  vulnOwedTeams,
  vulnReviewerChoices,
} from "../../../review/vulnReviewerChoice.js";

/** The shape of the `#dev-alerts` roster: two defaults on the broad teams, one fallback on a narrow one. */
const ROSTER = { defaults: ["rosa", "jasper"], fallbacks: ["quinn", "tobias"] } as const;

const MEMBERS = new Map<string, ReadonlySet<string>>([
  ["org/eng", new Set(["rosa", "jasper", "tobias", "sadie", "quinn"])],
  ["org/platform", new Set(["rosa", "jasper", "ansel"])],
  ["org/customer-app", new Set(["tobias", "theo"])],
]);

/** One line owing the given rules, opened by the bump author. */
function line({ owed }: { owed: readonly (readonly string[])[] }): VulnReviewerLine {
  return { authorLogin: "author", owedCodeowners: owed };
}

/** Who each choice asks, or `refused`, for a whole-post assertion. */
function asked({ choices }: { choices: readonly VulnReviewerChoice[] }): readonly string[] {
  return choices.map((choice) => (choice.kind === "asked" ? choice.login : "refused"));
}

describe("vulnReviewerChoices", () => {
  it("alternates the two defaults line by line when both clear every line", () => {
    const lines = [1, 2, 3, 4, 5].map(() => line({ owed: [["@org/eng"]] }));

    const choices = vulnReviewerChoices({ lines, members: MEMBERS, roster: ROSTER });

    expect(asked({ choices })).toEqual(["rosa", "jasper", "rosa", "jasper", "rosa"]);
  });

  it("alternates on a line GitHub holds no rule on, since either default can take it", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [] }), line({ owed: [] })],
      members: MEMBERS,
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["rosa", "jasper"]);
    expect(choices[0]?.why).toContain("no code-owner rule");
  });

  it("asks a default through an AND of two teams they are both on", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@org/eng"], ["@org/platform"]] })],
      members: MEMBERS,
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["rosa"]);
  });

  it("asks the ONE fallback who clears every owed rule when no default clears one", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@org/eng"], ["@org/customer-app"]] })],
      members: MEMBERS,
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["tobias"]);
    expect(choices[0]?.why).toContain("code-owner exception");
    expect(choices[0]?.why).toContain("@org/customer-app");
  });

  it("skips a fallback who clears the rule the defaults miss but not every rule", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@org/platform"], ["@org/customer-app"]] })],
      members: new Map([...MEMBERS, ["org/platform", new Set(["rosa", "jasper", "tobias"])]]),
      roster: { defaults: ["rosa", "jasper"], fallbacks: ["theo", "tobias"] },
    });

    expect(asked({ choices })).toEqual(["tobias"]);
  });

  it("keeps the defaults' split even when an exception line sits between theirs", () => {
    const choices = vulnReviewerChoices({
      lines: [
        line({ owed: [["@org/eng"]] }),
        line({ owed: [["@org/eng"], ["@org/customer-app"]] }),
        line({ owed: [["@org/eng"]] }),
      ],
      members: MEMBERS,
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["rosa", "tobias", "jasper"]);
  });

  it("gives a line only one default clears to that default, and the next free line to the other", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@jasper"]] }), line({ owed: [["@org/eng"]] })],
      members: MEMBERS,
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["jasper", "rosa"]);
  });

  it("hands a tied load to the default asked longer ago, so a forced line never puts one on two in a row", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@jasper"]] }), line({ owed: [["@org/eng"]] }), line({ owed: [["@org/eng"]] })],
      members: MEMBERS,
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["jasper", "rosa", "jasper"]);
  });

  it("never asks the author, even when they are a default", () => {
    const choices = vulnReviewerChoices({
      lines: [{ authorLogin: "Rosa", owedCodeowners: [["@org/eng"]] }],
      members: MEMBERS,
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["jasper"]);
  });

  it("asks ONE person when nobody clears both teams a line owes, the other rule still owed", () => {
    // A bump owed two teams, and nobody on the roster is in both.
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@org/web"], ["@org/billing"]] })],
      members: new Map([...MEMBERS, ["org/web", new Set(["quinn"])], ["org/billing", new Set(["tobias"])]]),
      roster: ROSTER,
    });

    expect(choices[0]).toEqual({
      kind: "asked",
      login: "quinn",
      stillOwed: [["@org/billing"]],
      why:
        "one person at a time — nobody on the roster clears every rule GitHub holds (@org/web AND @org/billing); " +
        "quinn clears @org/web, and still owed after their approval is @org/billing, asked for separately once " +
        "they approve",
    });
  });

  it("asks whoever clears the most rules when nobody clears them all, even a fallback over a default", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@org/core"], ["@org/customer-app"], ["@org/mobile"]] })],
      members: new Map([
        ...MEMBERS,
        ["org/core", new Set(["rosa", "jasper", "tobias"])],
        ["org/customer-app", new Set(["tobias", "theo"])],
        ["org/mobile", new Set(["marcel"])],
      ]),
      roster: ROSTER,
    });

    expect(choices[0]).toMatchObject({ kind: "asked", login: "tobias", stillOwed: [["@org/mobile"]] });
  });

  it("still asks one person off a roster too long to spread into one call", () => {
    const fallbacks = Array.from({ length: 130_000 }, (_, index) => (index % 2 === 0 ? "f0" : "f1"));
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@f0"], ["@f1"]] })],
      members: MEMBERS,
      roster: { defaults: ["d"], fallbacks },
    });

    expect(choices[0]).toMatchObject({ kind: "asked", login: "f0", stillOwed: [["@f1"]] });
  });

  it("gives a tie on rules cleared to a default before a fallback, and counts it on that default's turn", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@org/eng"], ["@org/mobile"]] }), line({ owed: [["@org/eng"]] })],
      members: new Map([...MEMBERS, ["org/mobile", new Set(["marcel"])]]),
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["rosa", "jasper"]);
  });

  it("never asks the author for a partial line either", () => {
    const choices = vulnReviewerChoices({
      lines: [{ authorLogin: "quinn", owedCodeowners: [["@org/web"], ["@org/billing"]] }],
      members: new Map([...MEMBERS, ["org/web", new Set(["quinn"])], ["org/billing", new Set(["tobias"])]]),
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["tobias"]);
  });

  it("gives every full-coverage choice nothing still owed", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [] }), line({ owed: [["@org/eng"], ["@org/customer-app"]] })],
      members: new Map([...MEMBERS, ["org/customer-app", new Set(["tobias", "theo"])]]),
      roster: ROSTER,
    });

    expect(choices).toMatchObject([
      { kind: "asked", stillOwed: [] },
      { kind: "asked", stillOwed: [] },
    ]);
  });

  it("refuses a line nobody on the roster clears a single rule of, with the rule, and never a group", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@org/mobile"]] })],
      members: new Map([...MEMBERS, ["org/mobile", new Set(["marcel"])]]),
      roster: ROSTER,
    });

    expect(choices[0]?.kind).toBe("refused");
    expect(choices[0]?.why).toContain("@org/mobile");
    expect(choices[0]?.why).toContain("checked quinn, tobias");
    expect(choices[0]?.why).toContain("rather than tag a group");
  });

  it("refuses a rule only the author owns, saying so", () => {
    const choices = vulnReviewerChoices({ lines: [line({ owed: [[]] })], members: MEMBERS, roster: ROSTER });

    expect(choices[0]?.kind).toBe("refused");
    expect(choices[0]?.why).toContain("only the author owns");
  });

  it("still asks one person beside a rule only the author owns, that rule left owed", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@org/customer-app"], []] })],
      members: new Map([...MEMBERS, ["org/customer-app", new Set(["tobias", "theo"])]]),
      roster: ROSTER,
    });

    expect(choices[0]).toMatchObject({ kind: "asked", login: "tobias", stillOwed: [[]] });
    expect(choices[0]?.why).toContain("still owed after their approval is (a rule only the author owns)");
  });

  it("reads an OR within one rule: a person clears it through any one of its owners", () => {
    const choices = vulnReviewerChoices({
      lines: [line({ owed: [["@quinn", "@org/platform"]] })],
      members: MEMBERS,
      roster: ROSTER,
    });

    expect(asked({ choices })).toEqual(["rosa"]);
  });
});

describe("vulnOwedTeams", () => {
  it("names each team every line's rules mention once, lower-cased, and no user", () => {
    const teams = vulnOwedTeams({
      lines: [line({ owed: [["@Org/Eng"], ["@quinn", "@org/platform"]] }), line({ owed: [["@org/eng"]] })],
    });

    expect(teams).toEqual(["org/eng", "org/platform"]);
  });
});
