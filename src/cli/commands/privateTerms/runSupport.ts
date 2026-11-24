/**
 * What every `private-terms` verb shares before its own work: the two print edges, help detection and the usage
 * refusal. The edit verbs add their clock, ids and pattern-file reader on top (`./edit.ts`); `list` and `retire` need
 * only these.
 */
import { logger } from "../../../lib/logger.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { type PrivateTermsVerb, privateTermsUsage } from "./core.js";
import { type PrivateTermsPrintEdges } from "./printGuard.js";

/** The edges a verb that reads or retires, and never proposes, runs over. */
export type PrivateTermsCommandDeps = PrivateTermsPrintEdges;

/**
 * Production edges: the logger's stdout channel and its error channel.
 *
 * @returns the deps
 */
export function productionPrivateTermsCommandDeps(): PrivateTermsCommandDeps {
  return {
    out: logger.out,
    writeDiagnostic: ({ line }) => {
      logger.error({ msg: line });
    },
  };
}

/**
 * Whether the argv asks for help.
 *
 * @param rest the argv after the noun and verb
 * @returns true for `--help` or `-h` anywhere in it
 */
export function asksHelp({ rest }: { rest: readonly string[] }): boolean {
  return rest.includes("--help") || rest.includes("-h");
}

/**
 * Print usage problems and the usage line, answering the usage exit code.
 *
 * @param problems every reason the argv was refused
 * @param verb whose usage line follows them
 * @returns the usage exit code
 */
export function failUsage({
  deps,
  problems,
  verb,
}: {
  deps: PrivateTermsCommandDeps;
  problems: readonly string[];
  verb: PrivateTermsVerb;
}): number {
  for (const problem of problems) {
    deps.writeDiagnostic({ line: problem });
  }
  deps.writeDiagnostic({ line: privateTermsUsage({ verb }) });
  return EXIT_USAGE;
}
