import { describe, expect, it } from "vitest";
import type { CodeownerRuleState } from "../../../../review/codeownerRules.js";
import { githubMergeStatus } from "../../../../review/githubMergeStatus.js";
import { owedCodeownerRules } from "../../../../review/owedCodeownerRules.js";
import { BLOCKED, owners, state } from "./fixtures.js";

describe("owedCodeownerRules", () => {
  /** One owed CODEOWNERS rule that the given owners can clear. */
  const rule = ({ clearableBy }: { clearableBy: readonly string[] }): CodeownerRuleState => ({
    clearableBy,
    owners: clearableBy,
    paths: ["apps/customerApp/package.json"],
    pattern: "/apps/customerApp/",
    satisfaction: "unsatisfied",
    satisfiedBy: "",
    why: "no approval from its owners yet",
  });

  /** A pull request GitHub holds on the given code-owner teams, whose parsed CODEOWNERS owes the given rules. */
  const heldOn = ({ teams, owed }: { teams: readonly string[]; owed: readonly CodeownerRuleState[] }) =>
    state({
      codeowners: { ...state().codeowners, owed, verdict: "unsatisfied" },
      githubCodeowners: owners({
        requests: teams.map((name) => ({ asCodeOwner: true, kind: "team" as const, name })),
      }),
      githubMergeStatus: BLOCKED,
    });

  it("keeps two separately owed teams as two rules, so one approval is never read as clearing both", () => {
    const held = heldOn({
      owed: [rule({ clearableBy: ["@acme/eng"] }), rule({ clearableBy: ["@acme/customer-app"] })],
      teams: ["acme/eng", "acme/customer-app"],
    });

    expect(owedCodeownerRules({ state: held })).toEqual([["@acme/eng"], ["@acme/customer-app"]]);
  });

  it("drops a parsed rule GitHub no longer holds, since GitHub is the authority on what is still owed", () => {
    const held = heldOn({
      owed: [rule({ clearableBy: ["@acme/eng"] }), rule({ clearableBy: ["@acme/customer-app"] })],
      teams: ["acme/eng"],
    });

    expect(owedCodeownerRules({ state: held })).toEqual([["@acme/eng"]]);
  });

  it("keeps an OR rule whole when GitHub holds any one of its owners", () => {
    const held = heldOn({ owed: [rule({ clearableBy: ["@a-colleague", "@acme/eng"] })], teams: ["acme/eng"] });

    expect(owedCodeownerRules({ state: held })).toEqual([["@a-colleague", "@acme/eng"]]);
  });

  it("never lets a held user keep alive a parsed team rule that shares its slug", () => {
    const held = state({
      codeowners: {
        ...state().codeowners,
        owed: [rule({ clearableBy: ["@platform"] }), rule({ clearableBy: ["@acme/platform"] })],
        verdict: "unsatisfied",
      },
      githubCodeowners: owners({ requests: [{ asCodeOwner: true, kind: "user", name: "platform" }] }),
      githubMergeStatus: BLOCKED,
    });

    expect(owedCodeownerRules({ state: held })).toEqual([["@platform"]]);
  });

  it("adds a held owner no parsed rule names as a rule of its own, rather than losing it", () => {
    const held = heldOn({ owed: [], teams: ["acme/eng"] });

    expect(owedCodeownerRules({ state: held })).toEqual([["@acme/eng"]]);
  });

  it("owes nothing once GitHub would merge it, whatever the parsed CODEOWNERS says", () => {
    const held = heldOn({ owed: [rule({ clearableBy: ["@acme/eng"] })], teams: ["acme/eng"] });

    expect(
      owedCodeownerRules({ state: { ...held, githubMergeStatus: githubMergeStatus({ value: "CLEAN" }) } }),
    ).toEqual([]);
  });
});
