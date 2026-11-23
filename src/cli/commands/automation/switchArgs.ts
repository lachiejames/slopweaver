/**
 * `automation enable` and `automation disable`'s own argv tail, parsed into one switch with its word — pure, so the
 * verbs' flag contract is tested without a home.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { SwitchDirection } from "../../../live/automation/rowSwitch.js";
import { parseFlags } from "../../parseFlags.js";
import { str } from "./core.js";
import { type RecipeCommandError, RecipeCommandErrors } from "./errors.js";
import { RECIPE_SWITCH_FLAG_SPEC } from "./switchUsage.js";

/** The resolved invocation. */
export interface SwitchOptions {
  readonly direction: SwitchDirection;
  readonly recipeId: string;
  readonly anchor: string;
  readonly words: string;
  readonly why: string;
  readonly dryRun: boolean;
  readonly home: string;
}

/**
 * Parse one direction's own tail.
 *
 * @param direction which verb was typed
 * @param rest the argv tail after `automation enable` or `automation disable`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or the reason the invocation was rejected
 */
export function parseSwitchArgs({
  direction,
  rest,
  defaultHome,
}: {
  readonly direction: SwitchDirection;
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<SwitchOptions, RecipeCommandError> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: [...RECIPE_SWITCH_FLAG_SPEC.boolean], string: [...RECIPE_SWITCH_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { positionals, values } = parsed.value;
  const recipeId = positionals[0];
  if (recipeId === undefined || positionals.length > 1) {
    return err(RecipeCommandErrors.switchRecipeIdMissing({ verb: direction }));
  }
  const anchor = str({ key: "anchor", values });
  const words = str({ key: "words", values });
  const why = str({ key: "why", values });
  if (anchor === undefined) {
    return err(RecipeCommandErrors.switchFlagMissing({ flag: "--anchor", verb: direction }));
  }
  if (words === undefined) {
    return err(RecipeCommandErrors.switchFlagMissing({ flag: "--words", verb: direction }));
  }
  if (why === undefined) {
    return err(RecipeCommandErrors.switchFlagMissing({ flag: "--why", verb: direction }));
  }
  const home = typeof values["home"] === "string" ? values["home"] : defaultHome;
  return ok({ anchor, direction, dryRun: values["dry-run"] === true, home, recipeId, why, words });
}
