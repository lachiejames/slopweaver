/**
 * The tree measurement, driven through its INJECTED git and process seams — plain fake functions, never
 * mocks, so the ordering and the failure handling are both real.
 */
import { describe, expect, it } from "vitest";

import {
  measureStandingFreshness,
  readStandingTree,
  type StandingInspectDeps,
  standingTreeTargets,
  supervisorTreeTargets,
} from "../../../../live/standing/inspect.js";
import type { ProcessRow } from "../../../../live/standing/processes.js";

/** A git seam that answers from a table keyed on the command, and records every call it received. */
function fakeGit({
  answers,
  calls,
}: {
  answers: Readonly<Record<string, string | undefined>>;
  calls: string[];
}): StandingInspectDeps["git"] {
  return ({ args, cwd }) => {
    const key = `${cwd}|${args.join(" ")}`;
    calls.push(key);
    const inThisCheckout = answers[key];
    // An answer keyed on the command alone serves every checkout.
    if (inThisCheckout === undefined) {
      return answers[args.join(" ")];
    }
    return inThisCheckout;
  };
}

/** Deps over a fixed answer table and a fixed process snapshot. */
function deps({
  answers,
  calls = [],
  processes = [],
}: {
  answers: Readonly<Record<string, string | undefined>>;
  calls?: string[];
  processes?: readonly ProcessRow[];
}): StandingInspectDeps {
  return { git: fakeGit({ answers, calls }), processes: () => processes };
}

/** The answers a current tree gives. */
const CURRENT_TREE: Readonly<Record<string, string | undefined>> = {
  "fetch --quiet origin": "",
  "rev-list --count HEAD..origin/main": "0",
  "rev-parse --git-common-dir": "/repo/.git",
  "rev-parse --short HEAD": "fede05d2",
};

describe("readStandingTree", () => {
  it("reads head, behind and the changed paths", () => {
    const problems: string[] = [];
    const reading = readStandingTree({
      deps: deps({
        answers: {
          ...CURRENT_TREE,
          "diff --name-only HEAD...origin/main": "skills/loop/SKILL.md\nsrc/live/a.ts",
          "rev-list --count HEAD..origin/main": "63",
        },
      }),
      fetched: new Set(),
      path: "/wt/x",
      problems,
    });

    expect(reading.head).toBe("fede05d2");
    expect(reading.behind).toBe(63);
    expect(reading.changedPaths).toEqual(["skills/loop/SKILL.md", "src/live/a.ts"]);
    expect(problems).toEqual([]);
  });

  it("skips the diff entirely when nothing is upstream", () => {
    const calls: string[] = [];
    readStandingTree({
      deps: deps({ answers: CURRENT_TREE, calls }),
      fetched: new Set(),
      path: "/wt/x",
      problems: [],
    });

    expect(calls.some((call) => call.includes("diff --name-only"))).toBe(false);
  });

  it("fetches once per repository across several worktrees of it", () => {
    const calls: string[] = [];
    const shared = deps({ answers: CURRENT_TREE, calls });
    const fetched = new Set<string>();
    readStandingTree({ deps: shared, fetched, path: "/wt/a", problems: [] });
    readStandingTree({ deps: shared, fetched, path: "/wt/b", problems: [] });

    expect(calls.filter((call) => call.endsWith("fetch --quiet origin"))).toHaveLength(1);
  });

  it("does NOT share a fetch between two unrelated checkouts that both answer `.git`", () => {
    const calls: string[] = [];
    // Both main checkouts answer `--git-common-dir` relatively, which is what git really does from a
    // non-worktree checkout — the keys must still differ, or the second one measures against stale refs.
    const shared = deps({ answers: { ...CURRENT_TREE, "rev-parse --git-common-dir": ".git" }, calls });
    const fetched = new Set<string>();
    readStandingTree({ deps: shared, fetched, path: "/repo-a", problems: [] });
    readStandingTree({ deps: shared, fetched, path: "/repo-b", problems: [] });

    expect(calls.filter((call) => call.endsWith("fetch --quiet origin"))).toHaveLength(2);
  });

  it("records a failed fetch as a problem and still measures against the refs on disk", () => {
    const problems: string[] = [];
    const reading = readStandingTree({
      deps: deps({ answers: { ...CURRENT_TREE, "fetch --quiet origin": undefined } }),
      fetched: new Set(),
      path: "/wt/x",
      problems,
    });

    expect(reading.behind).toBe(0);
    expect(problems[0]).toContain("could not fetch origin in /wt/x");
  });

  it("reports an unreadable HEAD rather than reporting zero drift", () => {
    const problems: string[] = [];
    const reading = readStandingTree({
      deps: deps({ answers: { ...CURRENT_TREE, "rev-parse --short HEAD": undefined } }),
      fetched: new Set(),
      path: "/wt/x",
      problems,
    });

    expect(reading.behind).toBeUndefined();
    expect(problems[0]).toContain("could not read HEAD in /wt/x");
  });

  it("reports an uncountable drift rather than reporting zero", () => {
    const problems: string[] = [];
    const reading = readStandingTree({
      deps: deps({ answers: { ...CURRENT_TREE, "rev-list --count HEAD..origin/main": undefined } }),
      fetched: new Set(),
      path: "/wt/x",
      problems,
    });

    expect(reading.behind).toBeUndefined();
    expect(problems[0]).toBe("could not count how far /wt/x is behind origin/main");
  });

  it("reports an unlistable diff rather than grading the drift harmless", () => {
    const problems: string[] = [];
    const reading = readStandingTree({
      deps: deps({
        answers: {
          ...CURRENT_TREE,
          "diff --name-only HEAD...origin/main": undefined,
          "rev-list --count HEAD..origin/main": "9",
        },
      }),
      fetched: new Set(),
      path: "/wt/x",
      problems,
    });

    expect(reading.behind).toBeUndefined();
    expect(problems[0]).toBe("could not list what origin/main changed relative to /wt/x");
  });
});

/** The drifted-loop snapshot: a listener on the 28aug tree under a claude session on the 26aug-b tree. */
const SNAPSHOT: readonly ProcessRow[] = [
  { argv: "/claude --session-id sched-1 --plugin-dir /wt/26aug-b --model opus", pid: 42246, ppid: 1 },
  { argv: "/bin/zsh", pid: 61048, ppid: 42246 },
  { argv: "/node /wt/28aug/bin/../src/cli/index.ts listen --follow", pid: 61202, ppid: 61048 },
];

describe("standingTreeTargets", () => {
  it("reports the bin from the pid's own argv and the plugin-dir from its claude ancestor", () => {
    expect(standingTreeTargets({ fallbackBin: undefined, pid: 61202, processes: SNAPSHOT })).toEqual([
      { path: "/wt/28aug", role: "bin" },
      { path: "/wt/26aug-b", role: "plugin-dir" },
    ]);
  });

  it("reports the bin of a listener launched through the BUILT entrypoint", () => {
    const built: readonly ProcessRow[] = [
      ...SNAPSHOT,
      { argv: "/node /wt/23sep-a/bin/../dist-cli/cli/index.js listen --follow", pid: 14752, ppid: 61048 },
    ];
    expect(standingTreeTargets({ fallbackBin: "/wt/recorded", pid: 14752, processes: built })).toEqual([
      { path: "/wt/23sep-a", role: "bin" },
      { path: "/wt/26aug-b", role: "plugin-dir" },
    ]);
  });

  it("falls back to the recorded checkout when the pid's argv names none", () => {
    expect(standingTreeTargets({ fallbackBin: "/wt/recorded", pid: 42246, processes: SNAPSHOT })).toEqual([
      { path: "/wt/recorded", role: "bin" },
      { path: "/wt/26aug-b", role: "plugin-dir" },
    ]);
  });

  it("reports nothing at all when there is no pid and no recorded checkout", () => {
    expect(standingTreeTargets({ fallbackBin: undefined, pid: undefined, processes: SNAPSHOT })).toEqual([]);
  });

  it("reports the recorded bin alone when nothing live can be found", () => {
    expect(standingTreeTargets({ fallbackBin: "/wt/recorded", pid: undefined, processes: SNAPSHOT })).toEqual([
      { path: "/wt/recorded", role: "bin" },
    ]);
  });
});

describe("measureStandingFreshness", () => {
  it("grades a session on the worse of its two trees — the drifted loop, end to end", () => {
    const report = measureStandingFreshness({
      deps: deps({
        answers: {
          ...CURRENT_TREE,
          "/wt/26aug-b|diff --name-only HEAD...origin/main": "skills/loop/SKILL.md",
          "/wt/26aug-b|rev-list --count HEAD..origin/main": "63",
          "/wt/28aug|diff --name-only HEAD...origin/main": "docs/toolchain.md",
          "/wt/28aug|rev-list --count HEAD..origin/main": "1",
        },
      }),
      session: "loop",
      targets: [
        { path: "/wt/28aug", role: "bin" },
        { path: "/wt/26aug-b", role: "plugin-dir" },
      ],
    });

    expect(report.freshness.grade).toBe("stale");
    expect(report.freshness.trees[0]?.grade).toBe("behind");
    expect(report.freshness.trees[1]?.grade).toBe("stale");
    expect(report.freshness.trees[1]?.touched).toEqual(["skills/loop/SKILL.md"]);
    expect(report.problems).toEqual([]);
  });

  it("grades a session with no measurable trees unmeasured", () => {
    const report = measureStandingFreshness({ deps: deps({ answers: {} }), session: "loop", targets: [] });

    expect(report.freshness.grade).toBe("unmeasured");
    expect(report.freshness.trees).toEqual([]);
  });
});

describe("supervisorTreeTargets", () => {
  it("reports the main checkout as bin and the live chat's plugin-dir, in that order", () => {
    expect(supervisorTreeTargets({ binPath: "/dev/slopweaver", pluginDir: "/wt/sup" })).toEqual([
      { path: "/dev/slopweaver", role: "bin" },
      { path: "/wt/sup", role: "plugin-dir" },
    ]);
  });

  it("still measures the main checkout when no supervisor chat is open", () => {
    expect(supervisorTreeTargets({ binPath: "/dev/slopweaver", pluginDir: undefined })).toEqual([
      { path: "/dev/slopweaver", role: "bin" },
    ]);
  });

  it("still measures the open chat when the main checkout did not resolve", () => {
    expect(supervisorTreeTargets({ binPath: undefined, pluginDir: "/wt/sup" })).toEqual([
      { path: "/wt/sup", role: "plugin-dir" },
    ]);
  });

  it("measures nothing when neither resolved", () => {
    expect(supervisorTreeTargets({ binPath: undefined, pluginDir: undefined })).toEqual([]);
  });
});
