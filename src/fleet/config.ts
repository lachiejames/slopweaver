/**
 * The fleet's one setting: how many seats it is meant to run — the denominator of the sessions page's capacity line.
 *
 * Fifteen when nothing is configured, because that is the fleet the owner runs. A file that is present and malformed is an ERROR rather
 * than the default: a capacity line quietly reading 15 over a file that says something else would misreport the
 * one number the page leads with.
 *
 * Pure.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type FleetConfigInvalidError, FleetErrors } from "./errors.js";

/** The configured fleet. */
export interface FleetConfig {
  readonly schemaVersion: 1;
  readonly capacity: number;
}

/** The capacity when no configuration has been written. */
const DEFAULT_FLEET_CAPACITY = 15;

/** The largest capacity a configuration may name — far past one machine, so only a typo hits it. */
export const MAX_FLEET_CAPACITY = 100;

/**
 * Whether a number is a capacity the page can render.
 *
 * @param value the candidate
 * @returns true for a whole number from 1 to {@link MAX_FLEET_CAPACITY}
 */
export function isFleetCapacity({ value }: { value: number }): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_FLEET_CAPACITY;
}

/**
 * Read a configuration value.
 *
 * @param value the decoded file, `undefined` when there is no file
 * @param path where it was read from, for the error
 * @returns the configuration — the default only when there was no file at all
 */
export function parseFleetConfig({
  value,
  path,
}: {
  value: unknown;
  path: string;
}): Result<FleetConfig, FleetConfigInvalidError> {
  if (value === undefined) {
    return ok({ capacity: DEFAULT_FLEET_CAPACITY, schemaVersion: 1 });
  }
  if (!isRecord(value)) {
    return err(FleetErrors.configInvalid({ path, why: "not an object" }));
  }
  const record = value;
  if (record["schemaVersion"] !== 1) {
    return err(FleetErrors.configInvalid({ path, why: "schemaVersion is not 1" }));
  }
  const capacity = record["capacity"];
  if (typeof capacity !== "number" || !isFleetCapacity({ value: capacity })) {
    return err(
      FleetErrors.configInvalid({
        path,
        why: `capacity must be a whole number from 1 to ${String(MAX_FLEET_CAPACITY)}`,
      }),
    );
  }
  return ok({ capacity, schemaVersion: 1 });
}
