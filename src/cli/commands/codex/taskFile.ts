/**
 * The `--task-file` read both Codex planning verbs (`codex plan`, `codex plan-fallback prepare`) start from.
 */

import { readFileSync } from "node:fs";

import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";

/**
 * The task file's text, or the exit code to stop on once the reason has been reported.
 *
 * An unreadable file is an I/O failure (`EXIT_ERROR`); a file that reads but is empty names no task, which is
 * a caller mistake (`EXIT_USAGE`).
 *
 * @param path the `--task-file` value
 * @param verb the verb name each log line is prefixed with
 * @returns the non-empty task text, or the exit code to return
 */
export function readTaskFile({ path, verb }: { path: string; verb: string }): string | number {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    logger.error({ msg: `${verb}: could not read --task-file ${path}` });
    return EXIT_ERROR;
  }
  if (text.trim().length === 0) {
    logger.error({ msg: `${verb}: --task-file ${path} is empty: it names no task` });
    return EXIT_USAGE;
  }
  return text;
}
