/** {@link spawnCmuxSession} creates a worktree only when the plan says none exists yet. */
import { describe, expect, it } from "vitest";

import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  it("creates the worktree first when the plan says none exists yet", async () => {
    const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booted…"] });
    const { deps: spawnDeps, ensureWorktreeCalls } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: { ...PLAN, worktreeExists: false } });

    expect(ensureWorktreeCalls.length).toBe(1);
  });

  it("never creates a worktree when the plan says one already exists", async () => {
    const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booted…"] });
    const { deps: spawnDeps, ensureWorktreeCalls } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(ensureWorktreeCalls.length).toBe(0);
  });
});
