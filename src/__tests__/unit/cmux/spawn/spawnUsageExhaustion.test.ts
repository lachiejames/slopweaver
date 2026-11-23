/** {@link spawnCmuxSession} fails a seat that booted but renders a usage-exhaustion banner after its pickup. */
import { describe, expect, it } from "vitest";

import { MAX_CLAUDE_LIMIT_POLLS, MAX_CODEX_QUOTA_POLLS } from "../../../../cmux/pickupDelivery.js";
import type { SpawnPlan } from "../../../../cmux/plan.js";
import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { err, ok, unwrapErr } from "../../../../lib/result.js";
import { CREATED, fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  describe("codex usage-exhaustion detection", () => {
    const CODEX_PLAN: SpawnPlan = { ...PLAN, host: "codex" };
    const BOOTED = "OpenAI Codex (v0.145.0) starting…";
    const PICKUP_LANDED = `${BOOTED}\n> ${CODEX_PLAN.pickupCommand}`;

    it("reports the exhaustion kind, not success, when a credits-out banner appears right after pickup lands", async () => {
      const exhausted =
        `${PICKUP_LANDED}\nERROR: Your workspace is out of credits. Ask your workspace owner to refill in ` +
        "order to continue.";
      const { client } = fakeClient({ screens: ["$ ", BOOTED, PICKUP_LANDED, exhausted] });
      const { deps: spawnDeps } = deps({ client });

      const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: CODEX_PLAN });

      expect(outcome).toEqual(
        err({
          quotaKind: "credits-out",
          reason:
            "codex rendered a usage-exhaustion banner (credits-out) right after receiving its pickup command " +
            "— it booted but cannot respond",
          surfaceRef: "surface:1",
          workspaceId: "id-workspace-1",
          workspaceRef: "workspace:1",
        }),
      );
    });

    it("reports window-limit when the 0%-left banner appears right after pickup lands", async () => {
      const exhausted = `${PICKUP_LANDED}\nWeekly limit: [░░░░░░░░░░░░░░░░░░░░] 0% left`;
      const { client } = fakeClient({ screens: ["$ ", BOOTED, PICKUP_LANDED, exhausted] });
      const { deps: spawnDeps } = deps({ client });

      const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: CODEX_PLAN });

      expect(outcome).toEqual(
        err({
          quotaKind: "window-limit",
          reason:
            "codex rendered a usage-exhaustion banner (window-limit) right after receiving its pickup command " +
            "— it booted but cannot respond",
          surfaceRef: "surface:1",
          workspaceId: "id-workspace-1",
          workspaceRef: "workspace:1",
        }),
      );
    });

    it("reports a plain success, with no quotaKind, for a healthy codex spawn showing spare weekly capacity", async () => {
      const healthy = `${PICKUP_LANDED}\nWeekly limit: [██████████░░░░░░░░░░] 45% left`;
      const { client } = fakeClient({ screens: ["$ ", BOOTED, PICKUP_LANDED, healthy] });
      const { deps: spawnDeps } = deps({ client });

      const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: CODEX_PLAN });

      expect(outcome).toEqual(
        ok({
          bootWitness: { by: "screen", confirmed: true },
          delivery: { kind: "witnessed", witness: { by: "screen", confirmed: true } },
          pickupCommand: CODEX_PLAN.pickupCommand,
          ...CREATED,
        }),
      );
    });

    it("polls a bounded number of times before concluding a healthy codex spawn is not exhausted", async () => {
      const healthy = `${PICKUP_LANDED}\nWeekly limit: [██████████░░░░░░░░░░] 45% left`;
      const { calls, client } = fakeClient({ screens: ["$ ", BOOTED, PICKUP_LANDED, healthy] });
      const { deps: spawnDeps } = deps({ client });

      await spawnCmuxSession({ deps: spawnDeps, plan: CODEX_PLAN });

      // before + one boot-poll tick + one send-verify tick + exactly MAX_CODEX_QUOTA_POLLS exhaustion-poll
      // reads — not one more, not fewer.
      expect(calls.filter((call) => call.op === "readScreen").length).toBe(3 + MAX_CODEX_QUOTA_POLLS);
    });

    it("runs the claude limit poll, never the codex exhaustion poll, for a claude spawn", async () => {
      const { calls, client } = fakeClient({
        screens: ["$ ", "Claude Code v2.1.231 booting…", `Claude Code v2.1.231 booting…\n❯ ${PLAN.pickupCommand}`],
      });
      const { deps: spawnDeps } = deps({ client });

      const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

      expect(outcome).toEqual(
        ok({
          bootWitness: { by: "screen", confirmed: true },
          delivery: { kind: "witnessed", witness: { by: "screen", confirmed: true } },
          pickupCommand: PLAN.pickupCommand,
          ...CREATED,
        }),
      );
      // before + boot tick + readiness tick + send-verify tick + exactly MAX_CLAUDE_LIMIT_POLLS of the
      // claude-only banner poll. The two hosts each pay for their own poll and never for the other's.
      expect(calls.filter((call) => call.op === "readScreen").length).toBe(4 + MAX_CLAUDE_LIMIT_POLLS);
    });

    it("fails a claude spawn whose surface renders a usage-limit retry banner right after the pickup lands", async () => {
      const stranded = `❯ ${PLAN.pickupCommand}\n✻ Weekly limit reached · Retrying in 5h (Sep 13 at 8am) · attempt 1/300`;
      const { client } = fakeClient({
        screens: [
          "$ ",
          "Claude Code v2.1.231 booting…",
          `Claude Code v2.1.231 booting…\n❯ ${PLAN.pickupCommand}`,
          stranded,
        ],
      });
      const { deps: spawnDeps } = deps({ client });

      const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

      expect(unwrapErr(outcome).reason).toBe(
        "claude rendered a usage-limit retry banner right after receiving its pickup command — it booted but " +
          "cannot respond: ✻ Weekly limit reached · Retrying in 5h (Sep 13 at 8am) · attempt 1/300",
      );
      expect(unwrapErr(outcome).workspaceRef).toBe(CREATED.workspaceRef);
    });
  });
});
