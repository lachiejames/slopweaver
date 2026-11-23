/**
 * The `github merge` decisions, as pure functions.
 */
import { describe, expect, it } from "vitest";
import type { DocBudget } from "../../../../../canon/alwaysOnDocs.js";
import { GITHUB_MERGE_FLAG_NAMES, parseGithubMergeArgs } from "../../../../../cli/commands/github/mergeArgs.js";
import {
  baseUnresolvedFindings,
  docsBudgetFindingsFromSweep,
  measuredTreeLines,
  mergeReportLines,
  mergeVerdict,
  regressionsFromSweep,
  remedyFor,
  unacknowledgedFindings,
} from "../../../../../cli/commands/github/mergeCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { MergeDocsBudgetSweep } from "../../../../../outbound/github/docsBudgetSweep.js";
import type { MergeFinding } from "../../../../../outbound/github/mergeGuard.js";
import type { MergeProbeSweep } from "../../../../../outbound/github/probeSweep.js";

const VALID_ARGV: readonly string[] = [
  "--repo",
  "owner/name",
  "--base",
  "main",
  "--head",
  "feature",
  "--description",
  "-",
];

describe("parseGithubMergeArgs", () => {
  it("accepts a complete, minimal invocation with the documented defaults", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({
      acknowledge: [],
      acknowledgeAll: false,
      admin: false,
      base: "main",
      cwd: undefined,
      deletionThreshold: 40,
      descriptionSource: "-",
      dryRun: false,
      head: "feature",
      home: undefined,
      number: undefined,
      reason: undefined,
      remote: "origin",
      repo: "owner/name",
    });
  });

  it("requires --repo, --base, --head and --description all at once", () => {
    const parsed = parseGithubMergeArgs({ argv: [] });
    expect(parsed.isErr()).toBe(true);
    const joined = unwrapErr(parsed).join(" ");
    expect(joined).toContain("--repo");
    expect(joined).toContain("--base");
    expect(joined).toContain("--head");
    expect(joined).toContain("--description");
  });

  it("parses a comma-separated --acknowledge list, trimming and dropping blanks", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--acknowledge", "src/x.ts, doc-slug ,"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).acknowledge).toEqual(["src/x.ts", "doc-slug"]);
  });

  it("refuses --acknowledge-all without --reason", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--acknowledge-all"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("--reason");
  });

  it("accepts --acknowledge-all paired with --reason", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--acknowledge-all", "--reason", "reviewed by hand"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).acknowledgeAll).toBe(true);
    expect(unwrap(parsed).reason).toBe("reviewed by hand");
  });

  it("rejects a non-integer --deletion-threshold", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--deletion-threshold", "abc"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("--deletion-threshold");
  });

  it("rejects a negative --deletion-threshold", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--deletion-threshold", "-1"] });
    expect(unwrapErr(parsed)).toEqual(['--deletion-threshold must be a non-negative whole number; "-1" is not']);
  });

  it("is strict: an unknown flag is refused rather than ignored", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--definitely-not-a-real-flag"] });
    expect(unwrapErr(parsed)).toEqual(["unknown flag: --definitely-not-a-real-flag"]);
  });

  it("refuses --admin with no --number, because a merge must name what it merges", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--admin"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["--admin must name the pull request to merge with --number <n>"]);
  });

  it("accepts --dry-run with --admin, so a landing can be checked without writing", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--admin", "--number", "21", "--dry-run"] });
    expect([unwrap(parsed).admin, unwrap(parsed).dryRun]).toEqual([true, true]);
  });

  it("refuses --dry-run without --admin, since the report alone already writes nothing", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--dry-run"] });
    expect(unwrapErr(parsed)).toEqual([
      "--dry-run describes the --admin landing without writing, so it requires --admin",
    ]);
  });

  // It used to be REFUSED here, because a --number that did nothing read as a merge that was asked for and
  // silently did not happen. A standing merge hold names ONE pull request, so a report now needs a way to
  // say which one it is for — see `mergeHold.ts` — and --number is it on both paths.
  it("accepts --number without --admin, since a report identifies itself against a merge hold with it", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--number", "21"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).number).toBe(21);
    expect(unwrap(parsed).admin).toBe(false);
  });

  it("refuses a --number that is not a positive whole number", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--admin", "--number", "0"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(['--number must be a positive whole number; "0" is not']);
  });

  it("accepts --admin with a --number and an overridden --remote", () => {
    const parsed = parseGithubMergeArgs({
      argv: [...VALID_ARGV, "--admin", "--number", "21", "--remote", "upstream"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).admin).toBe(true);
    expect(unwrap(parsed).number).toBe(21);
    expect(unwrap(parsed).remote).toBe("upstream");
  });

  it("keeps an empty --remote as given rather than reading it as the absent flag's origin", () => {
    const parsed = parseGithubMergeArgs({ argv: [...VALID_ARGV, "--remote", ""] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).remote).toBe("");
  });

  it("advertises exactly the flags GITHUB_MERGE_FLAG_NAMES declares", () => {
    expect(GITHUB_MERGE_FLAG_NAMES.toSorted()).toEqual(
      [
        "--repo",
        "--cwd",
        "--base",
        "--head",
        "--description",
        "--deletion-threshold",
        "--acknowledge",
        "--reason",
        "--home",
        "--number",
        "--remote",
        "--acknowledge-all",
        "--admin",
        "--dry-run",
      ].toSorted(),
    );
  });
});

const REGRESSION_FINDING: MergeFinding = {
  detail: "merging this would break a probe that passes today: `present: src/x.ts#y`",
  kind: "probe-regression",
  subject: "a-doc",
};

const DELETION_FINDING: MergeFinding = {
  detail: "10 line(s) removed from a path the description never names",
  kind: "unmentioned-deletion",
  subject: "src/gone.ts",
};

describe("regressionsFromSweep", () => {
  it("passes an evaluated sweep's regressions through unchanged", () => {
    const sweep: MergeProbeSweep = {
      docsChecked: 3,
      kind: "evaluated",
      regressions: [{ probe: "present: a#b", slug: "s" }],
    };
    expect(regressionsFromSweep({ sweep })).toEqual([{ probe: "present: a#b", slug: "s" }]);
  });

  it("turns a not-evaluated sweep into exactly one synthetic regression, never zero", () => {
    const sweep: MergeProbeSweep = { kind: "not-evaluated", reason: "no board found" };
    expect(regressionsFromSweep({ sweep })).toEqual([
      { probe: "orchestration board not evaluated: no board found", slug: "orchestration-board" },
    ]);
  });
});

describe("docsBudgetFindingsFromSweep", () => {
  it("reports nothing when every budget is inside its ceiling", () => {
    const sweep: MergeDocsBudgetSweep = {
      budgets: [{ budget: 500, label: "skills/loop/SKILL.md body", measured: 480, target: 500, unit: "lines" }],
      kind: "evaluated",
    };
    expect(docsBudgetFindingsFromSweep({ sweep })).toEqual([]);
  });

  it("names the exact measured number when the MERGED tree crosses a cap neither branch crossed alone", () => {
    // The shape of two branches that each pass alone: 502 lines on the merged tree, over the 500-line skill-body cap.
    const over: DocBudget = {
      budget: 500,
      label: "skills/loop/SKILL.md body",
      measured: 502,
      target: 500,
      unit: "lines",
    };
    const sweep: MergeDocsBudgetSweep = { budgets: [over], kind: "evaluated" };
    expect(docsBudgetFindingsFromSweep({ sweep })).toEqual([
      {
        detail:
          "skills/loop/SKILL.md body: 502 lines — 2 over its budget of 500 (documented target 500). Move " +
          "content out to a linked doc or a skill; do not raise the budget.",
        kind: "docs-budget",
        subject: "skills/loop/SKILL.md body",
      },
    ]);
  });

  it("turns a not-evaluated sweep into exactly one synthetic finding, never a silent clean", () => {
    const sweep: MergeDocsBudgetSweep = { kind: "not-evaluated", reason: "main and feature do not merge cleanly" };
    expect(docsBudgetFindingsFromSweep({ sweep })).toEqual([
      {
        detail: "main and feature do not merge cleanly",
        kind: "docs-budget",
        subject: "always-on-docs-budget",
      },
    ]);
  });
});

describe("unacknowledgedFindings", () => {
  it("returns every finding when nothing is acknowledged", () => {
    expect(unacknowledgedFindings({ acknowledge: [], acknowledgeAll: false, findings: [REGRESSION_FINDING] })).toEqual([
      REGRESSION_FINDING,
    ]);
  });

  it("drops a finding whose exact subject was acknowledged", () => {
    expect(
      unacknowledgedFindings({
        acknowledge: ["a-doc"],
        acknowledgeAll: false,
        findings: [REGRESSION_FINDING, DELETION_FINDING],
      }),
    ).toEqual([DELETION_FINDING]);
  });

  it("returns nothing at all when acknowledgeAll is set, regardless of the list", () => {
    expect(
      unacknowledgedFindings({
        acknowledge: [],
        acknowledgeAll: true,
        findings: [REGRESSION_FINDING, DELETION_FINDING],
      }),
    ).toEqual([]);
  });
});

describe("baseUnresolvedFindings", () => {
  it("reports nothing when the remote tip was fetched", () => {
    expect(
      baseUnresolvedFindings({
        resolved: { branch: "main", fetchedFrom: "origin", revision: "abc1234", why: undefined },
      }),
    ).toEqual([]);
  });

  it("reports one acknowledgeable finding, carrying the reason, when the local ref was measured instead", () => {
    const findings = baseUnresolvedFindings({
      resolved: { branch: "main", fetchedFrom: undefined, revision: "main", why: "no such remote" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("base-unresolved");
    expect(findings[0]!.subject).toBe("base-unresolved");
    expect(findings[0]!.detail).toContain("no such remote");
    expect(findings[0]!.detail).toContain("LOCAL ref `main`");
  });
});

describe("measuredTreeLines", () => {
  it("names the tree, the fetched base commit and the head commit", () => {
    expect(
      measuredTreeLines({
        baseSha: "b4135f49",
        head: "feature",
        headSha: "cd891870",
        repoRoot: "/repo",
        resolved: { branch: "main", fetchedFrom: "origin", revision: "b4135f49", why: undefined },
      }),
    ).toEqual([
      "measured in tree: /repo",
      "measured base:    main = b4135f49  (origin/main, fetched just now)",
      "measured head:    feature = cd891870",
    ]);
  });

  it("says LOCAL, and why, when the remote tip was never fetched", () => {
    expect(
      measuredTreeLines({
        baseSha: "8a412b05",
        head: "feature",
        headSha: "cd891870",
        repoRoot: "/repo",
        resolved: { branch: "main", fetchedFrom: undefined, revision: "main", why: "offline" },
      })[1],
    ).toBe("measured base:    main = 8a412b05  (LOCAL ref — the remote tip was NOT fetched: offline)");
  });
});

describe("remedyFor", () => {
  it("names a remedy for every finding kind", () => {
    expect(remedyFor({ kind: "probe-regression" })).toContain("confirm this is intentional");
    expect(remedyFor({ kind: "reverts-main" })).toContain("read the named base commit");
    expect(remedyFor({ kind: "base-moved" })).toContain("rebase onto the current base ONCE");
    expect(remedyFor({ kind: "base-moved" })).toContain("slopweaver github enqueue");
    expect(remedyFor({ kind: "base-unresolved" })).toContain("fetch the base branch and rerun");
    expect(remedyFor({ kind: "unmentioned-deletion" })).toContain("name this file");
    expect(remedyFor({ kind: "unmentioned-test-deletion" })).toContain("this test");
    expect(remedyFor({ kind: "docs-budget" })).toContain("move content out");
  });
});

describe("mergeReportLines", () => {
  it("reports clean when there are no findings", () => {
    expect(mergeReportLines({ acknowledge: [], acknowledgeAll: false, findings: [] })).toEqual([
      "clean: no findings against the measured diff, the base branch's history, or the orchestration board.",
    ]);
  });

  it("marks an acknowledged finding as ACKNOWLEDGED and an unmatched one as UNACKNOWLEDGED", () => {
    const lines = mergeReportLines({
      acknowledge: ["a-doc"],
      acknowledgeAll: false,
      findings: [REGRESSION_FINDING, DELETION_FINDING],
    });
    expect(lines).toEqual([
      "probe-regression  (1)",
      "  [ACKNOWLEDGED] a-doc",
      "      merging this would break a probe that passes today: `present: src/x.ts#y`",
      "      remedy: confirm this is intentional, or restore what the probe checks for, before merging",
      "unmentioned-deletion  (1)",
      "  [UNACKNOWLEDGED] src/gone.ts",
      "      10 line(s) removed from a path the description never names",
      "      remedy: name this file in the description, or shrink the change so it is not a silent deletion",
    ]);
  });
});

describe("mergeVerdict", () => {
  it("is not refused, and says so, when there are no findings", () => {
    const verdict = mergeVerdict({
      admin: false,
      acknowledge: [],
      acknowledgeAll: false,
      findings: [],
      reason: undefined,
    });
    expect(verdict.refused).toBe(false);
    expect(verdict.lines.at(-1)).toContain("nothing stands unacknowledged");
  });

  it("is refused when a finding is not acknowledged", () => {
    const verdict = mergeVerdict({
      admin: false,
      acknowledge: [],
      acknowledgeAll: false,
      findings: [DELETION_FINDING],
      reason: undefined,
    });
    expect(verdict.refused).toBe(true);
    expect(verdict.lines.at(-1)).toContain("REFUSED");
  });

  it("is not refused once every finding is individually acknowledged", () => {
    const verdict = mergeVerdict({
      admin: false,
      acknowledge: ["src/gone.ts"],
      acknowledgeAll: false,
      findings: [DELETION_FINDING],
      reason: undefined,
    });
    expect(verdict.refused).toBe(false);
  });

  it("prints the stated reason when --acknowledge-all was used", () => {
    const verdict = mergeVerdict({
      admin: false,
      acknowledge: [],
      acknowledgeAll: true,
      findings: [DELETION_FINDING],
      reason: "reviewed by hand",
    });
    expect(verdict.refused).toBe(false);
    expect(verdict.lines.some((line) => line.includes("reviewed by hand"))).toBe(true);
  });
});
