import { describe, expect, it } from "vitest";

import type { FiringView } from "../../../automations/card.js";
import { healthOf, nowDoingOf, standingHoldOf, waitingOnOf } from "../../../automations/health.js";
import type { RecipeDefinition, RecipeHold } from "../../../live/automation/definition.js";
import type { RecipeDueVerdict } from "../../../live/automation/definitionDue.js";
import type { SilentRow } from "../../../live/automation/silentRows.js";
import type { RecipeSlotVerdict } from "../../../live/automation/slotAttempt.js";
import { auditedAgainst, HIS_ANCHOR } from "../../auditedOwnerHold.js";

const definition = (over: Partial<RecipeDefinition> = {}): RecipeDefinition => ({
  cadence: "0 */4 * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "resync",
  onMissed: "backfill",
  params: { argv: ["recipe", "resync", "--source", "slack"] },
  recipeId: "resync-corpus-slack",
  schemaVersion: 1,
  ...over,
});

const verdict = (over: Partial<RecipeDueVerdict> = {}): RecipeDueVerdict => ({
  due: false,
  firingsSinceWatermark: 0,
  lastRunAtIso: "2026-10-03T00:00:00.000Z",
  line: "",
  recipeId: "resync-corpus-slack",
  slotIso: null,
  slotsOwedAfterThis: 0,
  watermarkIso: "2026-10-03T00:00:00.000Z",
  ...over,
});

const firing = (over: Partial<FiringView> = {}): FiringView => ({
  attempt: 1,
  detail: null,
  exitCode: 0,
  outcome: "succeeded",
  reason: null,
  runStartedAtIso: null,
  settledAtIso: "2026-10-03T00:20:00.000Z",
  slotIso: "2026-10-03T00:00:00.000Z",
  startedAtIso: "2026-10-03T00:00:00.000Z",
  ...over,
});

const held: RecipeSlotVerdict = {
  attempt: 2,
  holder: "recipe run-due",
  kind: "held",
  leaseExpiresIso: "2026-10-03T04:00:00.000Z",
};

const fixHold: RecipeHold = {
  askedIso: "2026-10-04T21:03:00.000Z",
  clearedBy: null,
  finding: "corpus-linear-fails",
  findingState: { held: true, line: "queued", stage: { kind: "queued" } },
  reason: "a firing failed",
};

/** The owner's pause, carrying the owner's words naming the row, read through the audited view. */
const ownerHeld = auditedAgainst({
  definition: definition({
    hold: {
      askedIso: "2026-10-01T09:00:00.000Z",
      clearedBy: null,
      placedBy: { anchor: HIS_ANCHOR, words: "pause resync-corpus-slack" },
      reason: "too noisy",
    },
  }),
  record: "please pause resync-corpus-slack, it is too noisy",
});

/** An owner hold with no owner word on it, as a chair keypress leaves. */
const unownedHold: RecipeHold = { askedIso: "2026-10-17T08:55:40.188Z", clearedBy: null, reason: "owner chose hold" };

const inputs = {
  definition: definition(),
  firingsGap: null,
  hold: null,
  latest: firing(),
  runningSync: undefined,
  silent: undefined,
  slotVerdict: null,
  verdict: verdict(),
  waitingOn: null,
};

describe("standingHoldOf", () => {
  it("reads a failure hold with its board row, since, and the stage its fix is in", () => {
    expect(standingHoldOf({ definition: definition({ hold: fixHold }) })).toEqual({
      finding: "corpus-linear-fails",
      kind: "fix",
      sinceIso: "2026-10-04T21:03:00.000Z",
      stage: { kind: "queued" },
    });
  });

  it("reads a failure hold whose fix landed as no hold, exactly as the scheduler does", () => {
    const lifted: RecipeHold = { ...fixHold, findingState: { held: false, line: "landed", stage: { kind: "landed" } } };
    expect(standingHoldOf({ definition: definition({ hold: lifted }) })).toBe(null);
  });

  it("reads a failure hold nobody read the board for as an unread stage", () => {
    const stored: RecipeHold = {
      askedIso: fixHold.askedIso,
      clearedBy: null,
      finding: "corpus-linear-fails",
      reason: fixHold.reason,
    };
    expect(standingHoldOf({ definition: definition({ hold: stored }) })).toEqual({
      finding: "corpus-linear-fails",
      kind: "fix",
      sinceIso: "2026-10-04T21:03:00.000Z",
      stage: { kind: "unread" },
    });
  });

  it("reads a hold with no finding as the owner's own pause, carrying the owner's reason", () => {
    expect(standingHoldOf({ definition: ownerHeld })).toEqual({
      kind: "owner",
      placedByState: { kind: "anchored" },
      reason: "too noisy",
      sinceIso: "2026-10-01T09:00:00.000Z",
    });
  });

  it("never reads a hand-built placedBy the audit did not judge as the owner's", () => {
    const unaudited = definition({
      hold: {
        askedIso: "2026-10-01T09:00:00.000Z",
        clearedBy: null,
        placedBy: { anchor: "talk:missing", words: "unrelated words" },
        reason: "too noisy",
      },
    });

    expect(standingHoldOf({ definition: unaudited })).toEqual({
      kind: "owner",
      placedByState: { kind: "unresolved", reason: "this view did not read the hold's anchor" },
      reason: "too noisy",
      sinceIso: "2026-10-01T09:00:00.000Z",
    });
  });

  it("carries an owner hold with no owner word as unanchored", () => {
    expect(standingHoldOf({ definition: definition({ hold: unownedHold }) })).toEqual({
      kind: "owner",
      placedByState: { kind: "unanchored" },
      reason: "owner chose hold",
      sinceIso: "2026-10-17T08:55:40.188Z",
    });
  });
});

describe("healthOf", () => {
  it("leads with what needs someone: a row waiting on a person outranks its own success", () => {
    expect(healthOf({ ...inputs, waitingOn: "you: sign in at slack" })).toEqual({
      health: "waiting",
      why: "waiting on you: sign in at slack",
    });
  });

  it("reads a standing failure hold as failed, not waiting, even when its newest firing succeeded", () => {
    const hold = standingHoldOf({ definition: definition({ hold: fixHold }) });
    expect(healthOf({ ...inputs, hold })).toEqual({
      health: "failed",
      why: "a run failed, so the scheduler paused it until its fix lands",
    });
  });

  it("reads the owner's own pause as paused, never as broken", () => {
    const hold = standingHoldOf({ definition: ownerHeld });
    expect(healthOf({ ...inputs, hold })).toEqual({ health: "paused", why: "paused on your word" });
  });

  it("never reads an owner hold with no owner word as paused on the owner's word, and still reads it paused", () => {
    const hold = standingHoldOf({ definition: definition({ hold: unownedHold }) });
    expect(healthOf({ ...inputs, hold })).toEqual({
      health: "paused",
      why: "paused, but no word of yours naming it is on the pause",
    });
  });

  it("reads a disabled row as off whatever hold stands on it", () => {
    const hold = standingHoldOf({ definition: definition({ hold: fixHold }) });
    expect(healthOf({ ...inputs, definition: definition({ enabled: false }), hold })).toEqual({
      health: "off",
      why: "its row is disabled",
    });
  });

  it("reads a held firing as running, naming its holder and lease", () => {
    expect(healthOf({ ...inputs, slotVerdict: held })).toEqual({
      health: "running",
      why: "held by recipe run-due until 2026-10-03T04:00:00.000Z",
    });
  });

  it("reads a row that went quiet as running while its OWN current firing is held, and as stopped once it is not", () => {
    const quiet: SilentRow = {
      cadence: "15 8 * * *",
      currentSlotHold: null,
      detail: "1 slot(s) of `15 8 * * *` went by unrun",
      lastRunAtIso: "2026-10-01T16:57:21.433Z",
      missedSlots: 1,
      reason: "MISSED",
      recipeId: "bump-fix-slopweaver",
    };
    const heldRow: SilentRow = {
      ...quiet,
      currentSlotHold: { holder: "automations-seat-40cae177", startedAtIso: "2026-10-03T00:13:20.286Z" },
    };
    expect([healthOf({ ...inputs, silent: heldRow }), healthOf({ ...inputs, silent: quiet })]).toEqual([
      { health: "running", why: "held by automations-seat-40cae177 since 2026-10-03T00:13:20.286Z" },
      { health: "stopped", why: "1 slot(s) of `15 8 * * *` went by unrun" },
    ]);
  });

  it("reads a quiet row as stopped though a duplicate definition's firing of its recipe id is held", () => {
    const quiet: SilentRow = {
      cadence: "0 8 * * *",
      currentSlotHold: null,
      detail: "1 slot(s) of `0 8 * * *` went by unrun",
      lastRunAtIso: "2026-10-01T08:00:00.000Z",
      missedSlots: 1,
      reason: "MISSED",
      recipeId: "dup",
    };
    expect(healthOf({ ...inputs, silent: quiet, slotVerdict: held })).toEqual({
      health: "stopped",
      why: "1 slot(s) of `0 8 * * *` went by unrun",
    });
  });

  it("says why nothing is measured when the slot ledger did not read whole", () => {
    expect(healthOf({ ...inputs, firingsGap: "2 slot ledger file(s) did not decode", latest: undefined })).toEqual({
      health: "not-measured",
      why: "2 slot ledger file(s) did not decode",
    });
  });

  it("reads a disabled row with no newer reading as off", () => {
    expect(healthOf({ ...inputs, definition: definition({ enabled: false }) })).toEqual({
      health: "off",
      why: "its row is disabled",
    });
  });
});

describe("nowDoingOf", () => {
  const base = { hold: null, latest: firing(), runningSync: undefined, slotVerdict: null, verdict: verdict() };

  it("names the held firing and its attempt", () => {
    expect(nowDoingOf({ ...base, slotVerdict: held })).toBe("running firing 2026-10-03T00:00:00.000Z (attempt 2)");
  });

  it("is idle when nothing is held and nothing is due", () => {
    expect(nowDoingOf(base)).toBe("idle until its next firing");
  });

  it("says a failure-held row will not run again until its fix lands, never that it is due", () => {
    const hold = standingHoldOf({ definition: definition({ hold: fixHold }) });
    expect(nowDoingOf({ ...base, hold, verdict: verdict({ due: true, slotIso: "2026-10-05T00:00:00.000Z" }) })).toBe(
      "not running: the scheduler will not run it again until its fix lands",
    );
  });

  it("says a paused row will not run until the owner lifts the pause", () => {
    const hold = standingHoldOf({ definition: ownerHeld });
    expect(nowDoingOf({ ...base, hold })).toBe("not running: the scheduler will not run it until you lift the pause");
  });

  it("puts an unowned hold on the fleet, not on the owner", () => {
    const hold = standingHoldOf({ definition: definition({ hold: unownedHold }) });
    expect(nowDoingOf({ ...base, hold })).toBe("not running: held, with no word of yours naming it on the hold");
  });

  it("says a disabled row is not running because its row is disabled", () => {
    expect(nowDoingOf({ ...base, verdict: verdict({ offReason: "disabled" }) })).toBe(
      "not running: its row is disabled",
    );
  });
});

describe("waitingOnOf", () => {
  it("reads a deferred newest firing's own detail as who it waits on", () => {
    const latest = firing({ detail: "waiting on the Linear token", outcome: "deferred" });
    expect(waitingOnOf({ latest, resync: undefined })).toBe("waiting on the Linear token");
  });

  it("waits on nobody when nothing blocks it", () => {
    expect(waitingOnOf({ latest: firing(), resync: undefined })).toBe(null);
  });
});
