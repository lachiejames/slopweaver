/**
 * `automation claim`'s own argv tail, parsed into a claim or a release.
 *
 * Split from `./claim.ts` along the parse/act seam: nothing here reads the ledger or takes a lease.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_CLAIM_FLAG_SPEC, str } from "./core.js";
import { type RecipeCommandError, RecipeCommandErrors } from "./errors.js";

/**
 * The resolved invocation, as a union rather than a bag with a `release` flag.
 *
 * A single shape would carry a `claimedBy` that is meaningless on a release, and the only way to spell that
 * is an empty string — which is the coalesce the house rules ban, and rightly: a lease held by `""` reads
 * as a lease held by nobody. Two members make the field exist exactly where it means something.
 */
export type RecipeClaimOptions =
  | { readonly kind: "claim"; readonly recipeId: string; readonly claimedBy: string; readonly home: string }
  | {
      readonly kind: "release";
      readonly recipeId: string;
      readonly home: string;
      /**
       * The exit code the run finished with, or `null` for a spawn that never happened.
       *
       * This is the difference between the two things a release can mean. With an exit code the firing is
       * SETTLED — and the watermark moves only if the firing is finished with. Without one, the firing is
       * given back exactly as it was found, which is what a spawn that failed to start should leave behind.
       */
      readonly exitCode: number | null;
      /** The token the lease was minted with, required whenever a release settles. */
      readonly claimId: string | null;
    };

/**
 * Parse this verb's own tail.
 *
 * `--by` is required for a claim and meaningless for a release, which is checked here rather than left to
 * the caller: a lease held by nobody is a row nothing can be chased through.
 *
 * @param rest the argv tail after `automation claim`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseRecipeClaimArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RecipeClaimOptions, RecipeCommandError> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: [...RECIPE_CLAIM_FLAG_SPEC.boolean], string: [...RECIPE_CLAIM_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const recipeId = parsed.value.positionals[0];
  if (recipeId === undefined) {
    return err(RecipeCommandErrors.recipeIdMissing());
  }
  const release = parsed.value.values["release"] === true;
  const claimedBy = str({ key: "by", values: parsed.value.values });
  if (!release && claimedBy === undefined) {
    return err(RecipeCommandErrors.claimantMissing());
  }
  const home = claimHome({ defaultHome, values: parsed.value.values });
  if (release) {
    return releaseOptions({ home, recipeId, values: parsed.value.values });
  }
  return ok({ claimedBy: claimedBy!, home, kind: "claim", recipeId });
}

/**
 * The state home the lease is taken in: `--home` when given, else the caller's default home.
 *
 * @param values the parsed flag values
 * @param defaultHome the home to use when the caller named none
 * @returns the home this claim or release runs against
 */
function claimHome({
  values,
  defaultHome,
}: {
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly defaultHome: string;
}): string {
  const named = str({ key: "home", values });
  if (named === undefined) {
    return defaultHome;
  }
  return named;
}

/**
 * The lease token `--claim-id` carried, or `null` when none was passed: a bare release needs none, and a
 * settling one is refused by its caller.
 *
 * @param values the parsed flag values
 * @returns the token, or `null` when the flag was not given
 */
function leaseToken({ values }: { readonly values: Readonly<Record<string, string | boolean>> }): string | null {
  const given = str({ key: "claim-id", values });
  if (given === undefined) {
    return null;
  }
  return given;
}

/**
 * The release half of the tail: an exit code makes it a FINISH, and a finish must quote its lease token.
 *
 * Requiring the token only on the settling path is deliberate rather than a half-measure. A bare
 * `--release` is tidy-up after a spawn that never started — it advances no clock and spends no attempt, so
 * the worst an unchecked one can do is give a firing back early. A settling release moves the schedule
 * forward, and that is the one another worker's successor must not be able to do by accident.
 *
 * @param home the resolved state home
 * @param recipeId the row being released
 * @param values the parsed flag values
 * @returns the resolved release options, or why the release was rejected
 */
function releaseOptions({
  home,
  recipeId,
  values,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly values: Readonly<Record<string, string | boolean>>;
}): Result<RecipeClaimOptions, RecipeCommandError> {
  const rawExit = str({ key: "exit-code", values });
  const claimId = leaseToken({ values });
  if (rawExit === undefined) {
    return ok({ claimId, exitCode: null, home, kind: "release", recipeId });
  }
  const exitCode = Number(rawExit);
  if (!Number.isInteger(exitCode)) {
    return err(RecipeCommandErrors.exitCodeNotInteger({ got: rawExit }));
  }
  if (claimId === null) {
    return err(RecipeCommandErrors.settlingClaimIdMissing());
  }
  return ok({ claimId, exitCode, home, kind: "release", recipeId });
}
