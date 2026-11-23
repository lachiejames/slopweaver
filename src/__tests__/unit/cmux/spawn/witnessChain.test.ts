/** The witness chain: which signal vouches for a boot and for a pickup when the screen alone cannot. */
import { describe, expect, it } from "vitest";

import type { CmuxClient } from "../../../../cmux/client.js";
import { CmuxErrors } from "../../../../cmux/errors.js";
import type { CmuxEvent } from "../../../../cmux/events.js";
import { bootCmuxWorkspace, type SpawnDeps, spawnCmuxSession } from "../../../../cmux/spawn.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { CREATED, fakeClient, RETRIED, UNREADABLE } from "./fakeClient.js";
import { bootLinesOnly, deps, PLAN } from "./harness.js";

/** One `agent.hook.*` event for the fake workspace, as the witness chain would see it on the stream. */
function event({ name, workspaceId = CREATED.workspaceId }: { name: string; workspaceId?: string }): CmuxEvent {
  return {
    agentSource: undefined,
    category: "agent",
    cwd: undefined,
    id: `${name}-1`,
    name,
    occurredAtIso: "2026-08-23T00:00:00.000Z",
    phase: "received",
    seq: 1,
    sessionId: undefined,
    surfaceId: undefined,
    toolName: undefined,
    workspaceId,
  };
}

/** The refusal a `claude` boot nothing ever witnessed ends in, once its one retry failed the same way. */
const NEVER_BOOTED_TWICE =
  "claude failed to boot twice — workspace:1: the surface never read, and nothing else vouched for the boot, and it was closed; then workspace:1: the surface never read, and nothing else vouched for the boot, and it was closed — so no seat stands for this spawn; run the same command again once the machine has headroom";

describe("the witness chain", () => {
  it("confirms boot from a SessionStart event even while the screen is completely unreadable", async () => {
    const { client } = fakeClient({ screens: [UNREADABLE] });
    const { deps: spawnDeps } = deps({ client, events: [event({ name: "agent.hook.SessionStart" })] });

    const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

    expect(boot.isOk()).toBe(true);
    expect(unwrap(boot).bootWitness).toEqual({ by: "event", confirmed: true });
  });

  it("ignores a SessionStart event belonging to a DIFFERENT workspace", async () => {
    const { client } = fakeClient({ screens: [UNREADABLE] });
    const { deps: spawnDeps } = deps({
      client,
      events: [event({ name: "agent.hook.SessionStart", workspaceId: "id-someone-else" })],
    });

    const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

    expect(unwrapErr(boot).reason).toBe(NEVER_BOOTED_TWICE);
  });

  it("never treats the echoed boot line alone as a boot witness", async () => {
    // The shell echoes whatever it was given, so a workspace where `claude` failed to launch shows the boot
    // line on its surface exactly like one where it succeeded.
    const { client } = fakeClient({ screens: ["$ ", `$ claude --plugin-dir /repo/slopweaver`] });
    const { deps: spawnDeps } = deps({ client });

    const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

    expect(unwrapErr(boot).reason).toBe(NEVER_BOOTED_TWICE);
  });

  it("refuses a codex boot nothing witnessed on the boot witness alone — one tab, no composer read, no retry", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "$ "] });
    const witnessed: boolean[] = [];
    const { deps: spawnDeps } = deps({
      client,
      witnessClaudeBoot: ({ bootWitnessed }) => {
        witnessed.push(bootWitnessed);
        return Promise.resolve({ kind: "unwitnessed" });
      },
    });

    const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: { ...PLAN, host: "codex" } });

    expect(unwrapErr(boot).reason).toBe(
      "boot produced no positive signal — no session-start event, and no booted prompt on the surface",
    );
    expect(witnessed).toEqual([]);
    expect(calls.filter((call) => call.op === "createWorkspace").length).toBe(1);
    expect(calls.filter((call) => call.op === "closeWorkspace")).toEqual([]);
  });

  describe("a claude boot judged on its composer", () => {
    const READ_NO_COMPOSER: SpawnDeps["witnessClaudeBoot"] = () =>
      Promise.resolve({ kind: "failed", reason: "readable-without-composer" });

    it("boots on a composer read alone, naming the composer as its witness, in one tab that is never closed", async () => {
      const { calls, client } = fakeClient({ screens: ["$ ", "$ "] });
      const { deps: spawnDeps } = deps({
        client,
        witnessClaudeBoot: () => Promise.resolve({ kind: "composer", reading: { kind: "empty" } }),
      });

      const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

      expect(unwrap(boot)).toEqual({ ...CREATED, bootWitness: { by: "composer", confirmed: true } });
      expect(calls.filter((call) => call.op === "createWorkspace").length).toBe(1);
      expect(calls.filter((call) => call.op === "closeWorkspace")).toEqual([]);
    });

    it("keeps the boot witness that fired when every grid read failed and the decision is unwitnessed", async () => {
      const { client } = fakeClient({ screens: [UNREADABLE] });
      const { deps: spawnDeps } = deps({ client, events: [event({ name: "agent.hook.SessionStart" })] });

      const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

      expect(unwrap(boot)).toEqual({ ...CREATED, bootWitness: { by: "event", confirmed: true } });
    });

    it("boots on a SessionStart that landed after the last boot poll, never closing a tab no grid read reached", async () => {
      const { calls, client } = fakeClient({ screens: [UNREADABLE] });
      const events: CmuxEvent[] = [];
      const { deps: spawnDeps } = deps({
        client,
        events,
        witnessClaudeBoot: () => {
          events.push(event({ name: "agent.hook.SessionStart" }));
          return Promise.resolve({ kind: "failed", reason: "never-read" });
        },
      });

      const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

      expect(unwrap(boot)).toEqual({ ...CREATED, bootWitness: { by: "event", confirmed: true } });
      expect(calls.filter((call) => call.op === "closeWorkspace")).toEqual([]);
    });

    it("boots on a retained SessionStart whose received frame the capped buffer already evicted", async () => {
      const { calls, client } = fakeClient({ screens: [UNREADABLE] });
      const completedOnly: CmuxEvent = { ...event({ name: "agent.hook.SessionStart" }), phase: "completed" };
      const { deps: spawnDeps } = deps({
        client,
        events: [completedOnly],
        witnessClaudeBoot: () => Promise.resolve({ kind: "failed", reason: "never-read" }),
      });

      const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

      expect(unwrap(boot)).toEqual({ ...CREATED, bootWitness: { by: "event", confirmed: true } });
      expect(calls.filter((call) => call.op === "closeWorkspace")).toEqual([]);
    });

    it("force-closes a tab that read with no composer and boots once more in a fresh tab, answering only the second", async () => {
      const { calls, client } = fakeClient({ creates: [CREATED, RETRIED], screens: ["$ ", "$ "] });
      const decisions: SpawnDeps["witnessClaudeBoot"][] = [
        READ_NO_COMPOSER,
        () => Promise.resolve({ kind: "composer", reading: { kind: "empty" } }),
      ];
      let attempt = 0;
      const { deps: spawnDeps } = deps({
        client,
        witnessClaudeBoot: (input) => {
          attempt += 1;
          return decisions[attempt - 1]!(input);
        },
      });

      const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

      expect(unwrap(boot)).toEqual({ ...RETRIED, bootWitness: { by: "composer", confirmed: true } });
      expect(calls.filter((call) => call.op === "closeWorkspace")).toEqual([
        { force: true, op: "closeWorkspace", workspaceId: CREATED.workspaceId },
      ]);
      expect(calls.filter((call) => call.op === "createWorkspace").length).toBe(2);
    });

    it("closes BOTH tabs when the retry fails too, names both, and never types a pickup", async () => {
      const { calls, client } = fakeClient({ creates: [CREATED, RETRIED], screens: ["$ ", "$ "] });
      const { deps: spawnDeps } = deps({ client, witnessClaudeBoot: READ_NO_COMPOSER });

      const boot = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

      expect(unwrapErr(boot)).toEqual({
        reason:
          "claude failed to boot twice — workspace:1: the surface read, and no Claude composer was on it, and it was closed; then workspace:2: the surface read, and no Claude composer was on it, and it was closed — so no seat stands for this spawn; run the same command again once the machine has headroom",
        surfaceRef: "",
        workspaceRef: "",
      });
      expect(calls.filter((call) => call.op === "closeWorkspace").map((call) => call.workspaceId)).toEqual([
        CREATED.workspaceId,
        RETRIED.workspaceId,
      ]);
      expect(bootLinesOnly({ calls })).toEqual({ bootLines: 2, pickups: 0 });
    });

    it("opens no second tab beside a failed one that will not close, refusing with that tab's refs", async () => {
      const { calls, client } = fakeClient({ closeFails: true, creates: [CREATED, RETRIED], screens: ["$ ", "$ "] });
      const { deps: spawnDeps } = deps({ client, witnessClaudeBoot: READ_NO_COMPOSER });

      const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

      expect(unwrapErr(boot)).toEqual({
        reason:
          "workspace:1: the surface read, and no Claude composer was on it, and it could NOT be closed (cmux workspace.close failed (busy): tab held) — close it by hand; no second boot was tried beside it",
        surfaceRef: CREATED.surfaceRef,
        workspaceId: CREATED.workspaceId,
        workspaceRef: CREATED.workspaceRef,
      });
      expect(calls.filter((call) => call.op === "createWorkspace").length).toBe(1);
    });

    it("keeps the second tab's refs when the retry's tab is the one that will not close", async () => {
      const { client } = fakeClient({ creates: [CREATED, RETRIED], screens: ["$ ", "$ "] });
      let closes = 0;
      const closingOnce: CmuxClient = {
        ...client,
        closeWorkspace: (input) => {
          closes += 1;
          return closes === 1
            ? client.closeWorkspace(input)
            : Promise.resolve(
                err(CmuxErrors.callFailed({ cmuxCode: "busy", message: "tab held", method: "workspace.close" })),
              );
        },
      };
      const { deps: spawnDeps } = deps({ client: closingOnce, witnessClaudeBoot: READ_NO_COMPOSER });

      const boot = await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

      expect(unwrapErr(boot)).toEqual({
        reason:
          "workspace:1: the surface read, and no Claude composer was on it, and it was closed; then workspace:2: the surface read, and no Claude composer was on it, and it could NOT be closed (cmux workspace.close failed (busy): tab held) — close it by hand",
        surfaceRef: RETRIED.surfaceRef,
        workspaceId: RETRIED.workspaceId,
        workspaceRef: RETRIED.workspaceRef,
      });
    });

    it("routes the credential once and creates a missing worktree once across both attempts", async () => {
      const { client } = fakeClient({ creates: [CREATED, RETRIED], screens: ["$ ", "$ "] });
      const { deps: base, ensureWorktreeCalls } = deps({ client, witnessClaudeBoot: READ_NO_COMPOSER });
      let gated = 0;
      const counting: SpawnDeps = {
        ...base,
        gateCredentialStore: ({ plan }) => {
          gated += 1;
          return Promise.resolve(ok(plan));
        },
      };

      await bootCmuxWorkspace({ deps: counting, plan: { ...PLAN, worktreeExists: false } });

      expect({ gated, worktrees: ensureWorktreeCalls.length }).toEqual({ gated: 1, worktrees: 1 });
    });
  });

  it("confirms the pickup from a prompt-submit event while every screen read is unreadable", async () => {
    const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…", UNREADABLE] });
    const { deps: spawnDeps } = deps({
      client,
      events: [event({ name: "agent.hook.SessionStart" }), event({ name: "agent.hook.UserPromptSubmit" })],
    });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(outcome.isOk()).toBe(true);
    expect(unwrap(outcome).delivery).toEqual({ kind: "witnessed", witness: { by: "event", confirmed: true } });
  });

  it("confirms the pickup from cmux's own delivery record when no event arrived and the screen is unreadable", async () => {
    const { client } = fakeClient({
      screens: ["$ ", "Claude Code v2.1.231 booting…", UNREADABLE],
      // cmux truncates a long `latest_submitted_message` at 240 characters with an ellipsis, so the witness
      // compares a PREFIX — and declines a prefix shorter than 40 characters, which is why this one is long.
      submitted: `${PLAN.pickupCommand.slice(0, 60)}…`,
    });
    const { deps: spawnDeps } = deps({ client, events: [event({ name: "agent.hook.SessionStart" })] });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(outcome.isOk()).toBe(true);
    expect(unwrap(outcome).delivery).toEqual({
      kind: "witnessed",
      witness: { by: "submitted-message", confirmed: true },
    });
  });

  it("does not accept a delivery record naming DIFFERENT text as a witness for this pickup", async () => {
    const { client } = fakeClient({
      screens: ["$ ", "Claude Code v2.1.231 booting…", UNREADABLE],
      submitted: "something else entirely",
    });
    const { deps: spawnDeps } = deps({ client, events: [event({ name: "agent.hook.SessionStart" })] });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "unwitnessed" });
  });

  it("paints the row its ROLE colour, and clears it when the role wears none", async () => {
    const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps, sidebarCalls } = deps({ client });

    await bootCmuxWorkspace({ deps: spawnDeps, plan: { ...PLAN, role: "bot" } });

    expect(sidebarCalls[2]).toEqual([
      "workspace-action",
      "--action",
      "set-color",
      "--color",
      "Green",
      "--workspace",
      CREATED.workspaceId,
    ]);
  });
});
