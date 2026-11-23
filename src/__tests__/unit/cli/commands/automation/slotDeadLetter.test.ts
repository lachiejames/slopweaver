/**
 * `abandonedDeath` — which abandoned firings die rather than being retaken, and the words each death carries.
 *
 * Pure: a definition and a verdict in, a death or `undefined` out. The write side (`deadLetter`) is driven
 * through `settleSlot` in `slotRun.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { type AbandonedVerdict, abandonedDeath } from "../../../../../cli/commands/automation/slotDeadLetter.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import { RESYNC_KIND } from "../../../../../live/automation/kinds.js";

/** A `verb-run` row: it writes, and its destination takes no idempotency key. */
const VERB_RUN: RecipeDefinition = {
  cadence: "0 17 * * *",
  destination: { kind: "local-atlas" },
  effect: "read-write",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["store", "backup"] },
  recipeId: "store-backup-daily",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

/** A `resync` row: it only reads, so a retry after an unknown outcome is safe. */
const RESYNC: RecipeDefinition = {
  ...VERB_RUN,
  effect: "read",
  kind: RESYNC_KIND,
  params: { atlas: "linear" },
  recipeId: "resync-atlas-linear",
};

/** The abandoned verdict, overridable field by field. */
function verdict(over: Partial<AbandonedVerdict> = {}): AbandonedVerdict {
  return {
    abandonment: { holderPid: 56470, kind: "holder-gone" },
    attempt: 1,
    holder: "recipe run-due",
    holderToken: "tok-1",
    kind: "abandoned",
    ran: false,
    ...over,
  };
}

describe("abandonedDeath", () => {
  it("declares a keyless write whose holder is gone OUTCOME_UNKNOWN, naming the pid", () => {
    expect(abandonedDeath({ definition: VERB_RUN, verdict: verdict() })).toEqual({
      detail:
        "attempt 1 under recipe run-due was abandoned (holder pid 56470 is gone) and left no receipt, and this " +
        "kind's destination takes no idempotency key, so nobody can say whether its effect landed",
      reason: "OUTCOME_UNKNOWN",
      what: "attempt 1 was abandoned (holder pid 56470 is gone) and its outcome cannot be established rather than a blind re-run",
    });
  });

  it("lets a read-only row whose lease expired on attempt 1 be retaken", () => {
    expect(abandonedDeath({ definition: RESYNC, verdict: verdict({ abandonment: { kind: "lease-expired" } }) })).toBe(
      undefined,
    );
  });

  it("declares a read-only row whose run STARTED and was abandoned HOLDER_GONE on its first attempt", () => {
    expect(abandonedDeath({ definition: RESYNC, verdict: verdict({ ran: true }) })).toEqual({
      detail:
        "attempt 1 under recipe run-due started its run and was abandoned (holder pid 56470 is gone) with nothing settled",
      reason: "HOLDER_GONE",
      what: "attempt 1 started and died (holder pid 56470 is gone)",
    });
  });

  it("lets a read-only row abandoned before its run ever started be retaken", () => {
    expect(abandonedDeath({ definition: RESYNC, verdict: verdict({ ran: false }) })).toBe(undefined);
  });

  it("declares a read-only row abandoned on its last attempt ATTEMPTS_EXHAUSTED", () => {
    expect(
      abandonedDeath({ definition: RESYNC, verdict: verdict({ abandonment: { kind: "lease-expired" }, attempt: 3 }) }),
    ).toEqual({
      detail: "attempt 3 under recipe run-due was abandoned (its lease expired) with no receipt",
      reason: "ATTEMPTS_EXHAUSTED",
      what: "3 attempts abandoned",
    });
  });
});
