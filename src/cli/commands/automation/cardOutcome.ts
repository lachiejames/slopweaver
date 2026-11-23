/**
 * What a CARD row's outcome line says once its post leg has run — shared by both card kinds and by a dry run.
 *
 * Split out of `./rowRunners.ts` because that file is at its size ratchet, and this is a real seam: the two
 * card kinds differ in what they READ and what they may attach, and agree exactly on how the result reads.
 */
import { appendVerbFailureWhy } from "../../../live/automation/verbFailureWhy.js";
import { EXIT_OK } from "../../exitCodes.js";
import type { RowOutcome } from "./rowRunners.js";

/**
 * The outcome of a card row once its post leg has run — the same shape for both card kinds, and for a dry run.
 *
 * @param base the outcome fields every row shares
 * @param recipeId the row that ran
 * @param legs the two verbs this row composes, for the line
 * @param posted the post leg's exit code
 * @param diagnostics what the post leg wrote to stderr, appended as its cause only when it failed
 * @param dryRun whether the card was rendered and withheld
 * @param problem a declared recommendations lane that could not be supplied, stated rather than swallowed
 * @returns the row's outcome
 */
export function cardOutcome({
  base,
  recipeId,
  legs,
  posted,
  diagnostics,
  dryRun,
  problem,
}: {
  base: Omit<RowOutcome, "line">;
  recipeId: string;
  legs: string;
  posted: number;
  diagnostics: string;
  dryRun: boolean;
  problem: string | undefined;
}): RowOutcome {
  const lane = laneClause({ problem });
  const failed = posted !== EXIT_OK;
  const said = ({ line }: { line: string }): string => (failed ? appendVerbFailureWhy({ diagnostics, line }) : line);
  if (dryRun) {
    return {
      ...base,
      failed,
      line: said({ line: `recipe ${recipeId} · would post · ${legs} --dry-run · exit ${String(posted)}${lane}` }),
    };
  }
  return {
    ...base,
    exitCode: posted,
    failed,
    line: said({ line: `recipe ${recipeId} · ran · ${legs} · exit ${String(posted)}${lane}` }),
    ran: true,
  };
}

/**
 * The outcome line's tail when a row DECLARED a recommendations lane its own set could not supply.
 *
 * The card still posts — see `recommendationsDocumentOf` — so this is the one place a reader learns the
 * lane was dropped, and it rides the line the tick already prints rather than a channel nobody reads.
 *
 * @param problem the stated reason, absent when the lane is fine or was never declared
 * @returns the clause to append, or nothing
 */
function laneClause({ problem }: { problem: string | undefined }): string {
  if (problem === undefined) {
    return "";
  }
  return ` · ${problem}`;
}
