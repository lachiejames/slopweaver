/*
 * The thread-freshness flags both `turn answer` and `turn review` take, parsed once. Pure: no filesystem, no
 * network, so a malformed value is refused before any Slack read or reviewer boot.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { isSlackTs } from "../../../lib/slackTs.js";
import { type ThreadBoundaryError, ThreadBoundaryErrors } from "../../../live/turn/threadBoundaryErrors.js";
import { str } from "./core.js";

/**
 * The `--read-through` value, validated as a Slack message timestamp.
 *
 * Refused rather than filtered when malformed, for the same reason `accountedForTs.ts` refuses a malformed
 * entry: a value silently dropped here leaves the boundary at the addressing message, and the refusal that
 * follows names the wrong cause.
 *
 * @param values the parsed flags
 * @returns the timestamp, `undefined` when the caller named none, or the typed refusal of the named one
 */
export function readThroughTs({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<string | undefined, ThreadBoundaryError> {
  const raw = str({ key: "read-through", values });
  if (raw === undefined) {
    return ok(undefined);
  }
  if (!isSlackTs({ ts: raw })) {
    return err(ThreadBoundaryErrors.notATimestamp({ given: raw }));
  }
  return ok(raw);
}
