/**
 * The account an owner hold owes the owner: their pause only when their anchored words name the automation, else a hold the
 * fleet owes the owner a word on.
 */
import { describe, expect, it } from "vitest";

import { type StandingHold, standingHoldOf } from "../../../automations/health.js";
import { ownerHoldAccount, worseOf } from "../../../automations/ownerHoldAccount.js";
import type { RecipeDefinition, RecipeHold } from "../../../live/automation/definition.js";
import { auditedAgainst, HIS_ANCHOR } from "../../auditedOwnerHold.js";

const SINCE = "2026-10-17T08:55:00.000Z";

/** A verb-run row held by `hold`. */
function heldRow({ hold }: { hold: RecipeHold }): RecipeDefinition {
  return {
    cadence: "0 2 * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    hold,
    kind: "verb-run",
    onMissed: "backfill",
    params: {},
    recipeId: "vulnfix-topup-acme-admin",
    schemaVersion: 1,
  };
}

/** The row's standing hold, which every case here builds as an owner hold. */
function ownerHoldOf({ definition }: { definition: RecipeDefinition }): Extract<StandingHold, { kind: "owner" }> {
  const hold = standingHoldOf({ definition });
  if (hold?.kind !== "owner") {
    throw new Error("fixture is not an owner hold");
  }
  return hold;
}

const BASE = {
  freshness: null,
  lastWorkedIso: "2026-10-16T02:00:00.000Z",
  meanwhile: ["The scheduler will not run it while the hold stands."],
  purpose: { forWhat: "x", meanwhile: null, name: "Vulnfix top-up", whenBroken: "No security PRs are raised." },
  recipeId: "vulnfix-topup-acme-admin",
} as const;

describe("ownerHoldAccount", () => {
  it("reads a hold carrying the owner's words naming the automation as the owner's pause", () => {
    const definition = auditedAgainst({
      definition: heldRow({
        hold: {
          askedIso: SINCE,
          clearedBy: null,
          placedBy: { anchor: HIS_ANCHOR, words: "hold vulnfix-topup-acme-admin" },
          reason: "discussion first",
        },
      }),
      record: "please hold vulnfix-topup-acme-admin for now",
    });

    expect(ownerHoldAccount({ ...BASE, hold: ownerHoldOf({ definition }) })).toEqual({
      detail: null,
      fix: { by: "you", sinceIso: SINCE, words: "It runs again when you lift the pause." },
      freshness: null,
      lastWorkedIso: "2026-10-16T02:00:00.000Z",
      meanwhile: ["The scheduler will not run it while the hold stands."],
      plainly: null,
      said: null,
      sinceIso: SINCE,
      state: "paused",
      why: "You paused it.",
      worse: "No security PRs are raised.",
    });
  });

  it("puts a hold with no placedBy on the fleet, never on the owner", () => {
    const definition = heldRow({
      hold: { askedIso: SINCE, clearedBy: null, reason: "owner chose 'Hold, discussion first'" },
    });
    const account = ownerHoldAccount({ ...BASE, hold: ownerHoldOf({ definition }) });

    expect([account.why, account.fix.by, account.detail]).toEqual([
      "It is held, but no word of yours naming it is on the hold.",
      "fleet",
      null,
    ]);
  });

  it("carries the reason an unread anchor could not be judged", () => {
    const definition = heldRow({
      hold: {
        askedIso: SINCE,
        clearedBy: null,
        placedBy: { anchor: HIS_ANCHOR, words: "hold vulnfix-topup-acme-admin" },
        reason: "discussion first",
      },
    });
    const account = ownerHoldAccount({ ...BASE, hold: ownerHoldOf({ definition }) });

    expect([account.fix.by, account.detail]).toEqual(["fleet", "this view did not read the hold's anchor"]);
  });
});

describe("worseOf", () => {
  it("says the purpose's own sentence when it has one", () => {
    expect(worseOf({ paused: true, purpose: BASE.purpose })).toBe("No security PRs are raised.");
  });

  it("says nothing can be named for a row with no purpose", () => {
    expect(worseOf({ paused: false, purpose: null })).toBe(
      "Nothing in this build says what it is for, so what is missing cannot be named.",
    );
  });

  it("says paused or broken by the row's state", () => {
    const purpose = { ...BASE.purpose, whenBroken: null };
    expect([worseOf({ paused: true, purpose }), worseOf({ paused: false, purpose })]).toEqual([
      "While it is paused, what it is for does not happen.",
      "While it is broken, what it is for does not happen.",
    ]);
  });
});
