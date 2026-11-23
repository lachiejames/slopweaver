/**
 * `slopweaver dev door-coverage` — the bypass guard. Prints every direct side-effect seam classed as a
 * sanctioned local-state / transport / read-only seam vs an `open` (un-accounted) one, plus any verb that
 * fails to declare its effect or routes an external write around the door. Exits non-zero on ANY open seam
 * or verb gap, so a green board can never hide a bypass. Read-only diagnostic.
 */

import { type CoverageReport, coverageReport } from "../../../admit/coverage.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

const USAGE = "usage: slopweaver dev door-coverage [--json]";

/** Percent of direct seams that are accounted for (sanctioned); 100 when there are none. */
function coveragePercent({ total, open }: { total: number; open: number }): number {
  return total === 0 ? 100 : Math.round(((total - open) / total) * 100);
}

/**
 * Run the door-coverage verb.
 *
 * @param argv the full process argv
 * @returns EXIT_OK when every seam is accounted for, else EXIT_ERROR (a reported finding)
 */
export async function runDoorCoverage(argv: readonly string[]): Promise<number> {
  const rest = new Set(argv.slice(3));
  if (rest.has("--help") || rest.has("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const report = await coverageReport();
  const percent = coveragePercent({ open: report.open.length, total: report.seams.length });

  if (rest.has("--json")) {
    logger.out({
      line: JSON.stringify(
        {
          coveragePercent: percent,
          ok: report.ok,
          open: report.open,
          seams: report.seams.length,
          unreadable: report.unreadable,
          verbGaps: report.verbGaps,
        },
        null,
        2,
      ),
    });
    return report.ok ? EXIT_OK : EXIT_ERROR;
  }

  renderHuman({ percent, report });
  return report.ok ? EXIT_OK : EXIT_ERROR;
}

/**
 * Print the human-readable coverage report.
 *
 * @param percent the accounted-for percentage over the seams actually read
 * @param report the coverage report
 */
function renderHuman({ percent, report }: { percent: number; report: CoverageReport }): void {
  logger.out({
    line: `door coverage: ${String(percent)}% of ${String(report.seams.length)} direct seams accounted for`,
  });
  if (report.open.length > 0) {
    logger.out({
      line: `\n${String(report.open.length)} OPEN seam(s) — not routed through the door + not a sanctioned local-state seam:`,
    });
    for (const seam of report.open) {
      logger.out({ line: `  ${seam.file}:${String(seam.line)} [${seam.seam}]` });
    }
  }
  if (report.verbGaps.length > 0) {
    logger.out({ line: `\n${String(report.verbGaps.length)} verb gap(s):` });
    for (const gap of report.verbGaps) {
      logger.out({ line: `  ${gap.noun} ${gap.verb} — ${gap.reason}` });
    }
  }
  if (report.unreadable.length > 0) {
    logger.out({
      line:
        `\n${String(report.unreadable.length)} path(s) could not be read, so this scan is PARTIAL and the` +
        ` percentage above is computed over an unknown denominator:`,
    });
    for (const path of report.unreadable) {
      logger.out({ line: `  ${path}` });
    }
  }
  // Deliberately NOT "every seam accounted for". This gate proves an inventory: every direct seam it could
  // read is either sanctioned or routed. It says nothing about whether the door's policy is sufficient —
  // `DEFAULT_GATES` is empty, and several routed paths run no gates at all. Claiming protection here was the
  // overclaim that made a fully green gate certify a property it never established.
  logger.out({
    line: report.ok
      ? "\ndoor coverage: OK (seam inventory complete; door POLICY sufficiency is not assessed here)"
      : "\ndoor coverage: FAIL (see above)",
  });
}

export const doorCoverageCommand = defineCommand({ run: runDoorCoverage });
