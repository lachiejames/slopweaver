/** The pre-spawn credential gate: a refusal leaves nothing behind, and a routed store reaches the boot line. */
import { describe, expect, it } from "vitest";

import { bootCmuxWorkspace, type SpawnDeps } from "../../../../cmux/spawn.js";
import { err, ok, unwrapErr } from "../../../../lib/result.js";
import { fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("the pre-spawn credential gate", () => {
  it("refuses before any worktree or workspace exists, so a refusal leaves nothing behind", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: passing, ensureWorktreeCalls } = deps({ client });
    const refusing: SpawnDeps = {
      ...passing,
      gateCredentialStore: () => Promise.resolve(err("claude routing: NO plan can take an all-models spawn")),
    };

    const outcome = await bootCmuxWorkspace({ deps: refusing, plan: { ...PLAN, worktreeExists: false } });

    expect(unwrapErr(outcome).reason).toBe("claude routing: NO plan can take an all-models spawn");
    expect(unwrapErr(outcome).workspaceRef).toBe("");
    expect(ensureWorktreeCalls.length).toBe(0);
    expect(calls.filter((call) => call.op === "createWorkspace").length).toBe(0);
  });

  it("boots against the store the gate chose, as a CLAUDE_SECURESTORAGE_CONFIG_DIR prefix on the boot line", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: passing } = deps({ client });
    const routing: SpawnDeps = {
      ...passing,
      gateCredentialStore: ({ plan }) => Promise.resolve(ok({ ...plan, credentialStoreDir: "/stores/plan-three" })),
    };

    await bootCmuxWorkspace({ deps: routing, plan: PLAN });

    const bootSend = calls.find((call) => call.op === "sendLine");
    expect(bootSend!.text).toBe(
      "NX_DAEMON=false CLAUDE_SECURESTORAGE_CONFIG_DIR=/stores/plan-three claude --plugin-dir /repo/slopweaver",
    );
  });
});
