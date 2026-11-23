/**
 * `slopweaver supervisor reoriented` — the supervisor saying it is caught up after a restart, the one signal that
 * turns it green on the sessions page and lets `fleet resume` start every other seat.
 *
 * It lives beside the fleet verbs rather than the supervisor's own because the fleet's journal is what it writes;
 * the decision is `../../../fleet/reorientation.ts`.
 */
import { logger } from "#lib/logger.js";

import { foldNewestAttempt } from "../../../fleet/journal.js";
import { type FleetPort, fleetPort } from "../../../fleet/port.js";
import { decideReorientation, reorientationEvent } from "../../../fleet/reorientation.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { boolFlag, stringFlag } from "./core.js";

/** The verb's flags. */
const SPEC: FlagSpec = { boolean: ["json"], string: ["attempt", "home"] };

/** `--`-prefixed flag names, for the help-truth ratchet. */
export const REORIENTED_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: SPEC }),
  ...booleanFlagsOf({ spec: SPEC }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The usage line. */
export const REORIENTED_USAGE = "usage: slopweaver supervisor reoriented [--attempt <uuid>] [--home <dir>] [--json]";

/**
 * Parse the verb's flags.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseReorientedArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: false, args: rest, spec: SPEC });
}

/** Parse, or the exit code for help and a usage error. */
function resolve({ argv }: { argv: readonly string[] }): ParsedFlags | number {
  const rest = verbTail({ argv, verbs: ["reoriented"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REORIENTED_USAGE });
    return EXIT_OK;
  }
  const parsed = parseReorientedArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: REORIENTED_USAGE });
    return EXIT_USAGE;
  }
  return parsed.value;
}

/**
 * `supervisor reoriented` over a given fleet port — append the chair's own caught-up line.
 *
 * @param argv the full process argv
 * @param fleet where the recovery journal is read and appended
 * @returns 0 once recorded or already recorded, 1 when refused
 */
export async function supervisorReoriented({
  argv,
  fleet,
}: {
  argv: readonly string[];
  fleet: FleetPort;
}): Promise<number> {
  const parsed = resolve({ argv });
  if (typeof parsed === "number") {
    return parsed;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed }) });
  const journal = await fleet.readResumeJournal({ home });
  if (journal.isErr()) {
    logger.error({ msg: `supervisor reoriented: ${journal.error.message}` });
    return EXIT_ERROR;
  }
  const sessionId = process.env[CLAUDE_CODE_SESSION_ID_ENV];
  const decided = decideReorientation({
    attempt: foldNewestAttempt({ events: journal.value.events }),
    pin: readSupervisorPin({ home }),
    requested: stringFlag({ name: "attempt", parsed }),
    sessionId,
  });
  if (decided.isErr()) {
    logger.error({ msg: decided.error.message });
    return EXIT_ERROR;
  }
  const decision = decided.value;
  if (!decision.already && sessionId !== undefined) {
    const written = await fleet.appendResumeEvent({
      event: reorientationEvent({ atIso: new Date().toISOString(), decision, sessionId }),
      home,
    });
    if (written.isErr()) {
      logger.error({ msg: `supervisor reoriented: ${written.error.message}` });
      return EXIT_ERROR;
    }
  }
  if (boolFlag({ name: "json", parsed })) {
    logger.out({ line: JSON.stringify(decision) });
  } else {
    logger.out({
      line: `supervisor reoriented: recorded against ${decision.attemptId}${decision.already ? " (already)" : ""}`,
    });
  }
  return EXIT_OK;
}

/**
 * `supervisor reoriented` — the composition root, over the store's fleet tables.
 *
 * @param argv the full process argv
 * @returns 0 once recorded or already recorded, 1 when refused
 */
export async function runSupervisorReoriented(argv: readonly string[]): Promise<number> {
  return supervisorReoriented({ argv, fleet: fleetPort() });
}

export const supervisorReorientedCommand = defineCommand({ run: runSupervisorReoriented });
