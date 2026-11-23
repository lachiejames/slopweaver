/**
 * The three output helpers every `slack post|reply` lane shares — usage errors, plain lines, and a door
 * refusal — split out of `./run.ts` so the card lane, the as-me send (`./asMeSend.ts`) and a draft release
 * (`./releaseRun.ts`) print through one copy.
 */
import { type NotPerformed, notPerformedLines } from "../../../admit/doorRefusal.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import type { SlackRefusal } from "./core.js";

/**
 * Print a list of usage errors on stderr.
 *
 * @returns the usage exit code
 */
export function usage({ errors }: { errors: readonly string[] }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  return EXIT_USAGE;
}

/** Print lines on stdout, one per line. */
export function emitLines({ lines, out }: { lines: readonly string[]; out: (line: string) => void }): void {
  for (const line of lines) {
    out(line);
  }
}

/**
 * Report a send that was not performed, listing each finding and its correction (or the store's reason) on stderr.
 *
 * The same facts also ride in the `--json` document (as `refusal`), so a programmatic caller never has to
 * parse stderr to learn why nothing was sent. A door refusal and a store that could not record the decision are
 * different facts and stay different there.
 *
 * @param through the outcome that did not perform
 * @returns the refusal as the `--json` document carries it
 */
export function reportRefusal({ through }: { through: NotPerformed }): SlackRefusal {
  for (const line of notPerformedLines({ command: "slopweaver slack post", through })) {
    logger.error({ msg: line });
  }
  if (through.kind === "recording-refused") {
    return { error: through.error.message, findings: [], status: "recording-refused" };
  }
  return {
    findings: through.decision.findings.map((finding) => ({
      code: finding.code,
      correction: finding.correction,
      summary: finding.summary,
    })),
    status: through.decision.status,
  };
}
