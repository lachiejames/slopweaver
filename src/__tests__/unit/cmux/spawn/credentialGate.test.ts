/** The pre-spawn credential gate: a refusal leaves nothing behind, and a routed store reaches the boot line. */
import { describe, expect, it } from "vitest";

import { bootCmuxWorkspace, type SpawnDeps } from "../../../../cmux/spawn.js";
import { withClaudeChoice } from "../../../../cmux/spawnDeps.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { SessionPlanChoice } from "../../../../sessions/planChoice.js";
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

  it("hands the gate's plan choice back on the opened workspace, for the ledger writer to record", async () => {
    const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: passing } = deps({ client });
    const routing: SpawnDeps = {
      ...passing,
      gateCredentialStore: ({ plan }) =>
        Promise.resolve(ok({ ...plan, credentialStoreDir: "/stores/plan-three", planChoice: CHOICE })),
    };

    const outcome = await bootCmuxWorkspace({ deps: routing, plan: PLAN });

    expect(unwrap(outcome).planChoice).toStrictEqual(CHOICE);
  });
});

/** What a Claude credential gate concluded, as `routedClaudeChoice` would build it. */
const CHOICE: SessionPlanChoice = {
  alias: "plan-three",
  basis: "routed",
  kind: "named",
  alternative: "--plan <alias>",
  readings: [{ alias: "plan-three", reading: "all-models week 30%", state: "chosen" }],
  reason: "ranked first of 1 eligible plan(s) for a all-models spawn",
  vendor: "claude",
};

describe("withClaudeChoice", () => {
  it("puts the gate's choice on a Claude seat's plan", () => {
    expect(withClaudeChoice({ choice: CHOICE, plan: PLAN }).planChoice).toStrictEqual(CHOICE);
  });

  it("never replaces a Codex seat's own route choice with a Claude routing pass", () => {
    const codexChoice: SessionPlanChoice = { ...CHOICE, alias: "plan-six", vendor: "codex" };
    const codexPlan = { ...PLAN, host: "codex" as const, planChoice: codexChoice };
    expect(withClaudeChoice({ choice: CHOICE, plan: codexPlan }).planChoice).toStrictEqual(codexChoice);
  });

  it("leaves the plan as it was when the gate recorded nothing", () => {
    expect(withClaudeChoice({ choice: undefined, plan: PLAN })).toStrictEqual(PLAN);
  });
});
