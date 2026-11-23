/**
 * `--older-than`'s and `--budget`'s shared grammar, and the plan's rendering — including the one line the
 * owner actually reads, and the "FLOOR" qualifier that keeps it from understating in silence.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import {
  DEFAULT_APPLY_BUDGET,
  DEFAULT_OLDER_THAN,
  parseApplyBudget,
  parseOlderThan,
  renderPrunePlan,
  totalPrunePlan,
} from "../../../worktree/pruneOptions.js";

const verdict = (over: Partial<PruneVerdict> = {}): PruneVerdict => ({
  branch: "landed",
  cls: "merged",
  deleteBranch: true,
  dropsDeps: false,
  diskKib: 1_000_000,
  path: "/repo/.claude/worktrees/landed",
  reason: "merged into the trunk, clean, unreferenced and cold",
  ...over,
});

const render = ({ verdicts }: { verdicts: readonly PruneVerdict[] }) =>
  renderPrunePlan({ measured: true, totals: totalPrunePlan({ verdicts }), verdicts });

/** What an `--apply` run renders: no tree was measured, so there is no gigabyte figure to print. */
const renderUnmeasured = ({ verdicts }: { verdicts: readonly PruneVerdict[] }) =>
  renderPrunePlan({ measured: false, totals: totalPrunePlan({ verdicts }), verdicts });

describe("parseOlderThan", () => {
  it("reads hours, days and minutes", () => {
    expect(unwrap(parseOlderThan({ value: "24h" }))).toBe(86_400_000);
    expect(unwrap(parseOlderThan({ value: "7d" }))).toBe(604_800_000);
    expect(unwrap(parseOlderThan({ value: "90m" }))).toBe(5_400_000);
  });

  it("reads the documented default", () => {
    expect(unwrap(parseOlderThan({ value: DEFAULT_OLDER_THAN }))).toBe(86_400_000);
  });

  it("tolerates surrounding whitespace", () => {
    expect(unwrap(parseOlderThan({ value: " 24h " }))).toBe(86_400_000);
  });

  it("rejects a spelling it never checked rather than guessing at it", () => {
    expect(unwrapErr(parseOlderThan({ value: "24 hours" }))).toEqual([
      'worktree prune: --older-than expects <n>m, <n>h or <n>d (got "24 hours")',
    ]);
    expect(unwrapErr(parseOlderThan({ value: "1.5d" }))).toEqual([
      'worktree prune: --older-than expects <n>m, <n>h or <n>d (got "1.5d")',
    ]);
    expect(unwrapErr(parseOlderThan({ value: "24" }))).toEqual([
      'worktree prune: --older-than expects <n>m, <n>h or <n>d (got "24")',
    ]);
    expect(unwrapErr(parseOlderThan({ value: "h24" }))).toEqual([
      'worktree prune: --older-than expects <n>m, <n>h or <n>d (got "h24")',
    ]);
    expect(unwrapErr(parseOlderThan({ value: "24w" }))).toEqual([
      'worktree prune: --older-than expects <n>m, <n>h or <n>d (got "24w")',
    ]);
    expect(unwrapErr(parseOlderThan({ value: "" }))).toEqual([
      'worktree prune: --older-than expects <n>m, <n>h or <n>d (got "")',
    ]);
  });

  it("names the offending value in the error, so a caller can see what it typed", () => {
    const rejected = parseOlderThan({ value: "24 hours" });
    expect(rejected.isErr()).toBe(true);
    expect(rejected._unsafeUnwrapErr()[0]).toContain('"24 hours"');
  });

  it("rejects zero, which would make every worktree eligible", () => {
    const rejected = parseOlderThan({ value: "0h" });
    expect(rejected.isErr()).toBe(true);
    expect(rejected._unsafeUnwrapErr()[0]).toContain("would make every worktree eligible");
  });
});

describe("renderPrunePlan", () => {
  it("totals in GB, naming each class's count", () => {
    const lines = render({ verdicts: [verdict(), verdict({ cls: "pushed", deleteBranch: false, path: "/b" })] });
    expect(lines.at(-1)).toBe(
      "reclaimable: 1.0 GB from 1 merged · 1.0 GB more from 1 pushed-not-merged (branches kept) · 2.0 GB in total · 0 held",
    );
  });

  it("marks the total a FLOOR when a candidate went unmeasured, and counts how many", () => {
    const lines = render({ verdicts: [verdict(), verdict({ diskKib: null, path: "/b" })] });
    expect(lines.at(-1)).toContain("(a FLOOR — 1 candidate(s) went unmeasured within the disk budget)");
  });

  it("does not call a fully measured total a floor just because a HELD worktree was not measured", () => {
    const lines = render({
      verdicts: [verdict(), verdict({ cls: "hold", diskKib: null, path: "/b", reason: "touched 2h ago" })],
    });
    expect(lines.at(-1)).not.toContain("FLOOR");
  });

  // An `--apply` run measures no tree at all — it reads free space either side instead — so every GB figure
  // here would render `0.0 GB` off a `diskKib` nobody ever filled in. Measured on the first live acme-admin
  // apply, whose plan read `0.0 GB in total (a FLOOR — 44 candidate(s) went unmeasured within the disk
  // budget)` — true in every word and unreadable as anything but a failure.
  it("prints COUNTS and no gigabyte figure on an unmeasured run, so it cannot read as a measurement of zero", () => {
    const verdicts = [verdict({ diskKib: null }), verdict({ cls: "pushed", diskKib: null, path: "/b" })];
    expect(renderUnmeasured({ verdicts }).at(-1)).toBe(
      "reclaimable: 1 merged · 1 pushed-not-merged (branches kept) · 2 tree(s) in total · 0 held",
    );
  });

  it("never calls an unmeasured run's total a FLOOR, since nothing was measured to fall short of", () => {
    expect(renderUnmeasured({ verdicts: [verdict({ diskKib: null })] }).at(-1)).not.toContain("FLOOR");
  });

  it("drops the per-class gigabyte figure from an unmeasured run's headings too", () => {
    expect(renderUnmeasured({ verdicts: [verdict({ diskKib: null })] })[0]).toBe(
      "SAFE — merged, clean, unreferenced, cold: tree removed, and the branch deleted when the trunk holds its tip — 1",
    );
  });

  it("prints no heading for a class with no members", () => {
    expect(render({ verdicts: [verdict()] }).filter((line) => line.startsWith("PUSHED"))).toEqual([]);
  });

  it("gives each worktree its reason and its path, and names a detached HEAD as such", () => {
    const lines = render({
      verdicts: [verdict({ branch: null, cls: "gone", diskKib: null, reason: "absent from disk" })],
    });
    expect(lines[1]).toBe("  (detached) — absent from disk\n    /repo/.claude/worktrees/landed");
  });

  it("closes with how many kept trees an apply would strip of node_modules, and says nothing when none", () => {
    const held = verdict({ cls: "hold", deleteBranch: false, dropsDeps: true, reason: "3 uncommitted change(s)" });
    const lines = renderUnmeasured({ verdicts: [verdict(), held, { ...held, path: "/repo/b" }] });

    expect(lines.at(-1)).toBe("node_modules: 2 kept worktree(s) cold and unreferenced — dropped on --apply, tree kept");
    expect(renderUnmeasured({ verdicts: [verdict()] }).join("\n")).not.toContain("node_modules:");
  });

  it("renders an empty plan as the totals line alone", () => {
    expect(render({ verdicts: [] })).toEqual([
      "reclaimable: 0.0 GB from 0 merged · 0.0 GB more from 0 pushed-not-merged (branches kept) · 0.0 GB in total · 0 held",
    ]);
  });
});

describe("parseApplyBudget", () => {
  it("reads the same grammar as --older-than", () => {
    expect(unwrap(parseApplyBudget({ value: "15m" }))).toBe(900_000);
    expect(unwrap(parseApplyBudget({ value: "2h" }))).toBe(7_200_000);
  });

  it("names --budget, not --older-than, when it refuses", () => {
    expect(unwrapErr(parseApplyBudget({ value: "twenty minutes" }))).toEqual([
      'worktree prune: --budget expects <n>m, <n>h or <n>d (got "twenty minutes")',
    ]);
  });

  it("refuses a zero budget, saying what it would do", () => {
    expect(unwrapErr(parseApplyBudget({ value: "0m" }))).toEqual([
      "worktree prune: --budget 0 would stop the run before it removed anything — pass a real threshold",
    ]);
  });

  it("defaults under the twenty-minute bound the recipe slots were killed by", () => {
    expect(unwrap(parseApplyBudget({ value: DEFAULT_APPLY_BUDGET }))).toBe(900_000);
    expect(unwrap(parseApplyBudget({ value: DEFAULT_APPLY_BUDGET }))).toBeLessThan(1_200_000);
  });
});
