/**
 * The printed form of a `github exposure sweep`, and whether it is complete and clean.
 *
 * It prints coverage and COUNTS: findings per surface and per rule, and where in the state home the findings
 * themselves were written. A match, a locator, an address or an excerpt never reaches this output; those are
 * `./exposureFindingsStore.ts`'s alone.
 *
 * Complete is stricter than the inventory's: a surface whose content this sweep does not read (`not-swept`), or
 * that the API cannot reach (`not-readable-by-api`), holds text nobody scanned, so it is not an all-clear.
 */

import { GITHUB_EXPOSURE_UPLOADS_FILE } from "./exposureFindingsStore.js";
import type { GithubExposureSweep } from "./exposureSweep.js";
import type { GithubExposureSweepCoverage } from "./exposureSweepCoverage.js";
import { githubExposureUploadCounts } from "./exposureUploads.js";

/**
 * Whether every surface's text was read in full, or the surface is off.
 *
 * @returns true when every surface is `swept` or `not-enabled`
 */
export function githubExposureSweepComplete({ sweep }: { sweep: GithubExposureSweep }): boolean {
  return sweep.surfaces.every(({ coverage }) => coverage.kind === "swept" || coverage.kind === "not-enabled");
}

/**
 * How many findings each rule produced, in descending count then rule order. Pure.
 *
 * @returns one `[rule, count]` pair per rule that fired
 */
export function githubExposureFindingsByRule({ sweep }: { sweep: GithubExposureSweep }): readonly [string, number][] {
  const counts = new Map<string, number>();
  for (const { rule } of sweep.findings) {
    const before = counts.get(rule);
    counts.set(rule, before === undefined ? 1 : before + 1);
  }
  return [...counts.entries()].toSorted(([leftRule, left], [rightRule, right]) =>
    right === left ? leftRule.localeCompare(rightRule) : right - left,
  );
}

/** The texts column for one coverage. */
function textsCell({ coverage }: { coverage: GithubExposureSweepCoverage }): string {
  return "texts" in coverage ? String(coverage.texts) : "-";
}

/** The indented lines under one surface: why it was not swept in full, or its limits. */
function noteLines({ coverage }: { coverage: GithubExposureSweepCoverage }): readonly string[] {
  if (coverage.kind === "swept") {
    return coverage.limits.map((limit) => `      limit: ${limit}`);
  }
  if (coverage.kind === "partial" || coverage.kind === "read-failed" || coverage.kind === "not-swept") {
    return coverage.why.map((why) => `      gap: ${why}`);
  }
  return [`      ${coverage.detail}`];
}

/**
 * The one line saying how many uploads the sweep found and where they are listed: counts only, never a URL.
 *
 * @param reportPath the run directory, relative to the state home
 * @returns the line
 */
export function githubExposureUploadsLine({
  sweep,
  reportPath,
}: {
  sweep: GithubExposureSweep;
  reportPath: string;
}): string {
  const counts = githubExposureUploadCounts({ uploads: sweep.uploads });
  return `  ${String(counts.uploads)} upload(s) linked from ${String(counts.links)} read place(s); bytes not read or analysed, left for a visible session to look at; listed in ${reportPath}/${GITHUB_EXPOSURE_UPLOADS_FILE} under the state home`;
}

/**
 * The sweep as the lines a reader scans: a header, the findings by rule, one line per surface, the uploads, and the
 * report path.
 *
 * @param reportPath where the findings were written, relative to the state home
 * @returns the lines, in print order
 */
export function githubExposureSweepLines({
  sweep,
  reportPath,
}: {
  sweep: GithubExposureSweep;
  reportPath: string;
}): readonly string[] {
  const unsettled = sweep.surfaces.filter(
    ({ coverage }) => coverage.kind !== "swept" && coverage.kind !== "not-enabled",
  ).length;
  const found = `${String(sweep.findings.length)} finding(s)`;
  const reads = `${String(sweep.calls)} reads at ${sweep.readAtIso}`;
  const head = githubExposureSweepComplete({ sweep })
    ? `${sweep.repository}: every surface swept, ${found} (${reads})`
    : `${sweep.repository}: INCOMPLETE — ${String(unsettled)} of ${String(sweep.surfaces.length)} surfaces not fully swept, ${found} (${reads})`;
  const byRule = githubExposureFindingsByRule({ sweep });
  return [
    head,
    ...(byRule.length === 0
      ? []
      : [`  by rule: ${byRule.map(([rule, count]) => `${rule} ${String(count)}`).join(", ")}`]),
    ...sweep.surfaces.flatMap(({ surface, coverage, findings }) => [
      `  ${surface.padEnd(30)} ${coverage.kind.padEnd(19)} texts ${textsCell({ coverage }).padStart(6)}  findings ${String(findings).padStart(4)}`,
      ...noteLines({ coverage }),
    ]),
    githubExposureUploadsLine({ reportPath, sweep }),
    `  findings, with where each one sits: ${reportPath} under the state home`,
  ];
}
