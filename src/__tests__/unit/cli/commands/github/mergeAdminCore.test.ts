/**
 * The pure decisions behind `slopweaver github merge --admin`. Every one of these is a function of its
 * arguments alone — no clock, no network, no filesystem — so each case is a plain value comparison.
 */
import { describe, expect, it } from "vitest";
import {
  adminMergeDoorRequest,
  adminMergePreflight,
  measuredTheSameChange,
  mergeOutcomeLines,
  postMergeDocsBudgetOutcome,
  remoteBaseBranchOf,
  squashCommitTitle,
} from "../../../../../cli/commands/github/mergeAdminCore.js";
import type { BranchProtection } from "../../../../../corpus/github/write.js";
import type { RequiredContextGate } from "../../../../../live/github/requiredContexts.js";
import type { ReviewGate } from "../../../../../live/github/reviewRules.js";
import type { AdminMergePr } from "../../../../../outbound/github/adminMerge.js";
import type { MergeDocsBudgetSweep } from "../../../../../outbound/github/docsBudgetSweep.js";

const BYPASSABLE: BranchProtection = { enforceAdmins: false, kind: "protected" };
const ENFORCED: BranchProtection = { enforceAdmins: true, kind: "protected" };
const UNPROTECTED: BranchProtection = { kind: "unprotected" };

/** `main` requires no review of any kind — this repository's own measured configuration. */
const NO_REVIEW_REQUIRED: ReviewGate = { branch: "main", kind: "read", rules: [] };

/** Every context `main` requires is on the head — the ordinary, mergeable case. */
const GATE_SATISFIED: RequiredContextGate = {
  branch: "main",
  inFlight: [],
  kind: "read",
  mergeable: undefined,
  missing: [],
  required: ["build"],
  unproven: [],
};

/** One open, non-draft pull request; a case overrides only the field it is about. */
function pr(over: Partial<AdminMergePr> = {}): AdminMergePr {
  return {
    baseRef: "main",
    baseSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    body: "",
    draft: false,
    headRef: "feature",
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    number: 21,
    stack: undefined,
    stackQueue: undefined,
    state: "open",
    title: "feat: a change",
    url: "https://github.invalid/o/n/pull/21",
    ...over,
  };
}

/** Position 2 of 3 in a native stack landing on `main`. */
const STACKED = { baseRefName: "main", number: 900, position: 2, size: 3 } as const;

describe("adminMergePreflight on a native stack member", () => {
  it("refuses a stack member whose stack lands on a base with no merge queue, naming the way out", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: true,
      pr: pr({ stack: STACKED }),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toEqual([
      "#21 is position 2 of 3 in native stack #900, which lands on main. GitHub's merge endpoint does not merge a " +
        "stack member, so `github merge --admin` cannot land it. main has no merge queue, so take it out of the " +
        "stack with `slopweaver github stack remove` (which retargets it) and land it alone " +
        "(skills/github/reference/stack-merge.md).",
    ]);
  });

  it("refuses the same stack member under --dry-run: no lap can clear a stack precondition", () => {
    const permit = adminMergePreflight({
      execution: "dry-run",
      gate: GATE_SATISFIED,
      isAdmin: true,
      pr: pr({ stack: STACKED }),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toHaveLength(1);
    expect(permit.refusals[0]).toContain("main has no merge queue");
  });

  it("refuses a stack member on a queued base too, pointing at enqueue's stack route instead", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: true,
      pr: pr({ stack: STACKED, stackQueue: { branch: "main", url: "https://github.invalid/o/n/queue/main" } }),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toEqual([
      "#21 is position 2 of 3 in native stack #900, which lands on main. GitHub's merge endpoint does not merge a " +
        "stack member, so `github merge --admin` cannot land it. main has a merge queue: land it with " +
        "`slopweaver github enqueue`, which takes the asynchronous route a stack member needs " +
        "(skills/github/reference/stack-merge.md).",
    ]);
  });
});

describe("adminMergePreflight under --dry-run", () => {
  /** `build` and `integration` required, neither on the head: what a head looks like before its lap posts. */
  const UNLAPPED: RequiredContextGate = {
    branch: "main",
    inFlight: [],
    kind: "read",
    mergeable: undefined,
    missing: ["build", "integration"],
    required: ["build", "integration"],
    unproven: [],
  };

  it("turns a required context missing from the head into a note, because the lap is what posts it", () => {
    const permit = adminMergePreflight({
      execution: "dry-run",
      gate: UNLAPPED,
      isAdmin: true,
      pr: pr(),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toEqual([]);
    expect(permit.notes).toHaveLength(2);
    expect(permit.notes[1]).toContain("dry-run note: ");
    expect(permit.notes[1]).toContain("main requires build, integration");
    expect(permit.notes[1]).toContain("The real merge refuses this until the contexts are on the head.");
  });

  it("still refuses what no lap can fix — a draft — under --dry-run", () => {
    const permit = adminMergePreflight({
      execution: "dry-run",
      gate: UNLAPPED,
      isAdmin: true,
      pr: pr({ draft: true }),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toHaveLength(1);
    expect(permit.refusals[0]).toContain("slopweaver github ready");
  });
});

describe("adminMergePreflight", () => {
  it("permits an admin on a protected branch that exempts admins, and says the bypass is being taken", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: true,
      pr: pr(),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toEqual([]);
    expect(permit.notes).toHaveLength(2);
    expect(permit.notes[0]).toContain("enforce_admins=false");
    expect(permit.notes[1]).toBe("every context main requires (build) is on this head.");
  });

  it("refuses an otherwise-permitted merge when a required context never ran, naming it", () => {
    const gate: RequiredContextGate = {
      branch: "main",
      inFlight: [],
      kind: "read",
      mergeable: undefined,
      missing: ["build", "integration"],
      required: ["build", "integration"],
      unproven: [],
    };
    const permit = adminMergePreflight({
      execution: "merge",
      gate,
      isAdmin: true,
      pr: pr(),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toHaveLength(1);
    expect(permit.refusals[0]).toContain("main requires build, integration");
    expect(permit.refusals[0]).toContain("not on this head at all");
  });

  it("refuses the same merge while checks are still in flight — only the refusal's words change", () => {
    const gate: RequiredContextGate = {
      branch: "main",
      inFlight: ["unit-1"],
      kind: "read",
      mergeable: undefined,
      missing: ["build", "integration"],
      required: ["build", "integration"],
      unproven: [],
    };
    const preflight = ({ over }: { over: RequiredContextGate }) =>
      adminMergePreflight({
        execution: "merge",
        gate: over,
        isAdmin: true,
        pr: pr(),
        protection: BYPASSABLE,
        repo: "o/n",
        reviews: NO_REVIEW_REQUIRED,
      });
    const inFlight = preflight({ over: gate });
    const finished = preflight({ over: { ...gate, inFlight: [] } });
    expect(inFlight.refusals).toHaveLength(1);
    expect(inFlight.notes).toEqual(finished.notes);
    expect(inFlight.refusals[0]).toContain("main requires build, integration");
    expect(inFlight.refusals[0]).toContain("the head is NOT landable on this read");
  });

  it("notes, and does not refuse, when the required set could not be read at all", () => {
    const gate: RequiredContextGate = { kind: "unreadable", reason: "branch protection is admin-only" };
    const permit = adminMergePreflight({
      execution: "merge",
      gate,
      isAdmin: true,
      pr: pr(),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toEqual([]);
    expect(permit.notes[1]).toBe(
      "could not read the contexts main requires (branch protection is admin-only) — this merge cannot rule " +
        "out a required gate that never ran.",
    );
  });

  it("refuses when the protection enforces admins, naming that field and not the permission", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: true,
      pr: pr(),
      protection: ENFORCED,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toHaveLength(1);
    expect(permit.refusals[0]).toContain("enforce_admins=true");
    expect(permit.notes).toEqual(["every context main requires (build) is on this head."]);
  });

  it("refuses when the token is not an admin, naming the permission and not the protection", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: false,
      pr: pr(),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toHaveLength(1);
    expect(permit.refusals[0]).toContain("ADMIN permission on o/n");
  });

  it("reports BOTH reasons when the token is not an admin AND the protection enforces admins", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: false,
      pr: pr(),
      protection: ENFORCED,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toHaveLength(2);
  });

  it("permits an unprotected base even without admin — there is no gate to bypass", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: false,
      pr: pr(),
      protection: UNPROTECTED,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toEqual([]);
    expect(permit.notes[0]).toContain("no branch protection");
  });

  it("permits a base its plan cannot protect, without admin, saying so in the plan's own words", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: false,
      pr: pr(),
      protection: { kind: "plan-unavailable" },
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit).toEqual({
      notes: [
        "main cannot be protected on this repository's GitHub plan (GitHub answered the protection read with " +
          '"Upgrade to GitHub Pro or make this repository public to enable this feature"), so no branch-protection ' +
          "rule applies to it: this merge needs no bypass — --admin changes nothing here.",
        "every context main requires (build) is on this head.",
      ],
      refusals: [],
    });
  });

  it("refuses a pull request that is not open", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: true,
      pr: pr({ state: "closed" }),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toHaveLength(1);
    expect(permit.refusals[0]).toContain("#21 is closed, not open");
  });

  it("refuses a base whose ruleset requires a codeowner review, even though classic protection 404s", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: {
        branch: "staging",
        inFlight: [],
        kind: "read",
        mergeable: undefined,
        missing: [],
        required: [],
        unproven: [],
      },
      isAdmin: true,
      pr: pr({ baseRef: "staging" }),
      protection: UNPROTECTED,
      repo: "o/n",
      reviews: {
        branch: "staging",
        kind: "read",
        rules: [{ approvals: 0, codeOwners: true, source: "ruleset" }],
      },
    });
    expect(permit.refusals).toHaveLength(1);
    expect(permit.refusals[0]).toContain("structurally impossible");
    expect(permit.notes).not.toContain(
      "staging carries no branch protection, so this merge needs no bypass — --admin changes nothing here.",
    );
  });

  it("notes an unreadable review gate rather than merging over it silently", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: true,
      pr: pr(),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: { kind: "unreadable", reason: "token cannot read rules" },
    });
    expect(permit.refusals).toEqual([]);
    expect(permit.notes[0]).toBe(
      "could not read what reviews main requires (token cannot read rules) — this merge cannot rule out a " +
        "review requirement no administrator bypass can waive.",
    );
  });

  it("refuses a draft, pointing at the verb that undrafts it", () => {
    const permit = adminMergePreflight({
      execution: "merge",
      gate: GATE_SATISFIED,
      isAdmin: true,
      pr: pr({ draft: true }),
      protection: BYPASSABLE,
      repo: "o/n",
      reviews: NO_REVIEW_REQUIRED,
    });
    expect(permit.refusals).toHaveLength(1);
    expect(permit.refusals[0]).toContain("slopweaver github ready");
  });
});

describe("remoteBaseBranchOf", () => {
  it("strips the remote prefix a locally-resolvable ref carries", () => {
    expect(remoteBaseBranchOf({ base: "origin/main", remote: "origin" })).toBe("main");
  });

  it("leaves a bare branch alone", () => {
    expect(remoteBaseBranchOf({ base: "main", remote: "origin" })).toBe("main");
  });

  it("strips refs/heads/", () => {
    expect(remoteBaseBranchOf({ base: "refs/heads/main", remote: "origin" })).toBe("main");
  });

  it("leaves a DIFFERENT remote's prefix in place rather than guessing", () => {
    expect(remoteBaseBranchOf({ base: "upstream/main", remote: "origin" })).toBe("upstream/main");
  });

  it("strips only the leading occurrence, so a branch named after the remote survives", () => {
    expect(remoteBaseBranchOf({ base: "origin/origin/main", remote: "origin" })).toBe("origin/main");
  });
});

describe("measuredTheSameChange", () => {
  it("agrees when both the base and the head match", () => {
    expect(measuredTheSameChange({ baseBranch: "main", headSha: "a".repeat(40), pr: pr() })).toEqual([]);
  });

  it("refuses when GitHub's base is not the branch that was measured", () => {
    const refusals = measuredTheSameChange({ baseBranch: "develop", headSha: "a".repeat(40), pr: pr() });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("targets main, but this invocation measured against develop");
  });

  it("refuses when the local head is not the commit GitHub would merge", () => {
    const refusals = measuredTheSameChange({ baseBranch: "main", headSha: "b".repeat(40), pr: pr() });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("--head resolves locally to bbbb");
  });

  it("reports both disagreements at once", () => {
    expect(measuredTheSameChange({ baseBranch: "develop", headSha: "b".repeat(40), pr: pr() })).toHaveLength(2);
  });
});

describe("squashCommitTitle", () => {
  it("appends the pull-request number the way GitHub's own squash button does", () => {
    expect(squashCommitTitle({ number: 21, title: "feat: a change" })).toBe("feat: a change (#21)");
  });
});

describe("adminMergeDoorRequest", () => {
  it("is an external-write request naming the exact pull request", () => {
    const request = adminMergeDoorRequest({ acknowledgement: undefined, home: "/home", number: 21, repo: "o/n" });
    expect(request.meta.effect).toBe("external-write");
    expect(request.meta.requiresApproval).toBe(false);
    expect(request.artifact["id"]).toBe("o/n#21");
    expect(request.action).toEqual({ kind: "verb", noun: "github", verb: "merge" });
  });
});

describe("mergeOutcomeLines", () => {
  it("reports the squash commit and the pull-the-base next step", () => {
    const outcome = mergeOutcomeLines({ merged: true, pr: pr(), sha: "c".repeat(40) });
    expect(outcome.failed).toBe(false);
    expect(outcome.lines[0]).toContain(`merged #21 into main as ${"c".repeat(40)}`);
    expect(outcome.lines[1]).toContain("pull main");
  });

  it("treats a 200 that did not merge as a FAILURE, never a success", () => {
    const outcome = mergeOutcomeLines({ merged: false, pr: pr(), sha: "" });
    expect(outcome.failed).toBe(true);
    expect(outcome.lines[0]).toContain("answered without merging");
  });
});

describe("postMergeDocsBudgetOutcome", () => {
  it("reports clean and publishes nothing when every budget is inside its ceiling", () => {
    const sweep: MergeDocsBudgetSweep = {
      budgets: [{ budget: 500, label: "skills/loop/SKILL.md body", measured: 480, target: 500, unit: "lines" }],
      kind: "evaluated",
    };
    const outcome = postMergeDocsBudgetOutcome({ baseBranch: "main", repo: "o/n", sweep });
    expect(outcome.alertWhy).toBeUndefined();
    expect(outcome.lines).toEqual(["post-merge docs-budget probe: main is within every ceiling."]);
  });

  it("names the exact measured number and returns an alert sentence when a budget is crossed", () => {
    const sweep: MergeDocsBudgetSweep = {
      budgets: [{ budget: 500, label: "skills/loop/SKILL.md body", measured: 506, target: 500, unit: "lines" }],
      kind: "evaluated",
    };
    const outcome = postMergeDocsBudgetOutcome({ baseBranch: "main", repo: "o/n", sweep });
    expect(outcome.alertWhy).toBe(
      "o/n@main crossed a documentation budget right after this merge landed: skills/loop/SKILL.md body: 506 " +
        "lines — 6 over its budget of 500 (documented target 500). Move content out to a linked doc or a " +
        "skill; do not raise the budget.",
    );
    expect(outcome.lines[0]).toContain("ALERT");
    expect(outcome.lines.some((line) => line.includes("506 lines"))).toBe(true);
  });

  it("warns rather than alerts when the probe itself could not run", () => {
    const sweep: MergeDocsBudgetSweep = { kind: "not-evaluated", reason: "could not fetch origin/main" };
    const outcome = postMergeDocsBudgetOutcome({ baseBranch: "main", repo: "o/n", sweep });
    expect(outcome.alertWhy).toBeUndefined();
    expect(outcome.lines).toEqual([
      "post-merge docs-budget probe: could not measure main — could not fetch origin/main",
    ]);
  });
});
