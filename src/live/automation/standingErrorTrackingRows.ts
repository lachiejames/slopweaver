/**
 * The Error Tracking row: the weekly fix batch off the top of a registered team repository's For Review list.
 * Built per repository by `./teamStandingRows.ts`, never declared for an install that registered none.
 */
import { prodEnvFilter } from "../../datadog/prodEnvFilter.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "./definition.js";
import { ERROR_TRACKING_BATCH_KIND } from "./kinds.js";
import type { StandingRow } from "./standingRow.js";

/** The hold's reason as this build declares it. */
const HOLD_REASON =
  "held until the owner's yes on the error-tracking proposal to the teams it posts to — the batch posts " +
  "to team channels, so it waits on the room agreeing to the shape";

/**
 * The row's definition for one recipe id.
 *
 * @param recipeId the store key, derived from the repository's name and never moved once a row has fired
 * @returns the definition as it stands in the store
 */
function errorTrackingBatchDefinition({ recipeId }: { recipeId: string }): RecipeDefinition {
  return {
    cadence: "0 9 * * 1",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    hold: {
      askedIso: "2026-09-29T00:32:24.414Z",
      clearedBy: null,
      reason: HOLD_REASON,
    },
    kind: ERROR_TRACKING_BATCH_KIND,
    onMissed: "skip",
    params: {
      argv: [
        "datadog",
        "errors",
        "--query",
        prodEnvFilter(),
        "--from",
        "7d",
        "--state",
        "for-review",
        "--order",
        "count",
        "--limit",
        "20",
      ],
    },
    recipeId,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  };
}

/**
 * The weekly Error Tracking fix batch for one team repository — about five pull requests off the top of For
 * Review.
 *
 * The batch triages the top error patterns over a window, shaped like the security and dependency bump batches: each
 * pull request carries the user-facing impact, the blast radius and the options, and is posted to the owning team's
 * channel. **A seated kind**, for the reason `bump-fix-slopweaver` is: the row's run is the `datadog errors`
 * WORKLIST, read in seconds, and choosing an issue, measuring who it reaches and writing its fix is a visible
 * session's (`AGENTS.md` rule 2). The session follows `skills/automation/reference/error-tracking-batch.md` and runs
 * this row's claimed `run-due` LAST.
 *
 * **Declared HELD.** The batch reaches team channels, so it ships behind the owner's yes on a proposal to the teams it
 * posts to — the declaration carries a `RecipeHold` only the owner's anchored word lifts, and `automation due`
 * renders it held rather than due. **`--order count` over seven days** is the blast-radius list; the session reads
 * `--order newest` itself for the regressions half. **`0 9 * * 1`, `onMissed: "skip"`**: Monday 09:00 the owner's
 * time, and a missed week is the same For Review list a week older. **No `--repo`**: `datadog errors` reads the
 * organisation's Error Tracking, not a repository, so the repository is the batch's identity — its recipe id —
 * rather than a flag.
 *
 * **Both production env spellings**, from `prodEnvFilter()`: backends can emit `production` while browser apps emit
 * `prod`, so `env:production` alone drops browser issues the moment a track carries them —
 * `slopweaver datadog errors --track rum --query env:prod --from 7d --state for-review` read dozens that
 * `env:production` never returns.
 *
 * @param repositoryName the lower-case repository name after the `/`, which keys the recipe id
 * @returns the declared row
 */
export function standingErrorTrackingRow({ repositoryName }: { readonly repositoryName: string }): StandingRow {
  return {
    definition: errorTrackingBatchDefinition({ recipeId: `error-tracking-batch-${repositoryName}` }),
    why:
      "nothing else turns Error Tracking's For Review list into fixes — measured at at least 100 open issues over " +
      "a day, median age 97 days — so without this row, once the owner lifts the hold, the weekly batch they " +
      "asked for never raises",
  };
}
