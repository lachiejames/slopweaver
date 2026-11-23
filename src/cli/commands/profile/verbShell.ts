/**
 * The shell every `slopweaver profile` store verb shares: a refusal printer, the store opener that names the
 * variable to set, the report emitter, and the JSON payload file reader. Effectful and a leaf — it imports no
 * profile command module, so a verb module may import it without a cycle.
 */
import { readFileSync } from "node:fs";

import { logger } from "../../../lib/logger.js";
import { safeJsonParse, safeJsonStringify } from "../../../lib/safeJson.js";
import { openStore, type StoreClient, storeUrl } from "../../../store/client.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";

/**
 * Print a list of refusal lines to stderr and return the usage exit code.
 *
 * @returns the usage exit code
 */
export function refuse({ lines, usage }: { lines: readonly string[]; usage: string }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/**
 * Open the store, or print the refusal that names the variable to set.
 *
 * @returns the open client and its url, or the exit code to return
 */
export function openOrRefuse(): { client: StoreClient; url: string } | { code: number } {
  const url = storeUrl();
  if (url.isErr()) {
    logger.error({ msg: url.error.message });
    return { code: EXIT_ERROR };
  }
  return { client: openStore({ max: 1, url: url.value }), url: url.value };
}

/** Emit a report, as JSON on stdout or as lines on stdout, exactly as the store verbs do. */
export function emit({ json, lines, payload }: { json: boolean; lines: readonly string[]; payload: unknown }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "profile report", value: payload }) });
    return;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Read and parse one JSON payload file, refusing with the reason rather than throwing.
 *
 * @returns the parsed value, or the refusal lines naming why it could not be read
 */
export function readJsonFile({ path }: { path: string }): { value: unknown } | { errors: readonly string[] } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { errors: [`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  try {
    return { value: safeJsonParse({ label: path, text: raw }) };
  } catch (error) {
    return { errors: [`${path} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
