import { describe, expect, it } from "vitest";
import {
  baseMovedFindings,
  type DiffPath,
  describesPath,
  mergeGuardFindings,
  pathAliases,
  probeRegressionFindings,
  revertsMainFindings,
  unmentionedDeletions,
} from "../../../../outbound/github/mergeGuard.js";

/**
 * The measured incident these tests are written against.
 *
 * A pull request was squashed with `git reset --soft main` while an earlier one was already on `main`, so every file
 * the earlier one had added was recorded as a deletion. Its description was entirely about GitHub pull-request bodies and
 * named `distil` nowhere. The fixtures below are that diff, reduced to the paths that matter.
 */
const INCIDENT_DIFF: readonly DiffPath[] = [
  { deleted: 0, path: "src/outbound/github/parse.ts", status: "added" },
  { deleted: 132, path: "src/outbound/github/prLedger.ts", status: "modified" },
  { deleted: 198, path: "src/__tests__/unit/cli/commands/distil/latestCollapse.test.ts", status: "deleted" },
  { deleted: 124, path: "src/__tests__/unit/corpus/latestRecords.test.ts", status: "deleted" },
  { deleted: 20, path: "src/cli/commands/distil/run.ts", status: "modified" },
];

/** The squashed pull request's real subject matter: a pull-request description you can edit twice. It mentions nothing about distil. */
const INCIDENT_DESCRIPTION =
  "Authorship instead of a ledger, a reverse parser, and two locks with keys. " +
  "Updating a pull request description no longer destroys the Proof section: `src/outbound/github/parse.ts` " +
  "reverses the rendered body back into a form, and prLedger.ts stops being the source of truth.";

describe("pathAliases", () => {
  it("offers the whole path, the file name and the holding directory", () => {
    expect(pathAliases({ path: "src/cli/commands/distil/run.ts" })).toEqual([
      "src/cli/commands/distil/run.ts",
      "run.ts",
      "distil",
    ]);
  });

  it("offers only the name for a bare file at the repository root", () => {
    expect(pathAliases({ path: "AGENTS.md" })).toEqual(["AGENTS.md", "AGENTS.md"]);
  });

  it("ignores a leading separator rather than emitting an empty segment", () => {
    expect(pathAliases({ path: "/tmp/x.ts" })).toEqual(["/tmp/x.ts", "x.ts"]);
  });

  /**
   * The defect this guards, found by running the guard against a reconstructed incident rather than by any
   * unit test: `src` was offered as an alias, so a description naming ANY `src/` path matched every file in
   * the repository and real deletions went unreported. The fixtures above all used deep paths, so the whole
   * suite passed over it.
   */
  it("does NOT offer a top-level directory as an alias — `src` names every file in the repo", () => {
    expect(pathAliases({ path: "src/thing.ts" })).toEqual(["src/thing.ts", "thing.ts"]);
  });

  it("still offers a real nested directory, which is how a body names an area", () => {
    expect(pathAliases({ path: "src/gold/distil.ts" })).toEqual(["src/gold/distil.ts", "distil.ts", "gold"]);
  });
});

describe("describesPath", () => {
  it("accepts a description naming the directory, which is how prose refers to an area", () => {
    expect(describesPath({ description: "reworks the distil batching", path: "src/cli/commands/distil/run.ts" })).toBe(
      true,
    );
  });

  it("accepts a description naming the file", () => {
    expect(describesPath({ description: "prLedger.ts stops being the source of truth", path: "x/prLedger.ts" })).toBe(
      true,
    );
  });

  it("matches case-insensitively, because a body writes prose not paths", () => {
    expect(describesPath({ description: "the Distil path", path: "src/distil/run.ts" })).toBe(true);
  });

  it("rejects a description that names neither the file, the directory nor the path", () => {
    expect(describesPath({ description: INCIDENT_DESCRIPTION, path: "src/cli/commands/distil/run.ts" })).toBe(false);
  });

  it("does not treat a shared top-level directory as a mention", () => {
    expect(describesPath({ description: "Adds src/feature.ts, a small feature.", path: "src/thing.ts" })).toBe(false);
  });
});

describe("baseMovedFindings", () => {
  /**
   * Measured against this guard's own pull request: base had gained ten files while the branch was in
   * flight, and the previous `resurrected-deletion` rule reported every one as a deletion "almost certainly
   * unintended". GitHub's own diff showed zero — a merge is computed from the merge base and keeps them all.
   * The finding now says what is true, and the diff it judges is merge-base relative so those files never
   * enter it in the first place.
   */
  it("reports each path base holds that the branch has never seen", () => {
    const findings = baseMovedFindings({ baseAhead: ["src/new.ts", "src/newer.ts"] });

    expect(findings.map((f) => f.subject)).toEqual(["src/new.ts", "src/newer.ts"]);
    expect(findings[0]!.kind).toBe("base-moved");
  });

  it("says merging KEEPS the file, because a reader must not read this as a deletion", () => {
    expect(baseMovedFindings({ baseAhead: ["src/new.ts"] })[0]!.detail).toContain("Merging keeps");
  });

  it("reports nothing when the branch is level with base", () => {
    expect(baseMovedFindings({ baseAhead: [] })).toEqual([]);
  });
});

describe("unmentionedDeletions", () => {
  it("reports a deleted test the description never names, as its own kind", () => {
    const findings = unmentionedDeletions({
      deletionThreshold: 100,
      description: INCIDENT_DESCRIPTION,
      diff: INCIDENT_DIFF,
    });
    const tests = findings.filter((f) => f.kind === "unmentioned-test-deletion");
    expect(tests.map((f) => f.subject)).toEqual([
      "src/__tests__/unit/cli/commands/distil/latestCollapse.test.ts",
      "src/__tests__/unit/corpus/latestRecords.test.ts",
    ]);
  });

  it("reports a large removal from a modified file the description never names", () => {
    const findings = unmentionedDeletions({
      deletionThreshold: 10,
      description: INCIDENT_DESCRIPTION,
      diff: INCIDENT_DIFF,
    });
    const quiet = findings.filter((f) => f.kind === "unmentioned-deletion");
    expect(quiet.map((f) => f.subject)).toEqual(["src/cli/commands/distil/run.ts"]);
    expect(quiet[0]!.detail).toBe("20 line(s) removed from a path the description never names");
  });

  it("stays silent about a file the description DOES name, however much it removes", () => {
    const findings = unmentionedDeletions({
      deletionThreshold: 10,
      description: INCIDENT_DESCRIPTION,
      diff: INCIDENT_DIFF,
    });
    expect(findings.map((f) => f.subject)).not.toContain("src/outbound/github/prLedger.ts");
  });

  it("leaves a modified file below the threshold alone, so ordinary edits do not cry wolf", () => {
    const diff: readonly DiffPath[] = [{ deleted: 3, path: "src/quiet/tweak.ts", status: "modified" }];
    expect(unmentionedDeletions({ deletionThreshold: 10, description: "unrelated", diff })).toEqual([]);
  });

  it("reports an unnamed deletion that is not a test under the plain deletion kind", () => {
    const diff: readonly DiffPath[] = [{ deleted: 5, path: "src/gone/module.ts", status: "deleted" }];
    const findings = unmentionedDeletions({ deletionThreshold: 999, description: "unrelated", diff });
    expect(findings).toEqual([
      {
        detail: "5 line(s) removed from a path the description never names",
        kind: "unmentioned-deletion",
        subject: "src/gone/module.ts",
      },
    ]);
  });
});

describe("revertsMainFindings", () => {
  it("reports each path whose proposed content the base branch's own history once held", () => {
    const findings = revertsMainFindings({
      reverted: [
        { path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" },
        { path: "skills/loop/SKILL.md", restoresBaseCommit: "bbbbbbb" },
      ],
    });
    expect(findings.map((f) => f.subject)).toEqual(["src/poster.ts", "skills/loop/SKILL.md"]);
    expect(findings[0]!.kind).toBe("reverts-main");
  });

  it("names the base commit whose content would be restored, so the claim is checkable", () => {
    expect(
      revertsMainFindings({ reverted: [{ path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" }] })[0]!.detail,
    ).toContain("held exactly this proposed content at aaaaaaa");
  });

  it("claims neither a fork-point identity nor a base change, because it measures neither", () => {
    const detail = revertsMainFindings({ reverted: [{ path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" }] })[0]!
      .detail;
    expect(detail.includes("fork point")).toBe(false);
    expect(detail.includes("has changed it since")).toBe(false);
  });

  it("reports nothing when no file was reverted", () => {
    expect(revertsMainFindings({ reverted: [] })).toEqual([]);
  });
});

describe("probeRegressionFindings", () => {
  it("names the doc and quotes the probe that would break", () => {
    expect(
      probeRegressionFindings({
        regressions: [
          { probe: "present: src/cli/commands/distil/run.ts#latestRecords", slug: "distil-latest-collapse" },
        ],
      }),
    ).toEqual([
      {
        detail:
          "merging this would break a probe that passes today: `present: src/cli/commands/distil/run.ts#latestRecords`",
        kind: "probe-regression",
        subject: "distil-latest-collapse",
      },
    ]);
  });

  it("returns nothing when no probe regresses", () => {
    expect(probeRegressionFindings({ regressions: [] })).toEqual([]);
  });
});

describe("mergeGuardFindings", () => {
  it("refuses the measured squashed merge, leading with the probe regression", () => {
    const findings = mergeGuardFindings({
      baseAhead: [],
      deletionThreshold: 10,
      description: INCIDENT_DESCRIPTION,
      diff: INCIDENT_DIFF,
      regressions: [{ probe: "present: src/cli/commands/distil/run.ts#latestRecords", slug: "distil-latest-collapse" }],
      reverted: [],
    });
    expect(findings[0]!.kind).toBe("probe-regression");
    expect(findings[0]!.subject).toBe("distil-latest-collapse");
    // No `base-moved` entries: after a `git reset --soft base` the merge base IS base's tip, so the branch is
    // level with it and nothing is ahead. The description rules are what catch this incident — which is why
    // the whole guard cannot rest on the squash signature alone.
    expect(findings.map((f) => f.kind)).toEqual([
      "probe-regression",
      "unmentioned-test-deletion",
      "unmentioned-test-deletion",
      "unmentioned-deletion",
    ]);
  });

  it("passes a clean pull request: everything it touches is named and no probe moves", () => {
    const diff: readonly DiffPath[] = [
      { deleted: 0, path: "src/outbound/github/parse.ts", status: "added" },
      { deleted: 12, path: "src/outbound/github/prLedger.ts", status: "modified" },
    ];
    expect(
      mergeGuardFindings({
        baseAhead: [],
        deletionThreshold: 10,
        description: INCIDENT_DESCRIPTION,
        diff,
        regressions: [],
        reverted: [],
      }),
    ).toEqual([]);
  });

  it("still refuses when the description is honest but the base moved underneath it", () => {
    const findings = mergeGuardFindings({
      baseAhead: ["src/__tests__/unit/corpus/latestRecords.test.ts"],
      deletionThreshold: 10,
      description: "removes src/__tests__/unit/corpus/latestRecords.test.ts deliberately",
      diff: [{ deleted: 124, path: "src/__tests__/unit/corpus/latestRecords.test.ts", status: "deleted" }],
      regressions: [],
      reverted: [],
    });
    expect(findings.map((f) => f.kind)).toEqual(["base-moved"]);
  });

  it("leads with a proven revert ahead of the mere squash-staleness signature, even when both fire", () => {
    const findings = mergeGuardFindings({
      baseAhead: ["src/newly-gained.ts"],
      deletionThreshold: 10,
      description: "unrelated work",
      diff: [],
      regressions: [],
      reverted: [{ path: "src/poster.ts", restoresBaseCommit: "aaaaaaa" }],
    });
    expect(findings.map((f) => f.kind)).toEqual(["reverts-main", "base-moved"]);
  });
});
