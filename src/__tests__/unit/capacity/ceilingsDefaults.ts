/*
 * Test-only: `buildCeilingsReading` with the register's DEFAULT Claude thresholds supplied when a case names none, so
 * a ceilings case that is not about a threshold reads as it did before the bars moved into the plan register. A case
 * about one names `claudeThresholds` itself (`ceilingsThresholds.test.ts`).
 */
import {
  type PlanCeilingInputs,
  buildCeilingsReading as realBuildCeilingsReading,
} from "../../../capacity/ceilings.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

/**
 * {@link realBuildCeilingsReading}, its plans judged by the default Claude thresholds unless they carry their own.
 *
 * @returns the ceilings reading
 */
export function buildCeilingsReading(
  options: Omit<Parameters<typeof realBuildCeilingsReading>[0], "plans"> & {
    plans: Omit<PlanCeilingInputs, "claudeThresholds"> & { claudeThresholds?: PlanCeilingInputs["claudeThresholds"] };
  },
): ReturnType<typeof realBuildCeilingsReading> {
  return realBuildCeilingsReading({
    ...options,
    plans: { claudeThresholds: DEFAULT_THRESHOLDS.claude, ...options.plans },
  });
}
