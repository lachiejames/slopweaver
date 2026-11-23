/**
 * `automation repoint`'s own argv tail, parsed — pure, so the verb's flag contract is tested without a home.
 */
import { err, ok, type Result } from "#lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { type RecipeCommandError, RecipeCommandErrors } from "./errors.js";
import { RECIPE_REPOINT_FLAG_SPEC } from "./repointUsage.js";

/** The resolved invocation. */
export interface RepointOptions {
  readonly recipeId: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation repoint`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or the reason the invocation was rejected
 */
export function parseRepointArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RepointOptions, RecipeCommandError> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: [...RECIPE_REPOINT_FLAG_SPEC.boolean], string: [...RECIPE_REPOINT_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { positionals, values } = parsed.value;
  const recipeId = positionals[0];
  if (recipeId === undefined || positionals.length > 1) {
    return err(RecipeCommandErrors.repointRecipeIdMissing());
  }
  const home = typeof values["home"] === "string" ? values["home"] : defaultHome;
  return ok({ dryRun: values["dry-run"] === true, home, json: values["json"] === true, recipeId });
}
