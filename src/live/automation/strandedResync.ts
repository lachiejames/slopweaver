/**
 * A row that RUNS a resync while carrying a kind no seat will ever pick up — the one state `automation due`
 * could not say out loud, and the reason it now says it first.
 *
 * ## The measurement
 *
 * A resync is seated rather than run in the calling process, and
 * `./definitionShape.ts` answers `spawn` only for the seated kinds — `resync` is the one a resync
 * row is written on. `automation seat` selects on that answer. So a resync row whose kind no seat picks up is not
 * merely slow — it is unreachable, and nothing in the schedule is wrong enough to say so.
 *
 * MEASURED on one install. A hand repair the night before had moved 44 managed resync rows
 * aside and re-run `register-resyncs`, recreating every one on `verb-run`. `slopweaver automation due` then
 * read `43 actionable · 0 want a session · 0 claimed · 66 row(s) read` while all 43 rows were 2.2 hours
 * late with between 4 and 19 firings missed each, every atlas behind and every corpus source drifting.
 * `automation seat` exited 3 — "nothing needs a session — no actionable row is spawn-shaped" — which is the
 * same exit it gives on a healthy install with nothing due. The tally line read like health because every
 * number in it WAS healthy: the rows were there, they parsed, they were due, and they were actionable. The
 * one thing that had changed was a field no line summarised.
 *
 * ## Why this is a line in `automation due` rather than a monitor card
 *
 * `../../monitor/registry.ts` declares that "a condition a session would simply fix is not a monitor", and
 * the hand register REFUSES a sentence naming the fleet as its actor. Seating a resync, and repairing a row
 * with `register-resyncs`, are both a supervisor pass's own acts — so a card here would be
 * refused at runtime, and rightly. `automation due` is what every pass already reads, which is the same
 * reasoning `skills/automation/reference/declared-rows.md` used to put a GONE row at the top of this
 * output.
 *
 * ## A run-here resync is stranded only when this build SEATS its target
 *
 * A compile-only atlas's row is written on `verb-run` on purpose (`live/resync/registrationPlan.ts`): its sync
 * walks no account, needs no model and runs in seconds once cached, so the chair runs it in its own tick with
 * no seat. That row is run-here and healthy. So the caller passes the ids this build writes for the tick, and only a
 * run-here resync row that is not exactly one of them — its id, its kind and the atlas its argv runs — is
 * stranded, which is still exactly the measured state, where every seated target had been rewritten onto
 * `verb-run`.
 *
 * Pure: a parsed definition in, a verdict out. No I/O.
 */
import { canonicalNoun } from "../../cli/nounAliases.js";
import { resyncRecipeId } from "../resync/target.js";
import type { RecipeDefinition } from "./definition.js";
import { runShapeForDefinition } from "./definitionShape.js";
import { planVerbRun, VERB_RUN_KIND } from "./verbRun.js";

/**
 * Whether this row runs a resync that no seat can pick up.
 *
 * The argv is read through {@link planVerbRun} rather than out of `params` directly, because `params` is
 * `Record<string, unknown>` by construction and the planner is what decides whether a row's argv is a real
 * one. A row whose params REFUSE to parse answers false here: the planner already reports that refusal with
 * the field and the reason, and a second verdict about the same row would have two lines of one report
 * disagree — the judgement `./definitionShape.ts` makes for the same reason.
 *
 * The row's SHAPE is what is asked, never a kind named here: "no seat can reach it" is exactly "its shape is not
 * `spawn`", and a kind list spelled in this file would go stale the day a second seated kind joined — which
 * happened when `bump-fix` did. A resync whose shape reads `run-here` is the stranded state
 * itself, the conflation that let 43 rows read as healthy.
 *
 * @param definition the parsed row
 * @param tickResyncIds the managed resync rows this build runs in the chair's tick rather than seats
 * @returns true when the row's argv is a `automation resync` invocation, no seat can pick its kind up, and this
 *   build does not run it in the tick
 */
export function isStrandedResyncRow({
  definition,
  tickResyncIds,
}: {
  readonly definition: RecipeDefinition;
  readonly tickResyncIds: readonly string[];
}): boolean {
  if (runShapeForDefinition({ definition }) === "spawn") {
    return false;
  }
  const plan = planVerbRun({ definition });
  if (plan.isErr()) {
    return false;
  }
  const argv = plan.value.argv;
  // A managed resync row's argv opens `recipe resync` (`live/resync/registrationPlan.ts#resyncArgv`), and
  // either noun runs it.
  const noun = argv[0];
  if (noun === undefined || canonicalNoun({ noun }) !== "automation" || argv[1] !== "resync") {
    return false;
  }
  return !runsItsOwnTickTarget({ argv, definition, tickResyncIds });
}

/**
 * Whether a run-here resync row is exactly the one this build runs in the tick for its id.
 *
 * All three are asked, and each closes a hand edit the others miss: the KIND, so a tick id moved onto
 * `investigate` is still a row nothing dispatches as a resync; the ID, so a seated target rewritten onto
 * `verb-run` is the stranded state; and the TARGET the argv runs, so `resync-atlas-airtable` edited to run
 * `--atlas clerk` does not carry clerk's browser walk into an unattended tick under airtable's exemption
 * (a hand edit that review found).
 */
function runsItsOwnTickTarget({
  argv,
  definition,
  tickResyncIds,
}: {
  readonly argv: readonly string[];
  readonly definition: RecipeDefinition;
  readonly tickResyncIds: readonly string[];
}): boolean {
  if (definition.kind !== VERB_RUN_KIND || !tickResyncIds.includes(definition.recipeId)) {
    return false;
  }
  const platform = argv[3];
  if (argv.length !== 4 || argv[2] !== "--atlas" || platform === undefined) {
    return false;
  }
  return resyncRecipeId({ target: { kind: "atlas", platform } }) === definition.recipeId;
}

/**
 * Every row in one store read that is stranded, by recipe id, in the order they were read.
 *
 * @param definitions every row the store parsed
 * @param tickResyncIds the managed resync rows this build runs in the chair's tick rather than seats
 * @returns the recipe ids no seat can reach
 */
export function strandedResyncIds({
  definitions,
  tickResyncIds,
}: {
  readonly definitions: readonly RecipeDefinition[];
  readonly tickResyncIds: readonly string[];
}): readonly string[] {
  return definitions
    .filter((definition) => isStrandedResyncRow({ definition, tickResyncIds }))
    .map((row) => row.recipeId);
}

/**
 * The one line `automation due` prints above its rows when something is stranded.
 *
 * Phrased as the repair rather than as the symptom, because the reader of this line is the pass that can
 * type it. It names the count and one example id: a reader who has just been told 43 rows are unreachable
 * needs one to go and look at, and listing all 43 would reproduce the wall of lines this line exists to
 * replace.
 *
 * @param recipeIds the stranded rows, which must not be empty — the caller decides whether to print at all
 * @returns the line
 */
export function strandedResyncLine({ recipeIds }: { readonly recipeIds: readonly string[] }): string {
  const count = recipeIds.length;
  const example = recipeIds[0];
  return (
    `!! ${String(count)} row(s) run \`automation resync\` on a kind no seat picks up (e.g. ${String(example)}), ` +
    `so \`automation seat\` can never reach them however late they get — ` +
    "repair with `slopweaver automation register-resyncs`"
  );
}
