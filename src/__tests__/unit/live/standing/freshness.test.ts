/**
 * The standing-session freshness grader — pure, so every case is a plain value in and a plain value out.
 */
import { describe, expect, it } from "vitest";

import {
  gradeStandingTree,
  STANDING_SENSITIVE_PATHS,
  type StandingFreshnessGrade,
  type StandingTreeReading,
  standingGradeIsAlerting,
  standingSessionFreshness,
  standingSessionLines,
  standingTreeLine,
  worstStandingGrade,
} from "../../../../live/standing/freshness.js";

/** A tree reading, overridable per test. */
function reading(over: Partial<StandingTreeReading> = {}): StandingTreeReading {
  return { behind: 0, changedPaths: [], head: "abc1234", path: "/repo/tree", ...over };
}

describe("gradeStandingTree", () => {
  it("grades a tree with nothing upstream of it current", () => {
    const graded = gradeStandingTree({ reading: reading(), role: "bin" });

    expect(graded.grade).toBe("current");
    expect(graded.touched).toEqual([]);
  });

  it("grades drift over no sensitive path as merely behind", () => {
    const graded = gradeStandingTree({
      reading: reading({ behind: 9, changedPaths: ["docs/toolchain.md", "src/corpus/watermark.ts"] }),
      role: "bin",
    });

    expect(graded.grade).toBe("behind");
    expect(graded.touched).toEqual([]);
    expect(graded.behind).toBe(9);
  });

  it("grades drift touching a sensitive path as stale, naming what it touched", () => {
    const graded = gradeStandingTree({
      reading: reading({ behind: 74, changedPaths: ["docs/toolchain.md", "src/cli/commands/listen/loop.ts"] }),
      role: "plugin-dir",
    });

    expect(graded.grade).toBe("stale");
    expect(graded.touched).toEqual(["src/cli/commands/listen/loop.ts"]);
  });

  it("counts a skill-prose change as stale, not only source", () => {
    const graded = gradeStandingTree({
      reading: reading({ behind: 3, changedPaths: ["skills/recipe-scheduler/SKILL.md"] }),
      role: "plugin-dir",
    });

    expect(graded.grade).toBe("stale");
  });

  it("matches on whole segments, so a sibling directory is not a sensitive path", () => {
    const graded = gradeStandingTree({
      reading: reading({ behind: 2, changedPaths: ["src/liveness/probe.ts"] }),
      role: "bin",
    });

    expect(graded.grade).toBe("behind");
  });

  it("deduplicates a sensitive path listed twice", () => {
    const graded = gradeStandingTree({
      reading: reading({ behind: 2, changedPaths: ["src/outbound/a.ts", "src/outbound/a.ts"] }),
      role: "bin",
    });

    expect(graded.touched).toEqual(["src/outbound/a.ts"]);
  });

  it("grades an unreadable count unmeasured rather than current", () => {
    const graded = gradeStandingTree({ reading: reading({ behind: undefined, head: undefined }), role: "bin" });

    expect(graded.grade).toBe("unmeasured");
    expect(graded.behind).toBeUndefined();
  });
});

describe("worstStandingGrade", () => {
  it("returns stale when any tree is stale", () => {
    expect(worstStandingGrade({ grades: ["current", "stale"] })).toBe("stale");
  });

  it("ranks unmeasured above behind, because unknown drift may be any size", () => {
    expect(worstStandingGrade({ grades: ["behind", "unmeasured"] })).toBe("unmeasured");
  });

  it("ranks stale above unmeasured", () => {
    expect(worstStandingGrade({ grades: ["unmeasured", "stale"] })).toBe("stale");
  });

  it("returns current when every tree is current", () => {
    expect(worstStandingGrade({ grades: ["current", "current"] })).toBe("current");
  });

  it("returns unmeasured for no trees at all — nothing was measured", () => {
    expect(worstStandingGrade({ grades: [] })).toBe("unmeasured");
  });
});

describe("standingSessionFreshness", () => {
  it("folds the two trees onto the worse of their grades — the drifted loop, exactly", () => {
    const folded = standingSessionFreshness({
      session: "loop",
      trees: [
        gradeStandingTree({ reading: reading({ behind: 1, changedPaths: ["docs/x.md"] }), role: "bin" }),
        gradeStandingTree({
          reading: reading({ behind: 63, changedPaths: ["skills/loop/SKILL.md"] }),
          role: "plugin-dir",
        }),
      ],
    });

    expect(folded.grade).toBe("stale");
    expect(folded.trees[0]?.grade).toBe("behind");
    expect(folded.trees[1]?.grade).toBe("stale");
  });
});

describe("standingTreeLine", () => {
  it("names the head and path for a current tree", () => {
    const line = standingTreeLine({
      tree: gradeStandingTree({ reading: reading({ head: "e12a8c35" }), role: "bin" }),
    });

    expect(line).toBe("  bin: current — e12a8c35 at /repo/tree");
  });

  it("says a behind tree changed nothing it runs", () => {
    const line = standingTreeLine({
      tree: gradeStandingTree({ reading: reading({ behind: 2, changedPaths: ["docs/x.md"] }), role: "bin" }),
    });

    expect(line).toBe("  bin: behind — abc1234, 2 behind origin/main, none of it under a path this session runs");
  });

  it("caps the paths it lists and counts the rest", () => {
    const line = standingTreeLine({
      tree: gradeStandingTree({
        reading: reading({
          behind: 74,
          changedPaths: [
            "src/live/a.ts",
            "src/live/b.ts",
            "src/live/c.ts",
            "src/live/d.ts",
            "src/live/e.ts",
            "src/live/f.ts",
          ],
        }),
        role: "bin",
      }),
    });

    expect(line).toBe(
      "  bin: STALE — abc1234, 74 behind origin/main, touching src/live/a.ts, src/live/b.ts, src/live/c.ts, src/live/d.ts +2 more",
    );
  });

  it("tells a reader an unmeasured tree is not a clean bill", () => {
    const line = standingTreeLine({
      tree: gradeStandingTree({ reading: reading({ behind: undefined, head: undefined }), role: "plugin-dir" }),
    });

    expect(line).toBe(
      "  plugin-dir: UNMEASURED — /repo/tree (HEAD unreadable); treat as possibly stale, not as current",
    );
  });
});

describe("standingSessionLines", () => {
  it("leads with the grade, then one line per tree", () => {
    const lines = standingSessionLines({
      freshness: standingSessionFreshness({
        session: "scheduler",
        trees: [gradeStandingTree({ reading: reading({ head: "3bdc67d8" }), role: "bin" })],
      }),
    });

    expect(lines).toEqual(["scheduler freshness: CURRENT", "  bin: current — 3bdc67d8 at /repo/tree"]);
  });
});

describe("standingGradeIsAlerting", () => {
  it.each<[StandingFreshnessGrade, boolean]>([
    ["stale", true],
    ["behind", false],
    ["current", false],
    ["unmeasured", false],
  ])("grades %s as alerting=%s", (grade, alerting) => {
    expect(standingGradeIsAlerting({ grade })).toBe(alerting);
  });
});

describe("STANDING_SENSITIVE_PATHS", () => {
  it("covers every area the drift actually touched", () => {
    expect([...STANDING_SENSITIVE_PATHS]).toEqual([
      "skills/loop",
      "skills/loop-bot",
      "skills/recipe-scheduler",
      "src/cli/commands/listen",
      "src/cli/commands/automation",
      "src/cli/commands/turn",
      "src/live",
      "src/outbound",
    ]);
  });
});
