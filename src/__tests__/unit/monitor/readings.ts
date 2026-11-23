/**
 * Narrowing a {@link MonitorReading} to one arm, the way `unwrap` narrows a `Result`.
 *
 * `.claude/rules/testing.md` bans a conditional inside an assertion, and a three-armed union read with a
 * ternary is exactly that — a test written `reading.state === "firing" ? reading.subjects : []` passes just
 * as happily when the monitor answered `clear`. These throw instead, so the wrong arm is a failure naming
 * what it actually got.
 */
import type { FiringReading, MonitorReading, UnmeasurableReading } from "../../../monitor/types.js";

/**
 * The firing arm, or a failure naming the arm that came back.
 *
 * @param reading what the evaluator answered
 * @returns the same reading, narrowed
 */
export function firing({ reading }: { reading: MonitorReading }): FiringReading {
  if (reading.state !== "firing") {
    throw new Error(`expected ${reading.monitorId} to be firing, and it answered ${reading.state}`);
  }
  return reading;
}

/**
 * The unmeasurable arm, or a failure naming the arm that came back.
 *
 * @param reading what the evaluator answered
 * @returns the same reading, narrowed
 */
export function unmeasurable({ reading }: { reading: MonitorReading }): UnmeasurableReading {
  if (reading.state !== "unmeasurable") {
    throw new Error(`expected ${reading.monitorId} to be unmeasurable, and it answered ${reading.state}`);
  }
  return reading;
}
