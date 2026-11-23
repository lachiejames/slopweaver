/**
 * `automation run-due`'s own argv tail, parsed into the options one tick runs under.
 *
 * Split from `./runDue.ts` along the parse/act seam: nothing here reads the store or runs a row.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_RUN_DUE_FLAG_SPEC } from "./core.js";
import { type RecipeCommandError, RecipeCommandErrors } from "./errors.js";

/** The resolved invocation. */
export interface RecipeRunDueOptions {
  readonly dryRun: boolean;
  /** At most this many due rows are run; the rest are reported as still due. `null` means every one. */
  readonly limit: number | null;
  /** Judge and run only the row carrying this id. `null` means every row in the store, as before. */
  readonly recipeId: string | null;
  /**
   * The claim token this process holds, which is what lets a SPAWN-shaped row run here.
   *
   * `null` — the ordinary tick — runs run-here rows only, and reports a spawn-shaped one as SEAT IT.
   */
  readonly claimId: string | null;
  /**
   * The graded captures to attach to a `datadog-alert-digest` row that asked for them.
   *
   * Empty on every ordinary tick. Non-empty only inside a seated session, which is why the parse refuses
   * it without `--claim-id`: the pictures are taken in the owner's own Chrome by a session that can see it, so a
   * tick offering some is describing a browser it does not have.
   */
  readonly media: readonly string[];
  readonly home: string;
}

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation run-due`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseRecipeRunDueArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<RecipeRunDueOptions, RecipeCommandError> {
  const parsed = parseFlags({
    args: rest,
    spec: { boolean: [...RECIPE_RUN_DUE_FLAG_SPEC.boolean], string: [...RECIPE_RUN_DUE_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const home = parsed.value.values["home"];
  const recipe = parsed.value.values["recipe"];
  const rawLimit = parsed.value.values["limit"];
  // An empty `--recipe ""` is deliberately NOT refused here. It carries through as an id, matches no row,
  // and is reported by the same "no row carries that id" refusal an ordinary typo gets — one path for one
  // class, rather than a second message saying the same thing about a narrower input.
  const claimId = parsed.value.values["claim-id"];
  const rawMedia = parsed.value.values["media"];
  const media = typeof rawMedia === "string" ? rawMedia.split(",").map((part) => part.trim()) : [];
  if (media.some((path) => path.length === 0)) {
    return err(RecipeCommandErrors.mediaPathEmpty({ got: String(rawMedia) }));
  }
  if (media.length > 0 && typeof claimId !== "string") {
    return err(RecipeCommandErrors.mediaWithoutClaim());
  }
  const base = {
    claimId: typeof claimId === "string" ? claimId : null,
    dryRun: parsed.value.values["dry-run"] === true,
    home: typeof home === "string" ? home : defaultHome,
    media,
    recipeId: typeof recipe === "string" ? recipe : null,
  };
  if (typeof rawLimit === "string") {
    const limit = Number.parseInt(rawLimit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      return err(RecipeCommandErrors.limitNotWhole({ got: rawLimit }));
    }
    return ok({ ...base, limit });
  }
  return ok({ ...base, limit: null });
}
