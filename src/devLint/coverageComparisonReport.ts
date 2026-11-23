/**
 * What `coverage-ratchet`'s compare branch prints and exits with, as a pure function of the measurement and the
 * committed floor. `coverageRatchet.ts` is the edge that writes it.
 */
import { type CoverageBaseline, type CoverageMeasurement, compareCoverage } from "./coverageFloor.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * What the compare branch prints and exits with. Pure. Three lists, three treatments, none suppressing
 * another:
 *
 *  - a DROP below a floor is refused under `coverage-ratchet`, answered by covering the code;
 *  - a large directory with NO floor is refused under `coverage-ratchet-unfloored`, answered by the
 *    rebaseline — a separate row, because the correction for a drop is the locked door for this one;
 *  - a STALE floor is REPORTED, never red, by the owner's ruling: it goes to stdout with the rebaseline instruction and never sets the exit code. The loss the owner accepted
 *    is up to the gap between floor and measurement, until someone raises the floor.
 *
 * The clean line prints only when all three lists are empty, so an advisory is never read as clean.
 *
 * @param current the measurement
 * @param baseline the committed floor
 * @returns the exit code (1 iff a drop or an unfloored directory) and the stdout and stderr text
 */
export function coverageComparisonReport({
  current,
  baseline,
}: {
  current: CoverageMeasurement;
  baseline: CoverageBaseline;
}): { readonly exitCode: 0 | 1; readonly stdout: string; readonly stderr: string } {
  const verdict = compareCoverage({ baseline, current });
  if (verdict.ok) {
    return {
      exitCode: 0,
      stderr: "",
      stdout: `coverage-ratchet: clean (floor ${JSON.stringify(baseline.summary)}, ${String(
        Object.keys(baseline.directories).length,
      )} directory floor(s))\n`,
    };
  }
  const stdout =
    verdict.stale.length === 0
      ? ""
      : [
          // devlint: not-a-refusal -- an advisory on stdout that never sets the exit code, not a gate saying no
          `coverage-ratchet: ${String(verdict.stale.length)} floor(s) lag the measurement by more than the ratchet's headroom — reported, not red\n`,
          ...verdict.stale.map((shortfall) => `  ${shortfall.message}\n`),
          "  raise them with `yarn coverage:rebaseline` after a full unit run, and commit the floor\n",
        ].join("");
  const stderr: string[] = [];
  if (verdict.drops.length > 0) {
    stderr.push(...verdict.drops.map((drop) => `  ${drop.message}\n`));
    // NOT "run coverage:rebaseline" — that command refuses a lowering, so that advice would send you to a
    // door that is locked from the inside.
    stderr.push(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "coverage-ratchet" }),
        detail: `${String(verdict.drops.length)} floor(s) not met`,
      })}\n`,
    );
  }
  if (verdict.unfloored.length > 0) {
    stderr.push(...verdict.unfloored.map((shortfall) => `  ${shortfall.message}\n`));
    stderr.push(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "coverage-ratchet-unfloored" }),
        detail: `${String(verdict.unfloored.length)} unfloored directory(ies)`,
      })}\n`,
    );
  }
  return { exitCode: stderr.length > 0 ? 1 : 0, stderr: stderr.join(""), stdout };
}
