/**
 * The card fields read straight off one store row each. The hold case is the one that matters: an owner hold's
 * stored reason shows bare only when the owner's anchored words name the automation.
 */
import { describe, expect, it } from "vitest";

import { definitionFieldsOf, holdFieldsOf, lastRunOf, purposeFieldsOf } from "../../../automations/cardFields.js";
import { standingHoldOf } from "../../../automations/health.js";
import type { RecipeDefinition, RecipeHold } from "../../../live/automation/definition.js";
import type { RecipeDueVerdict } from "../../../live/automation/definitionDue.js";
import { auditedAgainst, HIS_ANCHOR } from "../../auditedOwnerHold.js";

const RECIPE = "vulnfix-topup-acme-admin";

/** A verb-run row, held by `hold` when one is given. */
function row({ hold }: { hold?: RecipeHold } = {}): RecipeDefinition {
  return {
    cadence: "0 2 * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    ...(hold === undefined ? {} : { hold }),
    kind: "verb-run",
    onMissed: "backfill",
    params: {},
    recipeId: RECIPE,
    schemaVersion: 1,
  };
}

const HOLD: RecipeHold = {
  askedIso: "2026-10-17T08:55:00.000Z",
  clearedBy: null,
  reason: "owner chose 'Hold, discussion first'",
};

describe("holdFieldsOf", () => {
  it("shows a hold carrying the owner's naming words by its own reason", () => {
    const definition = auditedAgainst({
      definition: row({ hold: { ...HOLD, placedBy: { anchor: HIS_ANCHOR, words: `hold ${RECIPE}` } } }),
      record: `please hold ${RECIPE}`,
    });

    expect(holdFieldsOf({ hold: standingHoldOf({ definition }), recipeId: RECIPE })).toEqual({
      fixRow: null,
      pauseReason: "owner chose 'Hold, discussion first'",
    });
  });

  it("quotes a hold no owner word names as the hold's own note, under UNOWNED", () => {
    const definition = row({ hold: HOLD });

    expect(holdFieldsOf({ hold: standingHoldOf({ definition }), recipeId: RECIPE })).toEqual({
      fixRow: null,
      pauseReason:
        "UNOWNED — no word of the owner's names this automation; the hold's own note says “owner chose 'Hold, discussion first'”",
    });
  });

  it("answers both null for a row nothing holds", () => {
    expect(holdFieldsOf({ hold: null, recipeId: RECIPE })).toEqual({ fixRow: null, pauseReason: null });
  });
});

describe("lastRunOf", () => {
  it("answers both null for a row that has never run", () => {
    expect(lastRunOf({ run: undefined })).toEqual({ lastExitCode: null, lastRunAtIso: null });
  });
});

describe("purposeFieldsOf", () => {
  it("answers both null with no declared purpose, else the purpose's own name and use", () => {
    expect([
      purposeFieldsOf({ purpose: null }),
      purposeFieldsOf({ purpose: { forWhat: "raise PRs", meanwhile: null, name: "Top-up", whenBroken: null } }),
    ]).toEqual([
      { forWhat: null, name: null },
      { forWhat: "raise PRs", name: "Top-up" },
    ]);
  });
});

describe("definitionFieldsOf", () => {
  it("switches a row off under an owner hold even while it is enabled", () => {
    const definition = row({ hold: HOLD });
    const verdict: RecipeDueVerdict = {
      due: false,
      firingsSinceWatermark: 0,
      lastRunAtIso: null,
      line: "",
      offReason: "held",
      recipeId: RECIPE,
      slotIso: null,
      slotsOwedAfterThis: 0,
      watermarkIso: null,
    };
    const fields = definitionFieldsOf({ definition, hold: standingHoldOf({ definition }), verdict });

    expect([fields.recipeId, fields.cadence, fields.switchedOn]).toEqual([RECIPE, "0 2 * * *", false]);
  });
});
