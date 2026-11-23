/**
 * `automation retire`'s own argv tail, parsed into a retirement with its word or an undo — pure, so the verb's
 * flag contract is tested without a home.
 */
import { err, ok, type Result } from "#lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { str } from "./core.js";
import { type RecipeCommandError, RecipeCommandErrors } from "./errors.js";
import { RECIPE_RETIRE_FLAG_SPEC } from "./retireUsage.js";

/** The resolved invocation: a retirement with its word, or an undo. */
export type RetireOptions =
  | {
      readonly kind: "retire";
      readonly recipeId: string;
      readonly anchor: string;
      readonly words: string;
      readonly why: string;
      readonly home: string;
    }
  | { readonly kind: "undo"; readonly recipeId: string; readonly home: string };

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation retire`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or the reason the invocation was rejected
 */
export function parseRetireArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RetireOptions, RecipeCommandError> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: [...RECIPE_RETIRE_FLAG_SPEC.boolean], string: [...RECIPE_RETIRE_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { positionals, values } = parsed.value;
  const recipeId = positionals[0];
  if (recipeId === undefined || positionals.length > 1) {
    return err(RecipeCommandErrors.retireRecipeIdMissing());
  }
  const home = typeof values["home"] === "string" ? values["home"] : defaultHome;
  const anchor = str({ key: "anchor", values });
  const words = str({ key: "words", values });
  const why = str({ key: "why", values });
  if (values["undo"] === true) {
    if (anchor !== undefined || words !== undefined || why !== undefined) {
      return err(RecipeCommandErrors.retireUndoWithWord());
    }
    return ok({ home, kind: "undo", recipeId });
  }
  if (anchor === undefined) {
    return err(RecipeCommandErrors.retireFlagMissing({ flag: "--anchor" }));
  }
  if (words === undefined) {
    return err(RecipeCommandErrors.retireFlagMissing({ flag: "--words" }));
  }
  if (why === undefined) {
    return err(RecipeCommandErrors.retireFlagMissing({ flag: "--why" }));
  }
  return ok({ anchor, home, kind: "retire", recipeId, why, words });
}
