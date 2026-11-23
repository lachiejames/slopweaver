/**
 * The delivery `cmux send` asks a harness for, from its `--interrupt` and `--delivery` flags. Pure.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { SessionDelivery } from "./sessionHarness.js";

/** Every delivery `--delivery` may name, in the seam's own words. */
const SESSION_DELIVERIES: readonly SessionDelivery[] = ["now", "turn", "later"];

/**
 * Map `cmux send`'s `--interrupt` onto the harness's delivery choice: present is `now`, absent is the
 * default `turn`.
 *
 * @param interrupt whether `--interrupt` was passed
 * @returns the delivery the harness is asked for
 */
export function deliveryForInterrupt({ interrupt }: { interrupt: boolean }): SessionDelivery {
  if (interrupt) {
    return "now";
  }
  return "turn";
}

/**
 * Read `--delivery` beside `--interrupt`. The two say the same thing, so naming both is refused rather than one
 * quietly winning; with neither, the delivery is `--interrupt`'s absent default.
 *
 * @param value `--delivery`'s value, `undefined` when it was not given
 * @param interrupt whether `--interrupt` was passed
 * @returns the delivery, or the line refusing the flags
 */
export function parseDeliveryFlag({
  value,
  interrupt,
}: {
  value: string | undefined;
  interrupt: boolean;
}): Result<SessionDelivery, string> {
  if (value === undefined) {
    return ok(deliveryForInterrupt({ interrupt }));
  }
  if (interrupt) {
    return err("--interrupt and --delivery both say when the message lands: pass one (--interrupt is --delivery now)");
  }
  const named = SESSION_DELIVERIES.find((delivery) => delivery === value);
  if (named === undefined) {
    return err(`--delivery must be one of ${SESSION_DELIVERIES.join(", ")}, not "${value}"`);
  }
  return ok(named);
}
