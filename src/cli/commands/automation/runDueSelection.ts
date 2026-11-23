/**
 * Which rows one `automation run-due` tick judges, and which of those it runs. PURE.
 *
 * The narrowing `--recipe` does and the pairing of each due row with its firing are the tick's selection: both
 * read only the parsed roster and the due verdicts, so they sit apart from the verb that loads, runs and
 * reports (`./runDue.ts`).
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import type { RecipeDueVerdict } from "../../../live/automation/definitionDue.js";

/** Which rows one tick will judge, and the `--recipe` id that matched nothing when one did not. */
export interface RecipeRowSelection {
  readonly definitions: readonly RecipeDefinition[];
  /** Every parsed row, unnarrowed: what an owed or lost finding is read against, whichever row `--recipe` named. */
  readonly roster: readonly RecipeDefinition[];
  /** The id `--recipe` named when the store carries no row by it; `null` when the selection resolved. */
  readonly unknownRecipeId: string | null;
}

/**
 * Narrow the roster to the row `--recipe` named, or hand back every row when it named none.
 *
 * The narrowing happens BEFORE the due judgement rather than after it, and that is the whole point of the
 * flag: a tick prints one verdict line per row it judged, so narrowing afterwards would still print 44
 * lines to run one of them. `judgeRecipeDue` reads one row and its own stamp and nothing else, so judging a
 * subset gives each surviving row exactly the verdict it would have had in a full sweep.
 *
 * A duplicated recipeId selects BOTH rows, matching what an un-narrowed tick already does with the same
 * store — a copied definition file is a real failure this build has seen (`definitionStore.ts` carries it),
 * and hiding one half of it behind a selector would make that failure harder to see rather than easier.
 *
 * @param definitions every row the store parsed, in store order
 * @param recipeId the id `--recipe` named, or `null` for every row
 * @returns the rows to judge, and the unmatched id when there was one
 */
export function selectRecipeRows({
  definitions,
  recipeId,
}: {
  definitions: readonly RecipeDefinition[];
  recipeId: string | null;
}): RecipeRowSelection {
  if (recipeId === null) {
    return { definitions, roster: definitions, unknownRecipeId: null };
  }
  const named = definitions.filter((definition) => definition.recipeId === recipeId);
  if (named.length === 0) {
    return { definitions: [], roster: definitions, unknownRecipeId: recipeId };
  }
  return { definitions: named, roster: definitions, unknownRecipeId: null };
}

/**
 * The due rows paired with the firing each covers. PURE.
 *
 * `judgeRecipeDefinitions` answers one verdict per row IN ORDER, so the pairing is by position — never by id,
 * because a duplicated recipeId is a real store state and an id lookup would hand both rows one slot.
 *
 * @param definitions the rows that were judged, in store order
 * @param verdicts one verdict per row, in the same order
 * @returns each due row with its slot, in store order
 */
export function dueFirings({
  definitions,
  verdicts,
}: {
  definitions: readonly RecipeDefinition[];
  verdicts: readonly RecipeDueVerdict[];
}): readonly { readonly definition: RecipeDefinition; readonly slotIso: string }[] {
  return definitions.flatMap((definition, index) => {
    const verdict = verdicts[index]!;
    return verdict.due && verdict.slotIso !== null ? [{ definition, slotIso: verdict.slotIso }] : [];
  });
}
