/**
 * `slopweaver grant refuse` — decline to act on a row by NAMING the check that failed.
 *
 * This verb is the mechanism, not a convenience. The failure mode the journalled grant exists to close is a
 * session that reads a relayed ruling and asks the owner to type it into that session's own tab — behaviour
 * no prose can argue a careful session out of. What ends it is making the refusal point at something: the
 * `--check` value is validated against the closed set in `grants/errors.ts` at parse time, and that set has
 * no member meaning "I do not believe you".
 *
 * Every typed refusal stays wanted, and each one is journalled beside the row it answers so a reader can see
 * what a session would not do and why.
 */
import type { GrantCheckCode } from "../../../grants/errors.js";
import type { GrantRefusal } from "../../../grants/grant.js";
import { logger } from "../../../lib/logger.js";
import { detectSupervisorSession, supervisorSessionProblem } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { grantUsage, parseGrantRefuseArgs, VERB_ARG_OFFSET } from "./core.js";
import { type GrantCommandDeps, productionGrantCommandDeps, reportGrantStoreError } from "./deps.js";

/**
 * What a session should do next, per check — so a refusal ends in a route rather than a stall. Keyed by the
 * closed code set, so a new code without a next step does not compile.
 */
const NEXT_STEP: Readonly<Record<GrantCheckCode, string>> = {
  ALREADY_PERFORMED: "ask the supervisor to record a fresh row; one row is one change",
  ANCHOR_UNRESOLVED:
    "ask the supervisor for a row whose anchor resolves — a console record (talk:, talk-call:), a transcript pointer or a permalink",
  CHANGE_MISMATCH: "say what you were about to write and what the row says; one of the two is wrong",
  RAIL_CROSSED: "route it to the owner — no row may authorise this, and the tier-3 set is untouched by grants",
  ROW_MISSING: "ask the supervisor to record the row, then re-read it with `slopweaver grant show`",
  STATE_ABSENT: "say what is missing; the decision was made about a state that is not here",
};

/**
 * Run `grant refuse` over the store-backed journal.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runGrantRefuse(argv: readonly string[]): Promise<number> {
  return runGrantRefuseWithDeps({ argv, deps: productionGrantCommandDeps() });
}

/**
 * Run `grant refuse` over whichever journal and environment it is handed. A grant may be refused many times, so
 * each refusal is its own row.
 *
 * @param argv the full process argv
 * @param deps the journal port and the environment naming the refusing session
 * @returns the process exit code
 */
export async function runGrantRefuseWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GrantCommandDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: grantUsage({ verb: "refuse" }) });
    return EXIT_OK;
  }
  const parsed = parseGrantRefuseArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: grantUsage({ verb: "refuse" }) });
    return EXIT_USAGE;
  }
  const detection = detectSupervisorSession({ env: deps.env });
  if (detection.kind !== "active") {
    logger.error({ msg: `grant refuse: ${supervisorSessionProblem({ detection })}` });
    return EXIT_ERROR;
  }
  const { check, grantId, home, json, why } = parsed.value;
  const refusal: GrantRefusal = {
    code: check,
    grantId,
    refusedAtIso: new Date().toISOString(),
    refusedBySessionId: detection.session.id,
    why,
  };
  const written = await deps.journal.appendEntry({
    entry: { kind: "refusal", refusal },
    home: resolveHome({ named: home }),
  });
  if (written.isErr()) {
    return reportGrantStoreError({ error: written.error, json, verb: "refuse" });
  }
  if (json) {
    logger.out({ line: JSON.stringify(refusal) });
    return EXIT_OK;
  }
  logger.out({ line: `grant refuse: RECORDED ${check} against ${grantId} — ${why}` });
  logger.out({
    line: `grant refuse: next — ${NEXT_STEP[check]}`,
  });
  return EXIT_OK;
}

export const grantRefuseCommand = defineCommand({ run: runGrantRefuse });
