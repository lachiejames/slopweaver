/**
 * The `metrics-push` kind's executor: produce the slot day's payload, then submit it through the door.
 *
 * Beside `./rowRunners.ts` rather than in it for the reason `./cardRowRunners.ts` is: everything a kind's
 * executor needs arrives through `RecipeRunDueDeps`, so an executor is a leaf that dispatch can name, and
 * the dispatcher's file stays about dispatch. Its seam differs from the card kinds' — the produce leg writes a
 * FILE rather than a form on stdout — so it is not folded into their runner either.
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import {
  metricsPushProduceArgv,
  metricsPushSubmitArgv,
  planMetricsPush,
  slotUtcDay,
} from "../../../live/automation/metricsPush.js";
import { appendVerbFailureWhy } from "../../../live/automation/verbFailureWhy.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { RecipeRunDueDeps, RowOutcome } from "./rowRunners.js";

/**
 * The exit code a leg's ending settles the firing with: only a zero retires it.
 *
 * `settleSlot` retires an `EXIT_EXPECTED_EMPTY` (3) exactly as it does a zero, which is right for a verb
 * that looked and found nothing to do. Neither leg here has that ending. `datadog produce` refuses with 3
 * when the producer is undeclared or a secret is absent, and its output contract demands at least one
 * series, so an empty day cannot reach submit; `datadog submit` answers 3 for absent credentials and a door
 * refusal, both of which sent nothing. Carrying a 3 through would stamp a firing whose points never reached
 * Datadog, so it becomes a failure: retried, then dead-lettered where somebody sees it. A deferral (4)
 * passes through, because not-yet is exactly what it says.
 *
 * @param exit the leg's own exit code
 * @returns the code the firing is settled with
 */
export function metricsPushSettleCode({ exit }: { exit: number }): number {
  if (exit === EXIT_OK || exit === EXIT_DEFERRED) {
    return exit;
  }
  return EXIT_ERROR;
}

/**
 * Run one `metrics-push` row: produce the slot day's payload, then submit it through the door.
 *
 * The third two-leg kind, and deliberately not folded into the two card kinds' runners for the reason
 * their own comments give. What differs here is the seam: the produce leg writes a FILE rather than a form
 * on stdout, because its output may be thousands of series and the door already reads a path, so both legs go
 * through `deps.runVerbKeepingDiagnostics` and only a leg's stderr tail is kept, so a failed leg's line says why.
 *
 * `--dry-run` RUNS the produce leg for real — the producer's own reads, like a digest's read — and stops
 * at `datadog submit --dry-run`, which prints the UTC days and counts it would have stamped. A dry run is
 * never stamped: `ran` stays false, so the row is still due and a real tick will send it.
 *
 * @param definition the due row
 * @param deps the injected edges
 * @param dryRun whether to withhold the submission at the wire
 * @param home the state home this tick is running over
 * @param base the shared not-yet-run outcome fields
 * @param slotIso the firing this run covers — the UTC day it stamps
 * @returns what happened, ready to print
 */
export async function runMetricsPushRow({
  definition,
  deps,
  dryRun,
  home,
  base,
  slotIso,
}: {
  definition: RecipeDefinition;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  home: string;
  base: Omit<RowOutcome, "line">;
  slotIso: string;
}): Promise<RowOutcome> {
  const plan = planMetricsPush({ definition });
  if (plan.isErr()) {
    return { ...base, failed: true, line: `recipe ${definition.recipeId} · REFUSED · ${plan.error.message}` };
  }
  const day = slotUtcDay({ slotIso });
  const produce = `datadog produce --producer ${plan.value.producer} --day ${day}`;
  const legs = `${produce} → datadog submit --allow-late`;
  const produced = await deps.runVerbKeepingDiagnostics(metricsPushProduceArgv({ home, plan: plan.value, slotIso }));
  if (produced.exitCode !== EXIT_OK) {
    return {
      ...base,
      exitCode: metricsPushSettleCode({ exit: produced.exitCode }),
      failed: true,
      line: appendVerbFailureWhy({
        diagnostics: produced.diagnostics,
        line:
          `recipe ${definition.recipeId} · PRODUCE FAILED · ${produce} · ` +
          `exit ${String(produced.exitCode)} · nothing was submitted`,
      }),
      ran: true,
    };
  }
  const submitted = await deps.runVerbKeepingDiagnostics(
    metricsPushSubmitArgv({ dryRun, home, plan: plan.value, slotIso }),
  );
  return submittedOutcome({ base, dryRun, legs, recipeId: definition.recipeId, submitted });
}

/**
 * The outcome the submit leg's ending settles a row with. PURE. Only the SUBMIT leg's own stderr can name why
 * it failed; the produce leg's progress is never its cause, and a submit that worked is never annotated.
 *
 * @param legs both legs as the line names them
 * @param submitted the submit leg's exit and its stderr tail
 * @returns the outcome — never stamped on a dry run, settled through {@link metricsPushSettleCode} on a real one
 */
function submittedOutcome({
  base,
  dryRun,
  legs,
  recipeId,
  submitted,
}: {
  base: Omit<RowOutcome, "line">;
  dryRun: boolean;
  legs: string;
  recipeId: string;
  submitted: { readonly exitCode: number; readonly diagnostics: string };
}): RowOutcome {
  const failed = submitted.exitCode !== EXIT_OK;
  const said = ({ line }: { line: string }): string =>
    failed ? appendVerbFailureWhy({ diagnostics: submitted.diagnostics, line }) : line;
  if (dryRun) {
    return {
      ...base,
      failed,
      line: said({
        line: `recipe ${recipeId} · would submit · ${legs} --dry-run · exit ${String(submitted.exitCode)}`,
      }),
    };
  }
  return {
    ...base,
    exitCode: metricsPushSettleCode({ exit: submitted.exitCode }),
    failed,
    line: said({ line: `recipe ${recipeId} · ran · ${legs} · exit ${String(submitted.exitCode)}` }),
    ran: true,
  };
}
