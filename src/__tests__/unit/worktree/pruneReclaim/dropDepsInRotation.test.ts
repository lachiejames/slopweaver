/*
 * The `node_modules` pass over every repository's marked trees: round-robin order, the deadline, the re-check asked
 * once per tree, the pacer's stop and the clause a run reports. Pure, over literal plans and injected seams.
 */
import { describe, expect, it } from "vitest";

import type { PruneVerdict } from "../../../../worktree/pruneClassify.js";
import { type DepsOutcome, depsClause, dropDepsInRotation, renderDepsOutcome } from "../../../../worktree/pruneDeps.js";
import type { Pacer } from "../../../../worktree/prunePacing.js";
import { verdictFor } from "./harness.js";

/** A pacer that never stops a pass and never waits, for every case not about pacing. */
const OPEN_PACE: Pacer = { settle: async () => undefined, stopReason: () => null };

describe("dropDepsInRotation and depsClause", () => {
  const outcome = ({ verdict }: { verdict: PruneVerdict }): DepsOutcome => ({
    branch: verdict.branch,
    declined: null,
    dropped: ["node_modules"],
    path: verdict.path,
  });
  const plans = [
    { repoRoot: "/a", verdicts: [verdictFor({ path: "/a/1" }), verdictFor({ path: "/a/2" })] },
    {
      repoRoot: "/b",
      verdicts: [verdictFor({ path: "/b/1" }), { ...verdictFor({ path: "/b/2" }), dropsDeps: false }],
    },
  ];

  it("strips only marked trees, round-robin across repositories", async () => {
    const seen: string[] = [];
    const pass = await dropDepsInRotation({
      deadlineMs: Number.MAX_SAFE_INTEGER,
      drop: ({ verdict }) => {
        seen.push(verdict.path);
        return outcome({ verdict });
      },
      pace: OPEN_PACE,
      paused: () => null,
      plans,
      print: () => undefined,
      stillCold: async () => true,
    });

    expect(seen).toEqual(["/a/1", "/b/1", "/a/2"]);
    expect(pass.stripped).toBe(3);
    expect(depsClause({ deps: pass })).toBe(" and dropped node_modules from 3 kept worktree(s)");
  });

  it("starts nothing past the deadline and says what it still owes", async () => {
    const pass = await dropDepsInRotation({
      deadlineMs: 0,
      drop: outcome,
      pace: OPEN_PACE,
      paused: () => null,
      plans,
      print: () => undefined,
      stillCold: async () => true,
    });

    expect(pass.stripped).toBe(0);
    expect(depsClause({ deps: pass })).toBe(
      " and dropped node_modules from 0 kept worktree(s) (3 more owed to the next run)",
    );
  });

  it("skips a tree that fails the drop-time re-check, never calling drop on it", async () => {
    const seen: string[] = [];
    const lines: string[] = [];
    const pass = await dropDepsInRotation({
      deadlineMs: Number.MAX_SAFE_INTEGER,
      drop: ({ verdict }) => {
        seen.push(verdict.path);
        return outcome({ verdict });
      },
      pace: OPEN_PACE,
      paused: () => null,
      plans,
      print: ({ line }) => lines.push(line),
      stillCold: async ({ verdict }) => verdict.path !== "/b/1",
    });

    expect(seen).toEqual(["/a/1", "/a/2"]);
    expect(pass.stripped).toBe(2);
    expect(lines[1]).toBe("  kept — no node_modules to drop (declined: taken or touched since the scan)\n    /b/1");
  });

  it("asks the re-check once per tree, immediately before that tree's drop — never one snapshot for the pass", async () => {
    const steps: string[] = [];
    await dropDepsInRotation({
      deadlineMs: Number.MAX_SAFE_INTEGER,
      drop: ({ verdict }) => {
        steps.push(`drop ${verdict.path}`);
        return outcome({ verdict });
      },
      pace: {
        settle: async () => {
          steps.push("settle");
        },
        stopReason: () => null,
      },
      paused: () => null,
      plans,
      print: () => undefined,
      stillCold: async ({ verdict }) => {
        steps.push(`check ${verdict.path}`);
        return true;
      },
    });

    expect(steps).toEqual([
      "check /a/1",
      "drop /a/1",
      "settle",
      "check /b/1",
      "drop /b/1",
      "settle",
      "check /a/2",
      "drop /a/2",
    ]);
  });

  it("stops before the next tree once the pacer says so, and owes the rest to the next run", async () => {
    const seen: string[] = [];
    const lines: string[] = [];
    const pass = await dropDepsInRotation({
      deadlineMs: Number.MAX_SAFE_INTEGER,
      drop: ({ verdict }) => {
        seen.push(verdict.path);
        return outcome({ verdict });
      },
      pace: {
        settle: async () => undefined,
        stopReason: ({ done }) => (done >= 1 ? "the 1-minute load is 119.8, at or above the 22 hold" : null),
      },
      paused: () => null,
      plans,
      print: ({ line }) => lines.push(line),
      stillCold: async () => true,
    });

    expect(seen).toEqual(["/a/1"]);
    expect(lines[1]).toBe("  node_modules pass paused: the 1-minute load is 119.8, at or above the 22 hold");
    expect(depsClause({ deps: pass })).toBe(
      " and dropped node_modules from 1 kept worktree(s) (2 more owed to the next run)",
    );
  });

  it("counts a drop that freed nothing against the cap, and waits after it", async () => {
    const steps: string[] = [];
    const pass = await dropDepsInRotation({
      deadlineMs: Number.MAX_SAFE_INTEGER,
      drop: ({ verdict }) => {
        steps.push(`drop ${verdict.path}`);
        return { branch: verdict.branch, declined: "node_modules: timed out", dropped: [], path: verdict.path };
      },
      pace: {
        settle: async () => {
          steps.push("settle");
        },
        stopReason: ({ done }) => (done >= 2 ? "acted on 2 tree(s), this run's cap" : null),
      },
      paused: () => null,
      plans,
      print: () => undefined,
      stillCold: async () => true,
    });

    expect(steps).toEqual(["drop /a/1", "settle", "drop /b/1", "settle"]);
    expect(pass.stripped).toBe(0);
    expect(pass.remaining).toHaveLength(1);
  });

  it("never spends the cap, or a wait, on a tree an earlier run already stripped", async () => {
    const steps: string[] = [];
    const pass = await dropDepsInRotation({
      deadlineMs: Number.MAX_SAFE_INTEGER,
      drop: ({ verdict }) => {
        steps.push(`drop ${verdict.path}`);
        if (verdict.path === "/a/2") {
          return outcome({ verdict });
        }
        return { branch: verdict.branch, declined: null, dropped: [], path: verdict.path };
      },
      pace: {
        settle: async () => {
          steps.push("settle");
        },
        stopReason: ({ done }) => (done >= 1 ? "acted on 1 tree(s), this run's cap" : null),
      },
      paused: () => null,
      plans,
      print: () => undefined,
      stillCold: async () => true,
    });

    expect(steps).toEqual(["drop /a/1", "drop /b/1", "drop /a/2"]);
    expect(pass.stripped).toBe(1);
    expect(pass.remaining).toHaveLength(0);
  });

  it("says nothing under --merged-only, which skips the pass", () => {
    expect(depsClause({ deps: undefined })).toBe("");
  });

  it("renders a drop with how to restore it", () => {
    expect(renderDepsOutcome({ outcome: outcome({ verdict: verdictFor({ path: "/a/1" }) }) })).toBe(
      "  kept — dropped node_modules — tree kept, `yarn install` restores it\n    /a/1",
    );
  });
});
