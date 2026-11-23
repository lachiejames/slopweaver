/**
 * What one row asks for, read off its own definition: the wording a card and its timeline show, and the corpus
 * source a resync row syncs. Split out of `./card.ts`, which shows both, as `./purpose.ts`, `./read.ts` and
 * `./readOutputs.ts` read them.
 */
import type { RecipeDefinition } from "../live/automation/definition.js";

/**
 * What the row asks for, in its own words: an investigation's question, else its verb's argv, else its kind.
 *
 * @param definition the row
 * @returns the wording a card and its timeline show
 */
export function whatOf({ definition }: { definition: RecipeDefinition }): string {
  const question = definition.params["question"];
  if (typeof question === "string" && question.length > 0) {
    return question;
  }
  const argv = definition.params["argv"];
  if (Array.isArray(argv) && argv.every((part): part is string => typeof part === "string")) {
    return `slopweaver ${argv.join(" ")}`;
  }
  return `a ${definition.kind} row`;
}

/**
 * The corpus source a resync row syncs, read off its own argv — never off a naming convention alone, so an atlas
 * resync whose id happens to look similar is not mistaken for one.
 *
 * @param definition the row
 * @returns the `--source` it passes, or `null` for anything that is not a corpus resync
 */
export function corpusSourceOf({ definition }: { definition: RecipeDefinition }): string | null {
  const argv = definition.params["argv"];
  if (!Array.isArray(argv) || !argv.includes("resync")) {
    return null;
  }
  if (!definition.recipeId.startsWith("resync-corpus-")) {
    return null;
  }
  const at = argv.indexOf("--source");
  const source = argv[at + 1];
  if (at < 0 || typeof source !== "string") {
    return null;
  }
  return source;
}
