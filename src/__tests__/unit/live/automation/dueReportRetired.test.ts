/**
 * The DUE-ASKS report's retirement lines — what a supervisor tick is told about rows retired on this install, and
 * about a registry it could not read. Pure: a row, its verdict and the retirement read in; lines out. The rest of
 * the report is `dueReport/`.
 */
import { describe, expect, it } from "vitest";

import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import type { RecipeDueVerdict } from "../../../../live/automation/definitionDue.js";
import { composeDueAskReport } from "../../../../live/automation/dueReport.js";
import { dueAskLines } from "../../../../live/automation/dueReportLines.js";
import { AutomationRetirementStoreErrors } from "../../../../live/automation/retirementStore.js";

/** The one standing row still on this install: an hourly `verb-run`. */
const ATLAS_ROW: RecipeDefinition = {
  cadence: "0 * * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "verb-run",
  onMissed: "backfill",
  params: { argv: ["atlas", "freshness"] },
  recipeId: "atlas-freshness",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

/** That row, due now. */
const ATLAS_DUE: RecipeDueVerdict = {
  deferredSlotIso: null,
  due: true,
  firingsSinceWatermark: 1,
  lastRunAtIso: "2026-09-08T11:30:00.000Z",
  line: "recipe atlas-freshness · DUE",
  recipeId: "atlas-freshness",
  slotIso: "2026-09-08T12:00:00.000Z",
  slotsOwedAfterThis: 0,
  watermarkIso: "2026-09-08T11:00:00.000Z",
};

describe("dueAskLines — retired rows", () => {
  it("names every retired row in one line before the tally, and counts them in it", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [ATLAS_ROW],
      nowIso: "2026-09-08T12:05:00.000Z",
      rejected: [],
      retirements: { kind: "configured", recipeIds: ["inbox-triage-daily", "thread-chase-daily"] },
      verdicts: [ATLAS_DUE],
    });
    const lines = dueAskLines({ report });
    expect(lines.slice(-2)).toEqual([
      "automation due · RETIRED on this install: inbox-triage-daily, thread-chase-daily — " +
        "`slopweaver automation retire --undo <id>` restores one",
      "1 actionable · 0 want a session · 0 claimed · 1 row(s) read · 2 RETIRED on this install",
    ]);
  });

  it("leads with an unreadable retirement registry, since no declared row was compared", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [ATLAS_ROW],
      nowIso: "2026-09-08T12:05:00.000Z",
      rejected: [],
      retirements: {
        error: AutomationRetirementStoreErrors.malformed({ issues: ["bad"], path: "/h/retirements.json" }),
        kind: "unreadable",
      },
      verdicts: [ATLAS_DUE],
    });
    const lines = dueAskLines({ report });
    expect(lines[0]).toBe(
      "!! retirements · the automation retirement registry at /h/retirements.json is malformed: bad — " +
        "no declared row was compared",
    );
    expect(lines[lines.length - 1]).toBe("1 actionable · 0 want a session · 0 claimed · 1 row(s) read");
  });
});
