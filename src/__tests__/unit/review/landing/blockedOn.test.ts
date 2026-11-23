import { describe, expect, it } from "vitest";
import { codeownerReviewState } from "../../../../review/codeownerRules.js";
import { parseCodeowners } from "../../../../review/codeowners.js";
import type { GithubReviewRequest } from "../../../../review/githubCodeowners.js";
import { githubMergeStatus } from "../../../../review/githubMergeStatus.js";
import type { LandingTest } from "../../../../review/landing.js";
import { blockedOn, landingTests } from "../../../../review/landingTests.js";
import { pendingCodeowners } from "../../../../review/requiredCodeowners.js";
import type { PrReviewState } from "../../../../review/reviewState.js";
import { BLOCKED, HAS_QUEUE, owners, state } from "./fixtures.js";

describe("blockedOn", () => {
  it("names GitHub's pending code owners, `@`-prefixed, and never an ordinary review request", () => {
    // A non-code-owner request is GitHub's own `asCodeOwner: false`, and it is ignored.
    const names = blockedOn({
      state: state({
        githubMergeStatus: BLOCKED,
        githubCodeowners: owners({
          requests: [
            { asCodeOwner: true, kind: "team", name: "acme/eng" },
            { asCodeOwner: false, kind: "user", name: "a-colleague" },
          ],
        }),
      }),
    });
    expect(names).toEqual(["@acme/eng"]);
  });

  it("is empty when nobody is holding it", () => {
    expect(blockedOn({ state: state() })).toEqual([]);
  });

  it("names nobody once GitHub says it would merge it, so the row cannot contradict its own test", () => {
    const held = state({
      githubMergeStatus: BLOCKED,
      githubCodeowners: owners({ requests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }] }),
    });
    expect(blockedOn({ state: held })).toEqual(["@acme/eng"]);
    expect(blockedOn({ state: { ...held, githubMergeStatus: githubMergeStatus({ value: "CLEAN" }) } })).toEqual([]);
  });
});

/**
 * A delegate's shape: every team approved on its own behalf, the one individual rule approved by
 * its co-owner, and an `asCodeOwner` request still open to a person no rule names — a team's delegate. GitHub's
 * merge status is BLOCKED (by threads), so the merge-status release cannot fire.
 */
const delegateShape = ({
  extraRule = "",
  approvedTeams = ["acme/eng", "acme/platform"],
  requests = [{ asCodeOwner: true, kind: "user" as const, name: "a-delegate" }],
}: {
  extraRule?: string;
  approvedTeams?: readonly string[];
  requests?: readonly GithubReviewRequest[];
} = {}): PrReviewState =>
  state({
    codeowners: codeownerReviewState({
      approvedLogins: new Set(["a-colleague", "a-member"]),
      approvedTeams: new Set(approvedTeams),
      authorLogin: "the-owner",
      changedPaths: ["README.md", "infra/stack.ts", "apps/datadog/panel.ts"],
      requestedReviewers: [],
      rules: parseCodeowners({
        content: `* @acme/eng\n/infra/ @acme/platform\n/apps/datadog/ @the-owner @a-colleague\n${extraRule}`,
      }),
    }),
    githubCodeowners: owners({
      requests,
      reviews: [{ login: "a-member", onBehalfOf: ["acme/eng", "acme/platform"], state: "APPROVED" }],
    }),
    githubMergeStatus: BLOCKED,
  });

/** The `codeowners-satisfied` test on one state. */
const codeownersVerdict = ({ state: given }: { state: PrReviewState }): LandingTest =>
  landingTests({ queueAvailability: HAS_QUEUE, state: given }).find((test) => test.id === "codeowners-satisfied")!;

describe("a leftover code-owner request to a person", () => {
  it("names nobody and passes codeowners when the request is a team's delegate and every rule is approved", () => {
    const given = delegateShape();
    expect(pendingCodeowners({ state: given }).leftovers.map((owner) => owner.token)).toEqual(["@a-delegate"]);
    expect(blockedOn({ state: given })).toEqual([]);
    expect(codeownersVerdict({ state: given })).toEqual({
      id: "codeowners-satisfied",
      verdict: "pass",
      why:
        "every CODEOWNERS rule it invokes is approved — the open request to @a-delegate, who owns none of them, " +
        "is a leftover rather than a requirement",
    });
  });

  it("keeps a person who owns an invoked rule, whoever else satisfied it", () => {
    const given = delegateShape({ extraRule: "/apps/datadog/panel.ts @a-colleague @a-delegate\n" });
    expect(given.codeowners.verdict).toBe("satisfied");
    expect(blockedOn({ state: given })).toEqual(["@a-delegate"]);
  });

  it("keeps the person while a team GitHub flags is still pending, since they may be that team's delegate", () => {
    const given = delegateShape({
      requests: [
        { asCodeOwner: true, kind: "user", name: "a-delegate" },
        { asCodeOwner: true, kind: "team", name: "acme/dx" },
      ],
    });
    expect(blockedOn({ state: given })).toEqual(["@acme/dx", "@a-delegate"]);
  });

  it("keeps the person while any invoked rule is unproven", () => {
    const given = delegateShape({ approvedTeams: ["acme/eng"] });
    expect(given.codeowners.verdict).toBe("unknown");
    expect(blockedOn({ state: given })).toEqual(["@a-delegate"]);
    expect(codeownersVerdict({ state: given }).verdict).toBe("fail");
  });

  it("keeps the person when GitHub reported more review requests than the read carried", () => {
    const given = {
      ...delegateShape(),
      githubCodeowners: { ...delegateShape().githubCodeowners, requestsTruncated: true },
    };
    expect(blockedOn({ state: given })).toEqual(["@a-delegate"]);
  });

  it("keeps the person when the changed-path list was truncated, since a missing path may invoke that person's rule", () => {
    expect(blockedOn({ state: { ...delegateShape(), changedPathsTruncated: true } })).toEqual(["@a-delegate"]);
  });

  it("keeps the person when GitHub states a review decision other than APPROVED", () => {
    expect(blockedOn({ state: { ...delegateShape(), reviewDecision: "REVIEW_REQUIRED" } })).toEqual(["@a-delegate"]);
  });

  // The rules are read off the default branch; GitHub applies the base's own CODEOWNERS, which may name the person.
  it("keeps the person when the base is not the default branch whose CODEOWNERS was read", () => {
    expect(blockedOn({ state: { ...delegateShape(), codeownersOffBase: true } })).toEqual(["@a-delegate"]);
  });
});
