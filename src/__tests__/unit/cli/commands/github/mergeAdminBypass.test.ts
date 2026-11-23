/**
 * The bypass half of `github merge --admin`'s preflight over each of the three answers a classic protection read
 * gives: protected, unprotected (GitHub's 404), and not protectable on the repository's plan (the plan-gated 403).
 */
import { describe, expect, it } from "vitest";

import { bypassOutcome } from "../../../../../cli/commands/github/mergeAdminBypass.js";

const BASE = { baseRef: "main", repo: "acme/widgets", ruleGoverned: false };

describe("bypassOutcome", () => {
  it("needs no bypass, and no admin, on a base its plan cannot protect", () => {
    expect(bypassOutcome({ ...BASE, isAdmin: false, protection: { kind: "plan-unavailable" } })).toEqual({
      notes: [
        "main cannot be protected on this repository's GitHub plan (GitHub answered the protection read with " +
          '"Upgrade to GitHub Pro or make this repository public to enable this feature"), so no branch-protection ' +
          "rule applies to it: this merge needs no bypass — --admin changes nothing here.",
      ],
      refusals: [],
    });
  });

  it("keeps the unprotected base's own words, distinct from the plan's", () => {
    expect(bypassOutcome({ ...BASE, isAdmin: false, protection: { kind: "unprotected" } })).toEqual({
      notes: ["main carries no branch protection, so this merge needs no bypass — --admin changes nothing here."],
      refusals: [],
    });
  });

  it("refuses a protected base that enforces itself on administrators, naming the missing admin too", () => {
    const outcome = bypassOutcome({ ...BASE, isAdmin: false, protection: { enforceAdmins: true, kind: "protected" } });
    expect(outcome.notes).toEqual([]);
    expect(outcome.refusals).toHaveLength(2);
    expect(outcome.refusals[0]).toContain("enforce_admins=true");
    expect(outcome.refusals[1]).toContain("--admin needs ADMIN permission on acme/widgets");
  });
});
