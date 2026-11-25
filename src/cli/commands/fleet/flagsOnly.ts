/**
 * The flags of a `fleet` verb that takes no positional argument: parsed, or the exit code the invocation already ended on.
 */
import { logger } from "#lib/logger.js";

import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { type FleetVerb, fleetUsage, parseFleetArgs, VERB_ARG_OFFSET } from "./core.js";

/**
 * Parse one verb's flags, refusing positionals.
 *
 * @param argv the full process argv
 * @param verb which verb's spec to use
 * @returns the parsed flags, or the exit code on help or a usage error, whose lines are already printed
 */
export function fleetFlagsOnly({ argv, verb }: { argv: readonly string[]; verb: FleetVerb }): ParsedFlags | number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: fleetUsage({ verb }) });
    return EXIT_OK;
  }
  const parsed = parseFleetArgs({ rest, verb });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: fleetUsage({ verb }) });
    return EXIT_USAGE;
  }
  if (parsed.value.positionals.length > 0) {
    logger.error({ msg: `fleet ${verb}: takes no positional argument (got ${parsed.value.positionals.join(" ")})` });
    logger.error({ msg: fleetUsage({ verb }) });
    return EXIT_USAGE;
  }
  return parsed.value;
}
