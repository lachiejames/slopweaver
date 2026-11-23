/** {@link spawnCmuxSession}'s post-send witness: bounded, unreadable-tolerant, and unwitnessed rather than failed. */
import { describe, expect, it } from "vitest";

import { MAX_CLAUDE_LIMIT_POLLS, MAX_READY_PROMPT_POLLS } from "../../../../cmux/pickupDelivery.js";
import { MAX_RESUBMIT_VERIFY_POLLS, MAX_SEND_VERIFY_POLLS } from "../../../../cmux/pickupWitnessWindow.js";
import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { ok, unwrap } from "../../../../lib/result.js";
import { CREATED, fakeClient, UNREADABLE } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  it("reports an UNWITNESSED delivery, not a failure, when boot renders but nothing sees the pickup arrive", async () => {
    // The reversal: the screen changed (boot verified) and the pickup was sent, and nothing saw
    // it. That is not proof the paste was dropped — a prompt QUEUED in the child's input is invisible to
    // every witness here — so the spawn succeeds and SAYS the delivery is unwitnessed.
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "unwitnessed" });
    const sends = calls.filter((call) => call.op === "sendLine");
    // The boot line, then the pickup line ONCE. A second send is the duplicate pickup that re-ran a worker's
    // whole packet on two measured dispatches; the answer to a failed witness is never another send.
    expect(sends.length).toBe(2);
  });

  it("polls a bounded number of times before giving up on confirming the pickup command landed", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    // The before read, the single boot-poll tick that verified boot, the full readiness bound (this screen
    // never renders a prompt), the ONE send's full witness budget, the whole re-submit budget after the
    // composer is submitted again, then the claude limit-banner poll — not one more, not fewer.
    expect(calls.filter((call) => call.op === "readScreen").length).toBe(
      2 + MAX_READY_PROMPT_POLLS + MAX_SEND_VERIFY_POLLS + MAX_RESUBMIT_VERIFY_POLLS + MAX_CLAUDE_LIMIT_POLLS,
    );
  });

  it("treats a read-screen failure during the post-send verify poll as unwitnessed, never as a crash", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…", UNREADABLE] });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "unwitnessed" });
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
  });

  it("still confirms the pickup landed after MORE consecutive unreadable-screen ticks than the old 5-tick bound allowed", async () => {
    // Measured live on a gold-proof dispatch: a real pickup landed and the child
    // progressed to a genuine `slot-started` lifecycle event, but every one of the 5 ticks the old bound
    // allowed hit `Failed to read terminal text` under concurrent cmux load, so `deliverPickupCommand`
    // reported `dispatch-failed` for a pickup that had, in fact, landed. Six UNREADABLEs — one more than the old
    // bound — proves the widened budget (matched to `MAX_BOOT_POLLS`) actually outlasts that transient state.
    const { client } = fakeClient({
      screens: [
        "$ ",
        "Claude Code v2.1.231 booting…",
        UNREADABLE,
        UNREADABLE,
        UNREADABLE,
        UNREADABLE,
        UNREADABLE,
        UNREADABLE,
        `Claude Code v2.1.231 booting…\n> ${PLAN.pickupCommand}`,
      ],
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
  });
});
