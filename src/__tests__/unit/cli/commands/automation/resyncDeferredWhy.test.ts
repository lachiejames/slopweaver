/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { deferredWhy } from "../../../../../cli/commands/automation/resyncDeferredWhy.js";
import { EXIT_DEFERRED } from "../../../../../cli/exitCodes.js";
import type { ResyncAttempt } from "../../../../../live/resync/outcome.js";

/** An attempt that stopped at a sign-in page on one origin. */
function walledAt({ origin }: { origin: string }): ResyncAttempt {
  return {
    afterClock: null,
    beforeClock: "2026-10-06T00:00:00.000Z",
    exitCode: EXIT_DEFERRED,
    finishedAtIso: "2026-10-06T10:30:00.000Z",
    outcome: "failed",
    problems: [`stopped at ${new URL(origin).host}'s sign-in page`],
    recipeId: "resync-atlas-datadog",
    signInWall: origin,
    startedAtIso: "2026-10-06T10:29:00.000Z",
  };
}

/** An attempt whose stopping step itself exited `EXIT_DEFERRED`. */
function deferredAt({ step }: { step: string }): ResyncAttempt {
  return {
    afterClock: "2026-10-07T16:00:00.000Z",
    beforeClock: "2026-10-07T16:00:00.000Z",
    exitCode: EXIT_DEFERRED,
    finishedAtIso: "2026-10-07T19:17:14.000Z",
    outcome: "failed",
    problems: [`\`${step}\` exited 4`, "exited 4"],
    recipeId: "resync-corpus-slack",
    startedAtIso: "2026-10-07T19:17:12.000Z",
    stepDeferred: step,
  };
}

describe("deferredWhy", () => {
  it("names the press, never the owner's card, for a Datadog wall", () => {
    expect(deferredWhy({ attempt: walledAt({ origin: "https://ap1.datadoghq.com" }) })).toBe(
      "DEFERRED · stopped at https://ap1.datadoghq.com's sign-in page — the fleet's to press: " +
        "run `slopweaver browser sign-in --provider datadog`, press what it names, then re-run this resync",
    );
  });

  it("names the GitHub press for a github.com wall", () => {
    expect(deferredWhy({ attempt: walledAt({ origin: "https://github.com" }) })).toContain(
      "run `slopweaver browser sign-in --provider github`",
    );
  });

  it("keeps waiting on the owner's card for every other provider", () => {
    expect(deferredWhy({ attempt: walledAt({ origin: "https://go.xero.com" }) })).toBe(
      "DEFERRED · stopped at https://go.xero.com's sign-in page — the slot waits on their sign-in card, not a retry floor",
    );
  });

  it("names the held refresh slot for a refresh step that exited 4, never a browser walk that never ran", () => {
    expect(deferredWhy({ attempt: deferredAt({ step: "slopweaver refresh --source slack --store" }) })).toBe(
      "DEFERRED · `slopweaver refresh --source slack --store` exited 4: another process holds the source's " +
        "refresh slot — the slot is given back for the next pass, not cooled",
    );
  });

  it("keeps the held-Chrome line when a step that exited 4 also met a relay collision", () => {
    const attempt = { ...deferredAt({ step: "slopweaver atlas clerk sync" }), relayCollision: "held by pid 99021" };
    expect(deferredWhy({ attempt })).toBe(
      "DEFERRED · another browser walk held their Chrome — the slot is given back for the next pass, not cooled",
    );
  });

  it("claims no refresh slot for any other step that exited 4", () => {
    expect(deferredWhy({ attempt: deferredAt({ step: "slopweaver atlas clerk sync" }) })).toBe(
      "DEFERRED · `slopweaver atlas clerk sync` exited 4: a prerequisite is still in progress, per its own lines " +
        "above — the slot is given back for the next pass, not cooled",
    );
  });
});
