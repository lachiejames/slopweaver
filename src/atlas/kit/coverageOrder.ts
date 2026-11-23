/**
 * The order a report prints the coverage vocabulary in — the one place that order is declared.
 *
 * An ordering of `./contract.ts`'s state set is a REPORTING decision rather than part of the normalised view
 * `./read.ts` declares, so it lives beside neither.
 */
import { ATLAS_COVERAGE_STATES, type AtlasCoverageState } from "./contract.js";

/**
 * Every coverage state, in the order a report prints them — worst last, so a skimming reader's eye lands on
 * what is wrong rather than on what is fine.
 *
 * @returns the ordered states
 */
export function coverageStatesWorstLast(): readonly AtlasCoverageState[] {
  const order: readonly AtlasCoverageState[] = [
    "synced",
    "held-elsewhere",
    "excluded",
    "deferred",
    "not-configured",
    "invalid-configuration",
    "unavailable",
    "unreadable",
  ];
  const missing = ATLAS_COVERAGE_STATES.filter((state) => !order.includes(state));
  return [...order, ...missing];
}
