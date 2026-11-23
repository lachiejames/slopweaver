/**
 * `slopweaver atlas trelica reset --confirm archive [--json] [--home <dir>]` — archive the current
 * generation and install a fresh, empty one.
 *
 * Nothing is deleted. The confirmation word is spelled out so a generation is never replaced by a typo, and
 * the archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/trelica/`.
 */
import { resetTrelicaAtlas } from "../../../atlas/trelica/reset.js";
import { trelicaAtlasPaths } from "../../../atlas/trelica/store.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import { parseTrelicaResetOptions, TRELICA_RESET_USAGE, TRELICA_VERB_INDEX } from "./core.js";

/** The effects a reset reaches, so every branch can be driven without the clock, the filesystem or stdout. */
export interface TrelicaAtlasResetDeps {
  /** This run's ISO instant, read only once the invocation is known to reset something. */
  readonly now: () => string;
  /** Resolve the atlas paths under a home. */
  readonly paths: typeof trelicaAtlasPaths;
  /** Archive the current generation and install an empty one. */
  readonly reset: typeof resetTrelicaAtlas;
  /** Where the verb's data output goes. */
  readonly out: (args: { line: string }) => void;
  /** Where a refusal's or a failure's diagnostic goes. */
  readonly error: (args: { msg: string }) => void;
}

/**
 * Run the Trelica atlas reset over injected effects.
 *
 * @param argv the whole process argv
 * @param deps the clock, the path resolver, the reset itself and the two output sinks
 * @returns `EXIT_OK` for help or a reset, `EXIT_USAGE` for a refused tail, `EXIT_ERROR` when the reset failed
 */
export function runTrelicaAtlasReset({ argv, deps }: { argv: readonly string[]; deps: TrelicaAtlasResetDeps }): number {
  const rest = verbTail({ argv, at: TRELICA_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out({ line: TRELICA_RESET_USAGE });
    return EXIT_OK;
  }
  const options = parseTrelicaResetOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      deps.error({ msg: line });
    });
    deps.error({ msg: TRELICA_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const outcome = deps.reset({ at: deps.now(), paths: deps.paths({ home }) });
  if (outcome.isErr()) {
    outcome.error.forEach((line) => {
      deps.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  deps.out({
    line: asJson
      ? JSON.stringify(outcome.value, null, 1)
      : `trelica atlas reset — archived to ${outcome.value.archivedTo}`,
  });
  return EXIT_OK;
}

/**
 * Run the Trelica atlas reset.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function trelicaAtlasResetCommand(argv: readonly string[]): number {
  return runTrelicaAtlasReset({
    argv,
    deps: {
      error: ({ msg }) => {
        logger.error({ msg });
      },
      now: () => new Date().toISOString(),
      out: ({ line }) => {
        logger.out({ line });
      },
      paths: trelicaAtlasPaths,
      reset: resetTrelicaAtlas,
    },
  });
}
