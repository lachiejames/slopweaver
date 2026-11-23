/** {@link spawnCmuxSession} never re-types a pickup: once the witness budget is spent it submits the composer once. */
import { describe, expect, it } from "vitest";

import { MAX_CLAUDE_LIMIT_POLLS } from "../../../../cmux/pickupDelivery.js";
import { MAX_SEND_VERIFY_POLLS } from "../../../../cmux/pickupWitnessWindow.js";
import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { unwrap } from "../../../../lib/result.js";
import { fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  it("NEVER re-types the pickup line, even when a whole witness budget passes with nothing seen", async () => {
    // The reversal, measured on two live dispatches: the re-send this test used to demand is
    // itself the damage. Both sends land, neither is witnessed, and the second copy sits QUEUED in the
    // child's input until its first turn ends — one measured child ran its pickup three times that way.
    // The screens here are the exact shape that used to trigger a re-send: an empty prompt for every tick of
    // both budgets. The one send must still be the only send.
    const screens = ["$ ", "Claude Code v2.1.231 booting…", "❯ "];
    const { calls, client } = fakeClient({ screens });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "unwitnessed" });
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
  });

  it("submits the composer once the witness budget is spent, and reports the delivery as resubmitted", async () => {
    // The strand, in the shape a fake can hold: the line is typed and NEVER submitted, so the
    // whole first budget passes on an idle prompt. The composer is then submitted — no text — and the very
    // next look sees it. Reproduced live before it was written: see `resubmitPickupThenWitness`.
    const screens = [
      "$ ",
      "Claude Code v2.1.231 booting…",
      ...Array<string>(1 + MAX_SEND_VERIFY_POLLS).fill("❯ "),
      `❯ ${PLAN.pickupCommand}`,
    ];
    const { calls, client } = fakeClient({ screens });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({
      kind: "resubmitted",
      witness: { by: "screen", confirmed: true },
    });
    // The line itself was typed exactly once — the boot line, then the pickup, and nothing after.
    expect(calls.filter((call) => call.op === "sendLine").map((call) => call.text)).toEqual([
      `NX_DAEMON=false claude --plugin-dir /repo/slopweaver`,
      PLAN.pickupCommand,
    ]);
  });

  it("submits the composer exactly ONCE, never once per remaining tick", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…", "❯ "] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
  });

  it("never submits the composer at all when the pickup was witnessed inside the first budget", async () => {
    const { calls, client } = fakeClient({
      screens: ["$ ", "Claude Code v2.1.231 booting…", `❯ ${PLAN.pickupCommand}`],
    });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "witnessed", witness: { by: "screen", confirmed: true } });
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(0);
  });

  it("submits the composer only AFTER the whole first budget is spent, never before it", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…", "❯ "] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    const submitAt = calls.findIndex((call) => call.op === "submitComposer");
    const readsBeforeSubmit = calls.slice(0, submitAt).filter((call) => call.op === "readScreen").length;
    // before + one boot tick + one readiness tick (this screen already carries a prompt) + the WHOLE first
    // witness budget, all spent before a single keystroke is sent.
    expect(readsBeforeSubmit).toBe(3 + MAX_SEND_VERIFY_POLLS);
  });

  it("reports unwitnessed, not a failure, when even the submit is refused — and still never re-types", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…", "❯ "], submitFails: true });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "unwitnessed" });
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
    // A refused submit ends the attempt rather than spending the second budget on a keystroke that never went.
    expect(calls.filter((call) => call.op === "readScreen").length).toBe(
      3 + MAX_SEND_VERIFY_POLLS + MAX_CLAUDE_LIMIT_POLLS,
    );
  });
});
