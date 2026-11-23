/**
 * `judgeRecipeDue` / `judgeRecipeDefinitions` — due-ness and the covered SLOT for the in-repo definition
 * store, with `onMissed` enacted where the slot is chosen.
 *
 * Pure: every case is a row literal, a stored run and a clock.
 */
import { describe, expect, it } from "vitest";

import {
  RECIPE_DEFINITION_SCHEMA_VERSION,
  type RecipeDefinition,
  type RecipeHold,
} from "../../../../live/automation/definition.js";
import { judgeRecipeDefinitions, judgeRecipeDue } from "../../../../live/automation/definitionDue.js";
import type { RecipeDefinitionRun } from "../../../../live/automation/definitionRunStore.js";

const NOW_ISO = "2026-09-08T12:05:00.000Z";

/** An hourly `verb-run` row, overridable field by field. */
function row(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: "verb-run",
    onMissed: "backfill",
    params: { argv: ["atlas", "freshness"] },
    recipeId: "atlas-rolling-window",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/** An UNCLEARED hold, overridable field by field. */
function held(over: Partial<RecipeHold> = {}): RecipeHold {
  return {
    askedIso: "2026-09-19T04:24:57.000Z",
    clearedBy: null,
    reason: "owner 290-22: the alert-channel digests stay off",
    ...over,
  };
}

/** A stored run whose watermark is the slot named, finished a little after it unless told otherwise. */
function ran({
  watermarkIso,
  lastRunAtIso = watermarkIso,
}: {
  watermarkIso: string;
  lastRunAtIso?: string;
}): RecipeDefinitionRun {
  return { exitCode: 0, lastRunAtIso, watermarkIso };
}

describe("judgeRecipeDue", () => {
  it("is due at any cadence when the row has never run, and covers the latest slot", () => {
    const verdict = judgeRecipeDue({ definition: row(), nowIso: NOW_ISO, run: null });
    expect(verdict.due).toBe(true);
    expect(verdict.slotIso).toBe("2026-09-08T12:00:00.000Z");
    expect(verdict.line).toBe(
      "recipe atlas-rolling-window · DUE · has never run · covers slot 2026-09-08T12:00:00.000Z",
    );
  });

  it("is due when a firing went by after the watermark, and covers that firing", () => {
    const verdict = judgeRecipeDue({
      definition: row(),
      nowIso: NOW_ISO,
      run: ran({ watermarkIso: "2026-09-08T11:00:00.000Z" }),
    });
    expect(verdict.due).toBe(true);
    expect(verdict.firingsSinceWatermark).toBe(1);
    expect(verdict.slotIso).toBe("2026-09-08T12:00:00.000Z");
    expect(verdict.line).toBe(
      "recipe atlas-rolling-window · DUE · `0 * * * *` fired 1x since slot 2026-09-08T11:00:00.000Z · covers slot 2026-09-08T12:00:00.000Z",
    );
  });

  it("is not due when no firing has gone by since the watermark", () => {
    const verdict = judgeRecipeDue({
      definition: row(),
      nowIso: NOW_ISO,
      run: ran({ watermarkIso: "2026-09-08T12:00:00.000Z" }),
    });
    expect(verdict.due).toBe(false);
    expect(verdict.slotIso).toBe(null);
    expect(verdict.line).toBe(
      "recipe atlas-rolling-window · current · no `0 * * * *` firing since slot 2026-09-08T12:00:00.000Z",
    );
  });

  it("judges the WATERMARK, not the finish instant, so a run that crossed a firing leaves that firing due", () => {
    // The defect a wall-clock stamp had: due for 12:00, started 12:59:50, finished 13:00:05. Stamped with the
    // finish instant, 13:00 read as covered and never ran. Stamped with its slot, 13:00 is still owed.
    const verdict = judgeRecipeDue({
      definition: row(),
      nowIso: "2026-09-08T13:00:10.000Z",
      run: ran({ lastRunAtIso: "2026-09-08T13:00:05.000Z", watermarkIso: "2026-09-08T12:00:00.000Z" }),
    });
    expect(verdict.due).toBe(true);
    expect(verdict.lastRunAtIso).toBe("2026-09-08T13:00:05.000Z");
    expect(verdict.slotIso).toBe("2026-09-08T13:00:00.000Z");
  });

  it("covers the LATEST slot and names the older ones skipped when the row skips", () => {
    const verdict = judgeRecipeDue({
      definition: row({ destination: { kind: "slack" }, kind: "alert-summary", onMissed: "skip" }),
      nowIso: NOW_ISO,
      run: ran({ watermarkIso: "2026-09-08T08:00:00.000Z" }),
    });
    expect(verdict.firingsSinceWatermark).toBe(4);
    expect(verdict.slotIso).toBe("2026-09-08T12:00:00.000Z");
    expect(verdict.slotsOwedAfterThis).toBe(0);
    expect(verdict.line).toBe(
      "recipe atlas-rolling-window · DUE · `0 * * * *` fired 4x since slot 2026-09-08T08:00:00.000Z · " +
        "covers slot 2026-09-08T12:00:00.000Z, 3 older skipped (onMissed skip)",
    );
  });

  it("covers the true latest slot on a skip row that missed more firings than the count keeps", () => {
    // 20 hours of a minutely cadence is 1200 firings, past the 1000 the verdict counts. The slot must still be
    // the current minute, or the row stays due and posts again on the very next tick.
    const verdict = judgeRecipeDue({
      definition: row({
        cadence: "* * * * *",
        destination: { kind: "slack" },
        kind: "alert-summary",
        onMissed: "skip",
      }),
      nowIso: NOW_ISO,
      run: ran({ watermarkIso: "2026-09-07T16:05:00.000Z" }),
    });
    expect(verdict.firingsSinceWatermark).toBe(1000);
    expect(verdict.slotIso).toBe("2026-09-08T12:05:00.000Z");
  });

  it("walks a per-slot backfill from its OLDEST owed slot, leaving the rest owed", () => {
    const verdict = judgeRecipeDue({
      definition: row({ destination: { kind: "datadog-push" }, kind: "metrics-push", params: {} }),
      nowIso: NOW_ISO,
      run: ran({ watermarkIso: "2026-09-08T08:00:00.000Z" }),
    });
    expect(verdict.slotIso).toBe("2026-09-08T09:00:00.000Z");
    expect(verdict.slotsOwedAfterThis).toBe(3);
    expect(verdict.line).toBe(
      "recipe atlas-rolling-window · DUE · `0 * * * *` fired 4x since slot 2026-09-08T08:00:00.000Z · " +
        "backfills slot 2026-09-08T09:00:00.000Z, 3 more owed",
    );
  });

  it("is still due for the next owed slot once a per-slot backfill has covered one", () => {
    const verdict = judgeRecipeDue({
      definition: row({ destination: { kind: "datadog-push" }, kind: "metrics-push", params: {} }),
      nowIso: NOW_ISO,
      run: ran({ lastRunAtIso: NOW_ISO, watermarkIso: "2026-09-08T09:00:00.000Z" }),
    });
    expect(verdict.due).toBe(true);
    expect(verdict.slotIso).toBe("2026-09-08T10:00:00.000Z");
    expect(verdict.slotsOwedAfterThis).toBe(2);
  });

  it("catches a backfill row up in ONE run when its kind brings the world current, rather than N runs", () => {
    const verdict = judgeRecipeDue({
      definition: row(),
      nowIso: NOW_ISO,
      run: ran({ watermarkIso: "2026-09-08T08:00:00.000Z" }),
    });
    expect(verdict.slotIso).toBe("2026-09-08T12:00:00.000Z");
    expect(verdict.slotsOwedAfterThis).toBe(0);
    expect(verdict.line).toContain(
      "covers slot 2026-09-08T12:00:00.000Z, 3 missed caught up in the same run (kind 'verb-run' brings the world current)",
    );
  });

  it("covers only the latest slot for a never-run per-slot backfill, because there is no watermark to walk from", () => {
    const verdict = judgeRecipeDue({
      definition: row({ destination: { kind: "datadog-push" }, kind: "metrics-push", params: {} }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.slotIso).toBe("2026-09-08T12:00:00.000Z");
    expect(verdict.slotsOwedAfterThis).toBe(0);
  });

  it("honours a four-hourly cadence rather than treating every hour as a firing", () => {
    // The slot is deliberately not asserted here: a four-hourly cron lands on different UTC instants in
    // different zones, and cron-parser reads the installation's local time. Every slot assertion in this
    // file is on an hourly cadence, which fires at the same instants everywhere.
    const verdict = judgeRecipeDue({
      definition: row({ cadence: "0 */4 * * *" }),
      nowIso: NOW_ISO,
      run: ran({ watermarkIso: "2026-09-08T09:00:00.000Z" }),
    });
    expect(verdict.firingsSinceWatermark).toBe(1);
  });

  it("parks a disabled row without judging its cadence at all", () => {
    const verdict = judgeRecipeDue({
      definition: row({ cadence: "not a cron", enabled: false }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.due).toBe(false);
    expect(verdict.slotIso).toBe(null);
    expect(verdict.offReason).toBe("disabled");
    expect(verdict.line).toBe("recipe atlas-rolling-window · parked · the row is disabled");
  });

  it("leaves a row with no hold alone, so no existing definition's verdict moves", () => {
    const verdict = judgeRecipeDue({ definition: row(), nowIso: NOW_ISO, run: null });
    expect(verdict.due).toBe(true);
    expect(verdict.offReason).toBe(undefined);
  });

  it("refuses a FAILURE hold read in the stored view, naming its finding and what lifts it", () => {
    const verdict = judgeRecipeDue({
      definition: row({ hold: held({ finding: "recipe-failing-atlas-a1", reason: "held by the store" }) }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.due).toBe(false);
    expect(verdict.offReason).toBe("held");
    expect(verdict.line).toContain("The store placed this hold because a firing failed, and its finding was not read");
    expect(verdict.line).toContain("it lifts when the finding recipe-failing-atlas-a1 is settled answered");
  });

  it("refuses a failure hold whose finding the lifted view read as still held, quoting what it read", () => {
    const hold = held({
      finding: "recipe-failing-atlas-a1",
      findingState: { held: true, line: "its finding is open", stage: { kind: "queued" } },
    });
    const verdict = judgeRecipeDue({ definition: row({ hold }), nowIso: NOW_ISO, run: null });
    expect(verdict.offReason).toBe("held");
    expect(verdict.line).toContain("because a firing failed, and its finding is open.");
  });

  it("fires a row again once the lifted view reads its failure hold's finding as fixed", () => {
    const hold = held({
      finding: "recipe-failing-atlas-a1",
      findingState: { held: false, line: "settled answered", stage: { kind: "landed" } },
    });
    const verdict = judgeRecipeDue({ definition: row({ hold }), nowIso: NOW_ISO, run: null });
    expect(verdict.due).toBe(true);
    expect(verdict.offReason).toBe(undefined);
  });

  it("refuses an UNCLEARED hold even though the row is enabled — a re-enable alone does nothing", () => {
    const verdict = judgeRecipeDue({
      definition: row({ enabled: true, hold: held() }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.due).toBe(false);
    expect(verdict.slotIso).toBe(null);
    expect(verdict.offReason).toBe("held");
  });

  it("names the hold's reason, its instant, that there is no hatch, and what does lift it", () => {
    const verdict = judgeRecipeDue({
      definition: row({ enabled: true, hold: held() }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.line).toBe(
      "recipe atlas-rolling-window · HELD since 2026-09-19T04:24:57.000Z · owner 290-22: the alert-channel " +
        "digests stay off. A hold has no escape hatch and no environment override — it is lifted only by " +
        "recording the owner's own approval on the row's `hold.clearedBy`, which a reader can go and read: " +
        "{ runSlug, atIso } for the owner's answer to a Queue row, or { dmChannel, ts, atIso } for a message the " +
        "owner sent in their bot DM. Ask the owner on the Queue (`handover register`), never in that DM. Setting " +
        "`enabled` back to true does nothing while the hold stands.",
    );
  });

  it("reports HELD rather than disabled when the row is both, so nobody flips a switch that cannot help", () => {
    const verdict = judgeRecipeDue({
      definition: row({ enabled: false, hold: held() }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.offReason).toBe("held");
  });

  it("schedules the row again once a DM approval is recorded against the hold", () => {
    const verdict = judgeRecipeDue({
      definition: row({
        hold: held({
          clearedBy: {
            atIso: "2026-09-20T01:00:00.000Z",
            dmChannel: "D0SYN000002",
            ts: "1789800000.000100",
          },
        }),
      }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.due).toBe(true);
    expect(verdict.offReason).toBe(undefined);
    expect(verdict.slotIso).toBe("2026-09-08T12:00:00.000Z");
  });

  it("schedules the row again once the owner's answer to a Queue row is recorded against the hold", () => {
    const verdict = judgeRecipeDue({
      definition: row({ hold: held({ clearedBy: { atIso: "2026-09-27T09:00:00.000Z", runSlug: "a-row" } }) }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.due).toBe(true);
    expect(verdict.offReason).toBe(undefined);
  });

  it("still parks a CLEARED hold's row when it is disabled, because the two are separate switches", () => {
    const verdict = judgeRecipeDue({
      definition: row({
        enabled: false,
        hold: held({
          clearedBy: {
            atIso: "2026-09-20T01:00:00.000Z",
            dmChannel: "D0SYN000002",
            ts: "1789800000.000100",
          },
        }),
      }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.due).toBe(false);
    expect(verdict.offReason).toBe("disabled");
  });

  it("holds a row whose cadence would otherwise be judged, without judging it", () => {
    const verdict = judgeRecipeDue({
      definition: row({ cadence: "not a cron", hold: held() }),
      nowIso: NOW_ISO,
      run: null,
    });
    expect(verdict.offReason).toBe("held");
    expect(verdict.line).toContain("HELD since");
  });

  it("refuses an unschedulable cadence rather than running it every tick", () => {
    const verdict = judgeRecipeDue({
      definition: row({ cadence: "not a cron" }),
      nowIso: NOW_ISO,
      run: ran({ watermarkIso: "2026-09-08T11:00:00.000Z" }),
    });
    expect(verdict.due).toBe(false);
    expect(verdict.line).toContain("UNSCHEDULABLE · cadence `not a cron` was refused:");
  });

  it("refuses an unschedulable cadence on a never-run row too, rather than calling it due", () => {
    const verdict = judgeRecipeDue({ definition: row({ cadence: "not a cron" }), nowIso: NOW_ISO, run: null });
    expect(verdict.due).toBe(false);
    expect(verdict.line).toContain("UNSCHEDULABLE · cadence `not a cron` was refused:");
  });
});

describe("judgeRecipeDefinitions", () => {
  it("returns one verdict per row, parked and current ones included, in the order given", () => {
    const verdicts = judgeRecipeDefinitions({
      definitions: [row({ recipeId: "one" }), row({ enabled: false, recipeId: "two" })],
      nowIso: NOW_ISO,
      runFor: () => null,
    });
    expect(verdicts.map((verdict) => verdict.recipeId)).toEqual(["one", "two"]);
    expect(verdicts.map((verdict) => verdict.due)).toEqual([true, false]);
  });

  it("asks the run reader for each row by its own id", () => {
    const asked: string[] = [];
    judgeRecipeDefinitions({
      definitions: [row({ recipeId: "one" }), row({ recipeId: "two" })],
      nowIso: NOW_ISO,
      runFor: ({ recipeId }) => {
        asked.push(recipeId);
        return null;
      },
    });
    expect(asked).toEqual(["one", "two"]);
  });

  it("returns nothing for an empty store", () => {
    expect(judgeRecipeDefinitions({ definitions: [], nowIso: NOW_ISO, runFor: () => null })).toEqual([]);
  });
});

describe("a firing nearer its successor than its own hour defers to it (owner 291-8x)", () => {
  /**
   * The measured incident, reduced to an hourly row so no test depends on the machine's timezone.
   *
   * `iso-policy-acceptance-daily` (`0 9 * * *`, `verb-run`, `onMissed: skip`) ran its Sunday 09:00 firing at
   * Monday 06:39 local and its Monday 09:00 firing at 09:20 — two near-identical cards 2h41m apart, because
   * a `perSlot: false` kind reports the world as of its RUN. The shape below is the same one, on a cadence
   * whose period is an hour: 40 minutes elapsed, 20 to go.
   */
  const hourly = (over: Partial<RecipeDefinition> = {}): RecipeDefinition =>
    row({ cadence: "0 * * * *", destination: { kind: "slack" }, onMissed: "skip", ...over });

  /** A stored run whose watermark is the slot given, which is all `judgeRecipeDue` reads off one. */
  const covered = ({ watermarkIso }: { watermarkIso: string }): RecipeDefinitionRun => ({
    exitCode: 0,
    lastRunAtIso: watermarkIso,
    watermarkIso,
  });

  it("is NOT due, and says which two spans decided it", () => {
    const verdict = judgeRecipeDue({
      definition: hourly(),
      nowIso: "2026-09-08T12:40:00.000Z",
      run: covered({ watermarkIso: "2026-09-08T11:00:00.000Z" }),
    });
    expect(verdict.due).toBe(false);
    expect(verdict.slotIso).toBe(null);
    expect(verdict.line).toBe(
      "recipe atlas-rolling-window · DEFERRED · slot 2026-09-08T12:00:00.000Z came 40m ago and the next " +
        "`0 * * * *` firing is 20m away, so the successor covers it · watermark untouched",
    );
  });

  it("leaves the watermark where it was, so the successor covers both", () => {
    const verdict = judgeRecipeDue({
      definition: hourly(),
      nowIso: "2026-09-08T12:40:00.000Z",
      run: covered({ watermarkIso: "2026-09-08T11:00:00.000Z" }),
    });
    expect(verdict.watermarkIso).toBe("2026-09-08T11:00:00.000Z");
    expect(verdict.slotsOwedAfterThis).toBe(0);
  });

  it("runs the firing while it is still nearer its own hour than the next one", () => {
    const verdict = judgeRecipeDue({
      definition: hourly(),
      nowIso: "2026-09-08T12:20:00.000Z",
      run: covered({ watermarkIso: "2026-09-08T11:00:00.000Z" }),
    });
    expect(verdict.due).toBe(true);
    expect(verdict.slotIso).toBe("2026-09-08T12:00:00.000Z");
  });

  it("SELF-HEALS once a second firing has gone by, so no row can be deferred forever", () => {
    // The mutation killer. Written as `firingsSinceWatermark > 0` rather than `=== 1`, an install whose
    // passes all land at the same late minute would defer this row on every pass, for ever.
    const verdict = judgeRecipeDue({
      definition: hourly(),
      nowIso: "2026-09-08T13:40:00.000Z",
      run: covered({ watermarkIso: "2026-09-08T11:00:00.000Z" }),
    });
    expect(verdict.due).toBe(true);
    expect(verdict.firingsSinceWatermark).toBe(2);
    expect(verdict.slotIso).toBe("2026-09-08T13:00:00.000Z");
  });

  it("never defers a BACKFILLED per-slot firing, whose slot is a datapoint rather than a repeat", () => {
    const verdict = judgeRecipeDue({
      definition: hourly({ kind: "metrics-push", onMissed: "backfill", params: {} }),
      nowIso: "2026-09-08T12:40:00.000Z",
      run: covered({ watermarkIso: "2026-09-08T11:00:00.000Z" }),
    });
    expect(verdict.due).toBe(true);
    expect(verdict.slotIso).toBe("2026-09-08T12:00:00.000Z");
  });

  it("does not defer a row that has NEVER run, which has no successor to hand it to", () => {
    const verdict = judgeRecipeDue({ definition: hourly(), nowIso: "2026-09-08T12:40:00.000Z", run: null });
    expect(verdict.due).toBe(true);
    expect(verdict.slotIso).toBe("2026-09-08T12:00:00.000Z");
  });
});
