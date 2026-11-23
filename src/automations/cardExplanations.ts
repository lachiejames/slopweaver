/**
 * The failure-explanations register as the Automations report reads it: once for every card, and then one row's
 * share of it. Its own module so `./read.ts`, which folds every store a card draws on, stays one a reader can hold.
 */
import { explanationsByRecipe, readFailureExplanations } from "../live/automation/failureExplanation.js";

/**
 * What visible sessions said went wrong with each failed firing, by row. An unreadable register, or a line in it
 * that is not an explanation, is said into `issues`; the rows then lead with their scheduler sentence.
 *
 * @param issues where a register that read in part or not at all is said
 * @returns recipe id → firing key → the sentence, empty unless every line read
 */
export function explanationsOrIssue({
  home,
  issues,
}: {
  home: string;
  issues: string[];
}): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const read = readFailureExplanations({ home });
  if (read.isErr()) {
    issues.push(read.error.message);
    return new Map();
  }
  if (read.value.unparsed.length > 0) {
    issues.push(
      `the failure explanations register has ${String(read.value.unparsed.length)} unreadable line(s): ` +
        read.value.unparsed.join(", "),
    );
    // A torn line may be the sentence for the very firing a card would lead with, so a register read in part speaks
    // for none.
    return new Map();
  }
  return explanationsByRecipe({ explanations: read.value.explanations });
}

/**
 * One row's explanations out of the register read once for every card; a row nobody explained has none.
 *
 * @param explanations every row's, from {@link explanationsOrIssue}
 * @returns firing key → the sentence, for this row only
 */
export function explanationsOf({
  explanations,
  recipeId,
}: {
  explanations: ReadonlyMap<string, ReadonlyMap<string, string>>;
  recipeId: string;
}): ReadonlyMap<string, string> {
  const mine = explanations.get(recipeId);
  if (mine === undefined) {
    return new Map();
  }
  return mine;
}
