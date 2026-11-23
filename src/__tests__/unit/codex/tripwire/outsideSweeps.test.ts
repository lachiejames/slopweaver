/*
 * `outsideSweeps` — which absolute paths a pass's commands named outside both its repository and its workspace.
 * It moved here when `tripwire.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { outsideSweeps } from "../../../../codex/tripwire.js";

describe("outsideSweeps", () => {
  it("ignores paths inside the repo and inside the workspace", () => {
    const sweeps = outsideSweeps({
      commands: ["cat /repo/src/a.ts", "ls /scratch/out", "grep x /repo/docs"],
      repoRoot: "/repo",
      workspaceRoot: "/scratch",
    });

    expect(sweeps).toEqual([]);
  });

  /** Every shell line mentions these. Counting them would make the signal fire on ordinary work. */
  it("ignores the tool paths every command carries", () => {
    const sweeps = outsideSweeps({
      commands: ["/bin/zsh -lc 'cat /repo/a'", "/usr/bin/env node", "cat /repo/b 2>/dev/null"],
      repoRoot: "/repo",
      workspaceRoot: "/scratch",
    });

    expect(sweeps).toEqual([]);
  });

  it("reports one path per offending command, deduplicated", () => {
    const sweeps = outsideSweeps({
      commands: ["find /elsewhere -name x", "find /elsewhere -name y", "ls /other"],
      repoRoot: "/repo",
      workspaceRoot: "/scratch",
    });

    expect(sweeps).toEqual(["/elsewhere", "/other"]);
  });
});
