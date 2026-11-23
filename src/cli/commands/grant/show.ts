/**
 * `slopweaver grant show` — what the executing session reads BEFORE it acts.
 *
 * It prints the row and then the checks, because a session that is handed only the row will weigh it and a
 * session that is handed the checks will run them. Every computable check has already been run by the time
 * this prints: an unresolvable anchor, a spent row or an absent target comes back as a TYPED refusal naming
 * the check, not as a row with a caveat attached.
 *
 * The two checks it cannot make are stated rather than omitted. Whether the change is the one this session is
 * about to write is answered by `grant perform`, which compares byte for byte; whether acting would cross a
 * rail is judgement, and belongs to the session (`grant refuse --check RAIL_CROSSED`).
 */
import { GRANT_CHECK_CODES } from "../../../grants/errors.js";
import { type GrantEntry, type GrantRow, performancesOf, refusalsOf, renderTarget } from "../../../grants/grant.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { checkRow } from "./checkRow.js";
import { grantUsage, parseGrantShowArgs, VERB_ARG_OFFSET } from "./core.js";
import { type GrantCommandDeps, productionGrantCommandDeps, reportGrantStoreError } from "./deps.js";

/**
 * Run `grant show` over the store-backed journal.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runGrantShow(argv: readonly string[]): Promise<number> {
  return runGrantShowWithDeps({ argv, deps: productionGrantCommandDeps() });
}

/**
 * Run `grant show` over whichever journal it is handed.
 *
 * @param argv the full process argv
 * @param deps the journal port
 * @returns the process exit code — non-zero when a check on the row failed, which is a finding rather than a
 *   fault, or when the store could not be read, which is a fault
 */
export async function runGrantShowWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GrantCommandDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: grantUsage({ verb: "show" }) });
    return EXIT_OK;
  }
  const parsed = parseGrantShowArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: grantUsage({ verb: "show" }) });
    return EXIT_USAGE;
  }
  const { grantId, home, json } = parsed.value;
  const checked = await checkRow({
    grantId,
    home: resolveHome({ named: home }),
    journal: deps.journal,
    proposedChange: undefined,
  });
  if (checked.isErr()) {
    return reportGrantStoreError({ error: checked.error, json, verb: "show" });
  }
  const { entries, verified } = checked.value;
  if (verified.isErr()) {
    if (json) {
      logger.out({ line: JSON.stringify({ error: verified.error, ok: false }) });
    } else {
      logger.error({ msg: `grant show: REFUSED on ${verified.error.code} — ${verified.error.message}` });
    }
    return EXIT_ERROR;
  }
  const grant = verified.value;
  if (json) {
    logger.out({
      line: JSON.stringify({
        checksRemaining: ["CHANGE_MISMATCH", "RAIL_CROSSED"],
        grant,
        ok: true,
        priorRefusals: refusalsOf({ entries }).filter((refusal) => refusal.grantId === grantId),
      }),
    });
    return EXIT_OK;
  }
  printRow({ entries, grant });
  return EXIT_OK;
}

/** Print the row, then the two checks that are still the reading session's own. */
function printRow({ entries, grant }: { entries: readonly GrantEntry[]; grant: GrantRow }): void {
  logger.out({ line: `grant ${grant.id}` });
  logger.out({ line: `  target:   ${renderTarget({ target: grant.target })}` });
  logger.out({ line: `  anchor:   ${grant.anchor}` });
  logger.out({ line: `  recorded: ${grant.recordedAtIso} by session ${grant.recordedBySessionId.slice(0, 8)}` });
  logger.out({ line: `  pinned:   ${grant.pinnedAtRecord ? "yes" : "no"} (one input, never the trust)` });
  logger.out({ line: `  change (${grant.changeKind}):` });
  grant.change.split("\n").forEach((line) => {
    logger.out({ line: `    ${line}` });
  });
  const spentOrRefused = performancesOf({ entries }).length + refusalsOf({ entries }).length;
  logger.out({
    line: `  journal:  ${String(spentOrRefused)} performance(s)/refusal(s) recorded across this home's store`,
  });
  logger.out({ line: "" });
  logger.out({
    line:
      "Every computable check on this row passed. Two are still yours: whether what you are about to write IS " +
      "this change (`grant perform` compares it byte for byte), and whether acting would cross a rail no row " +
      "may authorise — new or widened access, a new audience, egress, spend, an irreversible unasked-for act.",
  });
  logger.out({
    line: `If you will not act, refuse by NAMING the check: \`slopweaver grant refuse ${grant.id} --check <${GRANT_CHECK_CODES.join("|")}> --why "…"\`.`,
  });
}

export const grantShowCommand = defineCommand({ run: runGrantShow });
