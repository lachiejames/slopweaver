/**
 * The unseated-recipe-failure gate's refusal text — the predicate is `../../../supervisor/recipeFailureGate.ts`,
 * and `./tickRecordGates.ts` runs it beside the six gates before it.
 *
 * Every owed row prints, never a capped list: a broken integration is a handful of rows at most, and the one the
 * chair cannot see is the one that sat for twelve hours. A repoless row prints `handover set-repo` BEFORE its
 * spawn, because `cmux spawn` refuses a row naming no `repo:` — the exact failure the owner would otherwise watch.
 */
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { judgeRecipeFailures, type RecipeFailureVerdict } from "../../../supervisor/recipeFailureGate.js";
import type { SupervisorTickDraft } from "./tickRecordCore.js";

/**
 * Render the refusal for every recipe failure finding a tick left unseated, with the commands that seat each.
 *
 * @param verdict the refused verdict, carrying each row's standing and whether it names a repo
 * @returns the hatch's four lines, one line and its commands per row, and the reason shape that answers instead
 */
export function recipeFailureRefusalLines({
  verdict,
}: {
  verdict: RecipeFailureVerdict & { kind: "refused" };
}): readonly string[] {
  const named = verdict.rows.flatMap((row) => {
    const spawn = `    slopweaver cmux spawn ${row.id} --model opus`;
    if (!row.repoless) {
      return [`  ${row.id} (${row.standing})`, spawn];
    }
    return [
      `  ${row.id} (${row.standing}, names no repo: — cmux spawn refuses it until it does)`,
      `    slopweaver handover set-repo ${row.id} --repo <main checkout>`,
      spawn,
    ];
  });
  return [
    ...hatchRefusalLines({
      detail: `this tick read ${String(verdict.rows.length)} broken automation finding(s) with no seat, no spawn and no reason`,
      hatch: hatchFor({ id: "unseated-recipe-failure" }),
    }),
    ...named,
    'Record each spawn as a `spawned` action whose subject is {"kind":"handover","id":"<slug>"}, or record a ' +
      "hold-rationale judgement with that subject saying why this tick leaves the broken automation unrepaired. " +
      "Capacity is not a reason on its own here: a failing integration is owed a seat whatever the machine says.",
  ];
}

/**
 * Run the unseated-recipe-failure gate, returning the lines to print when it refuses.
 *
 * @param draft the parsed draft, whose actions and judgements can answer a row
 * @param reconciliation the reconciliation document, already read
 * @returns the refusal's lines, or `undefined` when the tick may be recorded
 */
export function recipeFailureRefusal({
  draft,
  reconciliation,
}: {
  draft: SupervisorTickDraft;
  reconciliation: unknown;
}): readonly string[] | undefined {
  const verdict = judgeRecipeFailures({ actions: draft.actions, judgements: draft.judgements, reconciliation });
  if (verdict.kind === "clean") {
    return undefined;
  }
  if (verdict.kind === "unreadable") {
    return [
      ...hatchRefusalLines({
        detail: `the unseated-recipe-failure gate could not judge this tick — ${verdict.why}`,
        hatch: hatchFor({ id: "unseated-recipe-failure" }),
      }),
      "Re-run `slopweaver handover reconcile --json` with this checkout into this tick's --reconcile and re-draft. " +
        "Neither a spawn nor a hold-rationale answers THIS arm — the gate refuses before it reads either.",
    ];
  }
  return recipeFailureRefusalLines({ verdict });
}
