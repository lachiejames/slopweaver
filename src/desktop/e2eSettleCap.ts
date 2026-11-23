/**
 * How long a `desktop e2e` step waits for its landmark and for every loading mark to clear before it is photographed
 * (`--settle-cap <seconds>`), the pure half. The default is the cap every walk has always used; a longer one exists to
 * MEASURE a page that is still loading at the default, so a walk can say when it settled, or that it had not by the
 * longer cap, instead of only that it had not by thirty seconds.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type DesktopE2eFlagError, DesktopE2eFlagErrors } from "./e2eErrors.js";

/** The cap a step settles under when `--settle-cap` is not passed. */
export const E2E_SETTLE_CAP_DEFAULT_MS = 30_000;

/** The longest cap `--settle-cap` accepts, in seconds: ten minutes, past which a walk is waiting on nothing it can name. */
const E2E_SETTLE_CAP_MAX_SECONDS = 600;

/**
 * The `--settle-cap` flag's value, read as whole seconds.
 *
 * @param text the flag's value, or `undefined` when the flag was not passed
 * @returns the cap in milliseconds, the default when not passed, or the refusal
 */
export function e2eSettleCapOf({ text }: { text: string | undefined }): Result<number, DesktopE2eFlagError> {
  if (text === undefined) {
    return ok(E2E_SETTLE_CAP_DEFAULT_MS);
  }
  const seconds = /^\d+$/u.test(text) ? Number(text) : Number.NaN;
  if (!(seconds >= 1 && seconds <= E2E_SETTLE_CAP_MAX_SECONDS)) {
    return err(DesktopE2eFlagErrors.settleCapInvalid({ maxSeconds: E2E_SETTLE_CAP_MAX_SECONDS, text }));
  }
  return ok(seconds * 1000);
}
