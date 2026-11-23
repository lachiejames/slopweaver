/**
 * What a base branch requires by way of a REVIEW, parsed from the two mechanisms that can carry it, and the
 * refusal that fact produces. Every case here is a function of its arguments alone.
 *
 * The two ruleset payloads are trimmed copies of what GitHub actually answered for the two
 * repositories this fleet lands into — including the SINGULAR `require_code_owner_review` spelling, which is
 * the field name a ruleset uses and the one a classic-protection reader silently misses.
 */
import { describe, expect, it } from "vitest";
import { err, ok, unwrap } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import type { GithubReadRest } from "../../../../live/github/read.js";
import {
  classicReviewRule,
  makeReviewGateRead,
  parseRulesetReviewRules,
  type ReviewGate,
  type ReviewRule,
  reviewGateRefusal,
} from "../../../../live/github/reviewRules.js";

/** The rules-for-a-branch payload GitHub answers for a ruleset-governed, codeowner-gated branch. */
const RULESET_WITH_CODEOWNERS = {
  data: [
    { ruleset_id: 1, type: "deletion" },
    {
      parameters: { required_status_checks: [{ context: "Required CI" }] },
      ruleset_id: 1,
      type: "required_status_checks",
    },
    {
      parameters: {
        require_code_owner_review: true,
        required_approving_review_count: 0,
        required_review_thread_resolution: true,
      },
      ruleset_id: 1,
      type: "pull_request",
    },
  ],
};

describe("parseRulesetReviewRules", () => {
  it("reads a ruleset pull_request rule that requires a codeowner review", () => {
    const rules = unwrap(
      parseRulesetReviewRules({ branch: "staging", data: RULESET_WITH_CODEOWNERS, identity: "o/n" }),
    );
    expect(rules).toEqual([{ approvals: 0, codeOwners: true, source: "ruleset" }]);
  });

  it("reads an approval count with no codeowner requirement", () => {
    const rules = unwrap(
      parseRulesetReviewRules({
        branch: "main",
        data: {
          data: [
            {
              parameters: { require_code_owner_review: false, required_approving_review_count: 1 },
              type: "pull_request",
            },
          ],
        },
        identity: "o/n",
      }),
    );
    expect(rules).toEqual([{ approvals: 1, codeOwners: false, source: "ruleset" }]);
  });

  it("answers no rules for a branch whose rules require no review at all", () => {
    const rules = unwrap(
      parseRulesetReviewRules({
        branch: "main",
        data: {
          data: [{ type: "deletion" }, { parameters: { required_status_checks: [] }, type: "required_status_checks" }],
        },
        identity: "o/n",
      }),
    );
    expect(rules).toEqual([]);
  });

  it("answers no rules for a pull_request rule that requires neither a codeowner nor an approval", () => {
    const rules = unwrap(
      parseRulesetReviewRules({
        branch: "main",
        data: { data: [{ parameters: { required_approving_review_count: 0 }, type: "pull_request" }] },
        identity: "o/n",
      }),
    );
    expect(rules).toEqual([]);
  });

  it("fails when GitHub answered no rules array at all", () => {
    const parsed = parseRulesetReviewRules({ branch: "main", data: { data: null }, identity: "o/n" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toBe("GitHub returned no rules array for o/n on main");
  });
});

describe("classicReviewRule", () => {
  it("reads the classic required_pull_request_reviews object", () => {
    const rule = classicReviewRule({
      protection: {
        required_pull_request_reviews: { require_code_owner_reviews: true, required_approving_review_count: 2 },
      },
    });
    expect(rule).toEqual({ approvals: 2, codeOwners: true, source: "branch-protection" });
  });

  it("answers undefined for this repository's own main, which carries no review object", () => {
    const rule = classicReviewRule({
      protection: {
        enforce_admins: { enabled: false },
        required_status_checks: { contexts: ["build", "integration"] },
      },
    });
    expect(rule).toBe(undefined);
  });

  it("answers undefined for the 404 case, where there is no payload at all", () => {
    expect(classicReviewRule({ protection: undefined })).toBe(undefined);
  });
});

describe("reviewGateRefusal", () => {
  it("refuses a ruleset codeowner requirement, calling the merge structurally impossible", () => {
    const gate: ReviewGate = {
      branch: "staging",
      kind: "read",
      rules: [{ approvals: 0, codeOwners: true, source: "ruleset" }],
    };
    const refusal = reviewGateRefusal({ baseRef: "staging", gate });
    expect(refusal).toContain("staging requires a review before anything lands on it");
    expect(refusal).toContain("a repository ruleset requires an approving review from a CODEOWNERS owner");
    expect(refusal).toContain("structurally impossible");
    expect(refusal).toContain("slopweaver github pr request-review");
  });

  it("refuses a classic requirement without claiming it is impossible", () => {
    const gate: ReviewGate = {
      branch: "release",
      kind: "read",
      rules: [{ approvals: 1, codeOwners: false, source: "branch-protection" }],
    };
    const refusal = reviewGateRefusal({ baseRef: "release", gate });
    expect(refusal).toContain("classic branch protection requires 1 approving review(s)");
    expect(refusal).toContain("An administrator could technically bypass this");
  });

  it("permits a base whose rules require no review — this repository's own main", () => {
    const gate: ReviewGate = { branch: "main", kind: "read", rules: [] };
    expect(reviewGateRefusal({ baseRef: "main", gate })).toBe(undefined);
  });

  it("does not refuse on an unreadable gate, which the preflight reports as a note instead", () => {
    const gate: ReviewGate = { kind: "unreadable", reason: "token cannot read rules" };
    expect(reviewGateRefusal({ baseRef: "main", gate })).toBe(undefined);
  });

  it("names both mechanisms when a branch carries a rule from each", () => {
    const rules: readonly ReviewRule[] = [
      { approvals: 1, codeOwners: false, source: "branch-protection" },
      { approvals: 0, codeOwners: true, source: "ruleset" },
    ];
    const refusal = reviewGateRefusal({ baseRef: "staging", gate: { branch: "staging", kind: "read", rules } });
    expect(refusal).toContain(
      "classic branch protection requires 1 approving review(s); a repository ruleset requires",
    );
    expect(refusal).toContain("structurally impossible");
  });
});

describe("makeReviewGateRead", () => {
  /** A REST seam answering the classic read with one failure and the rules read with `RULESET_WITH_CODEOWNERS`. */
  function restFailingClassic({ status, message }: { status: number; message: string }): GithubReadRest {
    return async ({ route }) =>
      route.endsWith("/protection")
        ? err(
            GithubLiveErrors.readFailed({
              cause: { kind: "http", message, operation: "github.rest.namedObjectRead", status },
              message,
            }),
          )
        : ok(RULESET_WITH_CODEOWNERS);
  }
  const BRANCH = { branch: "main", owner: "acme", repo: "widgets" };

  it("reads a plan-gated classic 403 like a 404: no classic rule, and the ruleset half still runs", async () => {
    const read = makeReviewGateRead({
      rest: restFailingClassic({
        message:
          "Upgrade to GitHub Pro or make this repository public to enable this feature. - https://docs.github.com",
        status: 403,
      }),
    });
    expect(await read(BRANCH)).toEqual({
      branch: "main",
      kind: "read",
      rules: [{ approvals: 0, codeOwners: true, source: "ruleset" }],
    });
  });

  it("keeps any other classic 403 unreadable, never a branch with no review rule", async () => {
    const read = makeReviewGateRead({ rest: restFailingClassic({ message: "Forbidden", status: 403 }) });
    expect(await read(BRANCH)).toEqual({ kind: "unreadable", reason: "Forbidden" });
  });

  it("judges a 403 by its status even when its message says Not Found", async () => {
    const read = makeReviewGateRead({ rest: restFailingClassic({ message: "Not Found", status: 403 }) });
    expect(await read(BRANCH)).toEqual({ kind: "unreadable", reason: "Not Found" });
  });

  it("reads a classic 404 as no classic rule, and the ruleset half still runs", async () => {
    const read = makeReviewGateRead({ rest: restFailingClassic({ message: "Branch not protected", status: 404 }) });
    expect(await read(BRANCH)).toEqual({
      branch: "main",
      kind: "read",
      rules: [{ approvals: 0, codeOwners: true, source: "ruleset" }],
    });
  });
});
