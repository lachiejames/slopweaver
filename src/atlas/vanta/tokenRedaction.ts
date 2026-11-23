/**
 * Scrub every bearer token a Vanta walk presented out of the reasons it fails with.
 *
 * `transport.ts` already redacts a token reflected in an HTTP response — but `pagination.ts` itself never
 * sees a token, only cursors and items, so a token a page reflects back AS ITS OWN CURSOR can still surface
 * unredacted in one of pagination's own refusals. So every token a walk actually presented gets scrubbed,
 * not just the latest one.
 */
import { err, type Result } from "../../lib/result.js";

/**
 * Redact every token this walk actually used from a failed result's errors.
 *
 * @param usedTokens every token value this walk sent, across every page and every refresh
 * @param result the walk's own result
 * @returns `result` unchanged on success, or with every recorded token scrubbed from its errors
 */
export function withTokensRedacted<TValue>({
  usedTokens,
  result,
}: {
  usedTokens: ReadonlySet<string>;
  result: Result<TValue>;
}): Result<TValue> {
  if (result.isOk() || usedTokens.size === 0) {
    return result;
  }
  return err(redactTokensInErrors({ errors: result.error, usedTokens }));
}

/**
 * Redact every recorded token from an already-extracted error list — used when the caller's Result carries a
 * different ok-type than the redacted Result it returns.
 *
 * @param usedTokens every token value the walk sent
 * @param errors the reasons to scrub
 * @returns each reason with every non-empty recorded token replaced by `[REDACTED]`
 */
export function redactTokensInErrors({
  usedTokens,
  errors,
}: {
  usedTokens: ReadonlySet<string>;
  errors: readonly string[];
}): readonly string[] {
  return errors.map((line) =>
    [...usedTokens].reduce(
      (redacted, token) => (token === "" ? redacted : redacted.split(token).join("[REDACTED]")),
      line,
    ),
  );
}
