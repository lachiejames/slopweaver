/**
 * What every rung of the `store` probe ladder does around its own run: open the store, print help, emit a report.
 *
 * Its own module because the ladder's six verbs live in two files, `./probe.ts` and `./probeDisclose.ts`, and
 * each needs all three. Nothing here parses an argument or renders a line; that is `./probeCore.ts` and
 * `./probeLines.ts`.
 */

import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { connectStore, type StoreClient } from "../../../store/client.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/**
 * Open the store, or print the refusal naming the variable to set.
 *
 * @returns the open client, or the exit code to return
 */
export async function openOrRefuse(): Promise<{ client: StoreClient } | { code: number }> {
  const opened = await connectStore({ max: 1 });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return { code: EXIT_ERROR };
  }
  return { client: opened.value };
}

/**
 * Emit a report, as JSON on stdout or as lines on stdout.
 *
 * @param json whether the caller asked for the machine-readable form
 * @param lines the human report
 * @param payload the machine-readable document
 */
export function emit({ json, lines, payload }: { json: boolean; lines: readonly string[]; payload: unknown }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "store probe report", value: payload }) });
    return;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Print a verb's usage when the caller asked for it.
 *
 * @param rest the verb's own argv tail
 * @param usage the verb's own usage line
 * @returns true when usage was printed and the verb should stop
 */
export function wantedHelp({ rest, usage }: { rest: readonly string[]; usage: string }): boolean {
  if (!rest.includes("--help") && !rest.includes("-h")) {
    return false;
  }
  logger.out({ line: usage });
  return true;
}
