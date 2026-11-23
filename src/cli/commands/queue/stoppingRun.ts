/**
 * `slopweaver queue stopping` — the Queue cards that stop their work, in the order their Queue leads with them, read from
 * the running console's `GET /api/queue-stopping` (`src/queueStopping/report.ts`).
 *
 * The supervisor tick takes this as its `queue-stopping` reading, and the digest's first line names the leader, so the
 * chair's chat update to them opens on it. The console is the one place the Queue's rows
 * are computed, so this verb asks it rather than re-deriving a second copy of the predicate.
 *
 * Exit `0` only when the report is COMPLETE. An incomplete report and a console that did not answer both exit `1`, the
 * document still printed under `--json`, so neither reads as "nothing stops" to `verb || alert`.
 */
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../../../hand/consoleLink.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { ConsoleGet } from "../../../queueRefusals/report.js";
import {
  fetchQueueStopping,
  QUEUE_STOPPING_PATH,
  type QueueStoppingOutcome,
  queueStoppingOutcome,
} from "../../../queueStopping/report.js";
import { queueStoppingLines } from "../../../supervisor/digestQueueStopping.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { QUEUE_STOPPING_USAGE } from "./stoppingUsage.js";

/** Where this noun's own arguments start in `process.argv`: `[node, cli, queue, <verb>, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

const STOPPING_FLAGS = { boolean: ["json"] } satisfies FlagSpec;

/**
 * Parse a `queue stopping` invocation. Its own parser rather than `queue refusals`' one: importing a sibling verb's
 * run module is an in-process path to that verb's body (`inProcessRulingGate.test.ts`).
 *
 * @param rest the argv after the verb
 * @returns whether to print the JSON document, or every usage problem found
 */
export function parseStoppingArgs({ rest }: { rest: readonly string[] }): Result<{ readonly json: boolean }> {
  const parsed = parseFlags({ args: rest, spec: STOPPING_FLAGS });
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
export function stoppingExitCode({ outcome }: { outcome: QueueStoppingOutcome }): number {
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
 * Run `queue stopping` against an injected getter.
 *
 * @param argv the full process argv
 * @param get the HTTP getter
 * @param configured the console URL override, as the environment carries it
 * @returns the process exit code
 */
export async function runQueueStoppingWith({
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
    logger.out({ line: QUEUE_STOPPING_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoppingArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: QUEUE_STOPPING_USAGE });
    return EXIT_USAGE;
  }
  const consoleBase = consoleBaseFrom({ configured });
  const read = await fetchQueueStopping({ consoleBase, get });
  const outcome = queueStoppingOutcome({ consoleUrl: `${consoleBase}${QUEUE_STOPPING_PATH}`, read });
  if (!outcome.reached) {
    logger.error({
      msg: `queue stopping: ${outcome.why} — start it with \`yarn console\`, or point ${CONSOLE_URL_ENV} at it`,
    });
  }
  if (parsed.value.json) {
    logger.out({ line: JSON.stringify(outcome) });
    return stoppingExitCode({ outcome });
  }
  const lines = queueStoppingLines({ outcome });
  [lines.head, ...lines.unread, ...lines.stopping].forEach((line) => {
    logger.out({ line });
  });
  return stoppingExitCode({ outcome });
}

/**
 * Run `queue stopping`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runQueueStopping(argv: readonly string[]): Promise<number> {
  return runQueueStoppingWith({ argv, configured: process.env[CONSOLE_URL_ENV], get: fetchGet });
}

export const queueStoppingCommand = defineCommand({ run: runQueueStopping });
