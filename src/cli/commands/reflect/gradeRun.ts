/**
 * `slopweaver reflect grade <finding-id> keep|adjust|drop [--why <text>] [--closed-by <anchor>] [--json]` —
 * record the owner's one word on a finding the miner surfaced, and what closed it.
 *
 * The thin shell over `reflect/grades.ts`. The owner only speaks to the supervisor, so the supervisor is the
 * session that runs this with the owner's word; the row lands in `ledgers/reflect/seen.jsonl`, where the next
 * `reflect brief` folds it — a `drop` never re-surfaces, and the per-source grade line moves.
 *
 * ## The exit-code contract
 *
 * | situation | code | why |
 * | --- | --- | --- |
 * | a bad flag, a missing id or a word outside keep/adjust/drop | `2` | refused before anything is read |
 * | no finding by that id in the ledger | `1` | nothing to grade — the caller named something that is not there |
 * | the append failed | `1` | the grade did not land, and saying it did is the defect this verb removes |
 * | written | `0` | including a keep on a dropped finding, which the output names as still dropped |
 */
import { logger } from "../../../lib/logger.js";
import { recordGrade } from "../../../reflect/grades.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseReflectGradeOptions } from "./gradeCore.js";
import { REFLECT_GRADE_USAGE } from "./usage.js";

/**
 * Run the `reflect grade` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runReflectGrade(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["grade"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REFLECT_GRADE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseReflectGradeOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: REFLECT_GRADE_USAGE });
    return EXIT_USAGE;
  }
  const { home, json, ...input } = parsed.value;
  const recorded = recordGrade({
    input: { ...input, tsIso: new Date().toISOString() },
    ...(home !== undefined ? { home } : {}),
  });
  if (recorded.isErr()) {
    recorded.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  const { row, stillDropped, priorSurfacings } = recorded.value;
  if (json) {
    logger.out({ line: JSON.stringify({ priorSurfacings, row, stillDropped }) });
    return EXIT_OK;
  }
  const closed = row.closedBy !== undefined ? `, closed by ${row.closedBy}` : "";
  logger.out({
    line: `reflect grade: ${row.id} graded ${row.disposition}${closed} (${row.source}, ${row.classKey}; surfaced ${String(priorSurfacings)} time(s) before)`,
  });
  if (stillDropped) {
    logger.out({ line: "  still dropped — a drop is terminal, so this grade is recorded and does not revive it" });
  }
  return EXIT_OK;
}

export const reflectGradeCommand = defineCommand({ run: runReflectGrade });
