/**
 * The `--limit` bound of one `automation run-due` tick, judged before a firing is taken.
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import type { RowOutcome } from "./rowRunners.js";

/**
 * Whether this tick's own bound stops it starting one more row.
 *
 * The bound is what keeps a tick from holding the calling session for as long as every overdue row takes
 * together. It is deliberately judged BEFORE the firing is taken: a row past the limit has not been
 * attempted, so consuming one of its three attempts would spend it on a tick that never ran it.
 *
 * @param definition the due row
 * @param limit this tick's own bound, or `null` for every due row
 * @param started how many rows this tick has already begun
 * @returns the outcome to report instead of running, or `null` when the row may be taken
 */
export function limitOutcome({
  definition,
  limit,
  started,
}: {
  definition: RecipeDefinition;
  limit: number | null;
  started: number;
}): RowOutcome | null {
  if (limit === null || started < limit) {
    return null;
  }
  return {
    detail: [],
    exitCode: null,
    failed: false,
    line: `recipe ${definition.recipeId} · still due · past this tick's --limit of ${String(limit)}`,
    ran: false,
    recipeId: definition.recipeId,
  };
}
