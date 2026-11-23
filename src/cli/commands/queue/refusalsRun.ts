/**
 * `slopweaver queue refusals` — the Queue cards a gate withheld from their Queue, read from the running console's
 * `GET /api/queue-refusals` (`src/queueRefusals/report.ts`).
 *
 * The supervisor tick takes this as its `queue-refusals` reading, so a withheld card reaches the chair, who routes it
 * to a seat that fixes its source record that pass. The console is the one place the Queue's rows and gates are
 * computed, so this verb asks it rather than re-deriving a second copy of any gate.
 *
 * Exit `0` only when the report is COMPLETE. An incomplete report (a register the console could not read) and a
 * console that did not answer both exit `1`, the document still printed under `--json`, so neither reads as a quiet
 * Queue to `verb || alert`.
 */
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../../../hand/consoleLink.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type ConsoleGet,
  fetchQueueRefusals,
  QUEUE_REFUSALS_PATH,
  type QueueRefusalsOutcome,
  queueRefusalsOutcome,
} from "../../../queueRefusals/report.js";
import { queueRefusalLines } from "../../../supervisor/digestQueueRefusals.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { QUEUE_REFUSALS_USAGE } from "./refusalsUsage.js";

/** Where this noun's own arguments start in `process.argv`: `[node, cli, queue, <verb>, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

const REFUSALS_FLAGS = { boolean: ["json"] } satisfies FlagSpec;

/**
 * Parse a `queue refusals` invocation.
 *
 * @param rest the argv after the verb
 * @returns whether to print the JSON document, or every usage problem found
 */
export function parseRefusalsArgs({ rest }: { rest: readonly string[] }): Result<{ readonly json: boolean }> {
  const parsed = parseFlags({ args: rest, spec: REFUSALS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ json: parsed.value.values["json"] === true });
}

/**
 * The exit code an outcome comes to: `0` only for a complete report from a console that answered.
 *
 * @param outcome what the read came to
 * @returns the exit code
 */
export function refusalsExitCode({ outcome }: { outcome: QueueRefusalsOutcome }): number {
  if (outcome.reached && outcome.complete) {
    return EXIT_OK;
  }
  return EXIT_ERROR;
}

/** The real getter: one `fetch`, abandoned at the timeout, its status and body handed back whole. */
const fetchGet: ConsoleGet = async ({ url, timeoutMs }) => {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, text: await response.text() };
};

/**
 * Run `queue refusals` against an injected getter.
 *
 * @param argv the full process argv
 * @param get the HTTP getter
 * @param configured the console URL override, as the environment carries it
 * @returns the process exit code
 */
export async function runQueueRefusalsWith({
  argv,
  get,
  configured,
}: {
  argv: readonly string[];
  get: ConsoleGet;
  configured: string | undefined;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: QUEUE_REFUSALS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRefusalsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: QUEUE_REFUSALS_USAGE });
    return EXIT_USAGE;
  }
  const consoleBase = consoleBaseFrom({ configured });
  const read = await fetchQueueRefusals({ consoleBase, get });
  const outcome = queueRefusalsOutcome({ consoleUrl: `${consoleBase}${QUEUE_REFUSALS_PATH}`, read });
  if (!outcome.reached) {
    logger.error({
      msg: `queue refusals: ${outcome.why} — start it with \`yarn console\`, or point ${CONSOLE_URL_ENV} at it`,
    });
  }
  if (parsed.value.json) {
    logger.out({ line: JSON.stringify(outcome) });
    return refusalsExitCode({ outcome });
  }
  const lines = queueRefusalLines({ outcome });
  [lines.head, ...lines.unread, ...lines.withheld].forEach((line) => {
    logger.out({ line });
  });
  return refusalsExitCode({ outcome });
}

/**
 * Run `queue refusals`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runQueueRefusals(argv: readonly string[]): Promise<number> {
  return runQueueRefusalsWith({ argv, configured: process.env[CONSOLE_URL_ENV], get: fetchGet });
}

export const queueRefusalsCommand = defineCommand({ run: runQueueRefusals });
