/*
 * The performers themselves, over a schedule handed to them directly. Two arms are unreachable from the whole
 * pass: a ledger write that FAILS after a press that succeeded, and an entry the pass's own cap pushed to the
 * next firing — the run-level harness can neither fail its recorder nor seed four enqueues cheaply.
 */
import { describe, expect, it } from "vitest";

import { performBumpActs } from "../../../../../../cli/commands/github/bumpDriveActs.js";
import { RENOVATE_SEAT_CLAUSE } from "../../../../../../cli/commands/github/bumpDriveCore.js";
import { BUMP_ENQUEUE_CAP } from "../../../../../../cli/commands/github/bumpDriveUsage.js";
import { ok } from "../../../../../../lib/result.js";
import type { BumpPlan } from "../../../../../../review/bumpSelection.js";
import { landingRowFake } from "../../../../../landingRowFake.js";
import { ACME_ORGANISATION } from "../../../../../organisationFixture.js";
import { ACME_BOTS, bump } from "./fixtures.js";
import { harness } from "./harness.js";

/** One planned act over a green row, with only the fields each case is about stated. */
function plan(over: Partial<BumpPlan> = {}): BumpPlan {
  return {
    act: "enqueue",
    row: landingRowFake({ authorLogin: "acme-renovate[bot]", number: 661 }),
    signal: "bot-author",
    why: "every landing test a bot can satisfy passed",
    ...over,
  };
}

describe("performBumpActs", () => {
  it("still reports the act as taken when the autonomy ledger write fails, and names the failure", async () => {
    const run = harness({ prs: [bump()] });
    const outcomes = await performBumpActs({
      args: { dryRun: false, home: undefined, json: false, limit: 50, optOutLabels: [], repos: [] },
      bots: ACME_BOTS,
      deps: { ...run.deps, recordAutonomy: () => Promise.resolve("the store could not be opened") },
      home: undefined,
      scheduled: [{ capped: false, plan: plan() }],
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.outcome).toBe("acted");
    expect(outcomes[0]!.detail).toBe(
      "enqueued it, but the AUTONOMY ledger row could not be written (the store could not be opened) — the act happened and the owner's briefing will not show it",
    );
  });

  it("skips a capped entry without pressing it, and says the next firing takes it", async () => {
    const run = harness({ prs: [bump()] });
    const outcomes = await performBumpActs({
      args: { dryRun: false, home: undefined, json: false, limit: 50, optOutLabels: [], repos: [] },
      bots: ACME_BOTS,
      deps: run.deps,
      home: undefined,
      scheduled: [{ capped: true, plan: plan() }],
    });

    expect(run.pressed).toEqual([]);
    expect(outcomes[0]!.outcome).toBe("skipped");
    expect(outcomes[0]!.detail).toBe(
      `this pass's cap of ${String(BUMP_ENQUEUE_CAP)} enqueue(s) was already reached — the next firing takes it`,
    );
  });

  it("answers one outcome per scheduled entry, in the order it was given them", async () => {
    const run = harness({ prs: [bump()] });
    const outcomes = await performBumpActs({
      args: { dryRun: false, home: undefined, json: false, limit: 50, optOutLabels: [], repos: [] },
      bots: ACME_BOTS,
      deps: run.deps,
      home: undefined,
      scheduled: [
        { capped: false, plan: plan({ act: "nothing", row: landingRowFake({ number: 1 }), why: "it is queued" }) },
        { capped: false, plan: plan({ act: "enqueue", row: landingRowFake({ number: 2 }) }) },
      ],
    });

    expect(outcomes.map((outcome) => outcome.number)).toEqual([1, 2]);
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["skipped", "acted"]);
    expect(outcomes[0]!.detail).toBe("it is queued");
  });

  it("seats with the bots the pass resolved, never a second read of the organisation's", async () => {
    // The organisation the seat reads for its workspace names NO bot; the pass resolved `acme-renovate`. Only the
    // pass's actors can put the Renovate clause on this ask, so the clause is the witness of which one was used.
    const run = harness({ organisation: ok(ACME_ORGANISATION), prs: [bump()] });
    const held = landingRowFake({
      authorIsBot: true,
      authorLogin: "acme-renovate",
      number: 16624,
      tests: [{ id: "codeowners-satisfied", verdict: "fail", why: "waiting on a human review" }],
    });
    await performBumpActs({
      args: { dryRun: false, home: undefined, json: false, limit: 50, optOutLabels: [], repos: [] },
      bots: ACME_BOTS,
      deps: run.deps,
      home: undefined,
      scheduled: [{ capped: false, plan: plan({ act: "seat", row: held, why: "a session is needed for ci-green" }) }],
    });
    const argv = run.registered[0]!;

    expect(run.registered).toHaveLength(1);
    expect(argv[argv.indexOf("--ask") + 1]!.endsWith(RENOVATE_SEAT_CLAUSE)).toBe(true);
  });
});
