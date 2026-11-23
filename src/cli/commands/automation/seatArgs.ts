/**
 * `automation seat`'s own argv tail, parsed into the options one seat runs under.
 *
 * Split from `./seat.ts` along the parse/act seam: nothing here reads the store, claims a row or opens a
 * session. The seat's order of operations stays in `./seat.ts`.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_SEAT_FLAG_SPEC, RECIPE_SEAT_USAGE } from "./core.js";

/** The resolved invocation. */
export interface RecipeSeatOptions {
  /** How many due rows this seat hands to one session. Required — see {@link RECIPE_SEAT_USAGE}. */
  readonly limit: number;
  /** The model the seated session runs on, named per `AGENTS.md` rule 5. */
  readonly model: string;
  /** Seat only the row carrying this id, or `null` for the most overdue rows in the ranking. */
  readonly recipeId: string | null;
  readonly dryRun: boolean;
  readonly home: string;
}

/**
 * Parse this verb's own tail.
 *
 * `--limit` and `--model` are both REQUIRED and neither has a default. The bound is the seating session's
 * judgement about how much one session should take, and the
 * model is named per rule 5 — a default for either would be this file quietly making a decision that
 * belongs to the session typing the command.
 *
 * @param rest the argv tail after `automation seat`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseRecipeSeatArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RecipeSeatOptions> {
  const parsed = parseFlags({
    args: rest,
    spec: { boolean: [...RECIPE_SEAT_FLAG_SPEC.boolean], string: [...RECIPE_SEAT_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const rawLimit = parsed.value.values["limit"];
  const rawModel = parsed.value.values["model"];
  const home = parsed.value.values["home"];
  const problems: string[] = [];
  const model = typeof rawModel === "string" && rawModel.length > 0 ? rawModel : null;
  if (model === null) {
    problems.push("--model names the model the seated session runs on, and is required (AGENTS.md rule 5)");
  }
  const limit = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : Number.NaN;
  if (!Number.isInteger(limit) || limit < 1) {
    problems.push(
      "--limit takes a whole number of rows, at least 1, and is required: one pass over about forty " +
        "targets took 2h40m on this install, and a claim expires at its row's own next firing",
    );
  }
  // `model === null` has already pushed a problem, so this returns the same list either way. It is spelled
  // as its own branch because a collected-problems list narrows nothing, and the alternative is an
  // assertion that would survive somebody deleting the check above.
  if (model === null) {
    return err(problems);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  const recipe = parsed.value.values["recipe"];
  return ok({
    dryRun: parsed.value.values["dry-run"] === true,
    home: typeof home === "string" ? home : defaultHome,
    limit,
    model,
    recipeId: typeof recipe === "string" ? recipe : null,
  });
}
