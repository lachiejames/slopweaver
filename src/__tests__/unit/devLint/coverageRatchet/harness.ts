/*
 * What the coverage-ratchet test files share: the fake project root, Vitest's matcher anchored at it, the
 * metrics, measurement and baseline builders, and a directory size comfortably over the size cut. They moved
 * here when the coverage ratchet's tests were split by behaviour.
 */
import { vitestMeasures } from "../../../../devLint/coverageCompleteness.js";
import { COVERAGE_EXCLUDE } from "../../../../devLint/coverageExclude.js";
import {
  type CoverageBaseline,
  type CoverageMeasurement,
  type CoverageMetrics,
  MIN_DIRECTORY_STATEMENTS,
} from "../../../../devLint/coverageFloor.js";

export const ROOT = "/repo";

/**
 * The four repo-wide percentages under the names the floor uses.
 *
 * @returns branches, functions, lines and statements as given
 */
export const metrics = ({ b, f, l, s }: { b: number; f: number; l: number; s: number }): CoverageMetrics => ({
  branches: b,
  functions: f,
  lines: l,
  statements: s,
});

/**
 * One measured run: the totals, any per-directory statements, and no reported files.
 *
 * @returns the measurement the comparisons and the rebaseline read
 */
export const measurement = ({
  b,
  f,
  l,
  s,
  directories = {},
}: {
  b: number;
  f: number;
  l: number;
  s: number;
  directories?: Record<string, { statements: number; statementCount: number }>;
}): CoverageMeasurement => ({ directories, reportedFiles: [], summary: metrics({ b, f, l, s }) });

/**
 * One committed version-2 floor: the totals and any per-directory statement floors.
 *
 * @returns the baseline the comparisons and the rebaseline hold a measurement to
 */
export const baseline = ({
  b,
  f,
  l,
  s,
  directories = {},
}: {
  b: number;
  f: number;
  l: number;
  s: number;
  directories?: Record<string, { statements: number }>;
}): CoverageBaseline => ({ directories, summary: metrics({ b, f, l, s }), version: 2 });

/** A directory comfortably over the size cut, so its floor is in play. */
export const BIG = MIN_DIRECTORY_STATEMENTS * 10;

/**
 * Vitest's matcher over the repository's exclusions, anchored at the test root.
 *
 * @returns true when a real coverage run measures the given root-relative path
 */
export const measuredHere: (path: string) => boolean = vitestMeasures({ exclude: COVERAGE_EXCLUDE, root: ROOT });
