/**
 * The two channels every `slopweaver gcp` action ends on: a result printed as lines or `--json` on stdout, or a
 * failure printed on stderr with the exit code `gcpCore.ts` assigns it. The words themselves are `gcpLines.ts`'s.
 */
import { logger } from "#lib/logger.js";
import type { GcpDoorError } from "../../../gcp/errors.js";
import { EXIT_OK } from "../../exitCodes.js";
import { gcpErrorExit } from "./gcpCore.js";

/** Print lines on the data channel. */
function printLines({ lines }: { lines: readonly string[] }): void {
  lines.forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Print one failure and answer its exit code.
 *
 * @param error the failure, its message already cut of anything unprintable
 * @returns the exit code the failure earns
 */
export function reportError({ error }: { error: GcpDoorError }): number {
  const lines = error.code === "EDIT_EXISTING_REFUSED" ? error.lines : [error.message];
  lines.forEach((line) => {
    logger.error({ msg: line });
  });
  return gcpErrorExit({ error });
}

/**
 * Print a value as JSON, or lines, and exit 0.
 *
 * @param json whether `--json` asked for the value rather than the lines
 * @param value the document `--json` prints, already safe to print
 * @param lines what a reader sees without `--json`
 * @returns `EXIT_OK`
 */
export function printed({ json, value, lines }: { json: boolean; value: unknown; lines: readonly string[] }): number {
  printLines({ lines: json ? [JSON.stringify(value, null, 2)] : lines });
  return EXIT_OK;
}
