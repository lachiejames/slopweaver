/**
 * `slopweaver workstreams candidates-put` — validate a whole candidates document and write it.
 *
 * The argv edge only: every rule is `parseCandidatesFile`, run inside `writeCandidates`. Their reactions live in
 * their own ledger, so writing a re-mined set never loses one; a reaction to an id the new set drops is simply no
 * longer drawn.
 */
import { readFileSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { writeCandidates } from "../../../workstreams/candidateStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseWorkstreamsCandidatesPutArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { WORKSTREAMS_CANDIDATES_PUT_USAGE } from "./usage.js";

/** Everything `workstreams candidates-put` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsCandidatesPutDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `workstreams candidates-put` against injected seams.
 *
 * @param rest the argv tail after `workstreams candidates-put`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runWorkstreamsCandidatesPut({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsCandidatesPutDeps;
}): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_CANDIDATES_PUT_USAGE);
    return EXIT_OK;
  }
  const parsed = parseWorkstreamsCandidatesPutArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_CANDIDATES_PUT_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const file = stringFlag({ name: "file", values });
  if (file === undefined) {
    deps.writeDiagnostic("workstreams candidates-put: --file is required");
    deps.writeDiagnostic(WORKSTREAMS_CANDIDATES_PUT_USAGE);
    return EXIT_USAGE;
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "the workstream candidates", text: readFileSync(file, "utf8") });
  } catch (error: unknown) {
    deps.writeDiagnostic(`workstreams candidates-put: could not read ${file} as JSON — ${errorMessage({ error })}`);
    return EXIT_ERROR;
  }
  const home = stringFlag({ name: "home", values });
  const written = writeCandidates(home === undefined ? { value } : { home, value });
  if (written.isErr()) {
    deps.writeDiagnostic(`workstreams candidates-put: ${written.error.message}`);
    return EXIT_ERROR;
  }
  const count = written.value.file.candidates.length;
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify({ candidates: count, path: written.value.path }));
    return EXIT_OK;
  }
  deps.writeOut(`workstreams candidates-put: ${String(count)} candidates written to ${written.value.path}`);
  return EXIT_OK;
}

/**
 * The real seams: the two output channels.
 *
 * @returns the production dependencies for {@link runWorkstreamsCandidatesPut}
 */
export function productionWorkstreamsCandidatesPutDeps(): WorkstreamsCandidatesPutDeps {
  return {
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver workstreams candidates-put`. */
export const workstreamsCandidatesPutCommand = defineCommand({
  run: (argv) =>
    runWorkstreamsCandidatesPut({ deps: productionWorkstreamsCandidatesPutDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
