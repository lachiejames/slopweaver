/**
 * Durable I/O for the scheduled recovery sweep's cadence state — `recoverSchedule.ts` stays pure, this owns
 * the one file it reads and writes.
 *
 * Three read outcomes, not two: missing (never swept — a valid bootstrap state), unreadable (an I/O fault,
 * never treated as "never swept"), and malformed (a corrupt file, refused rather than silently re-bootstrapped
 * into a full re-scan). Collapsing any of these into another is exactly the defect `readSliceManifest`
 * documents for the same reason — a caller that cannot tell "absent" from "corrupt" will happily widen a
 * five-minute delta scan back into a full workspace crawl without anyone deciding that on purpose.
 */
import { readFileSync } from "node:fs";
import { slopweaverHome } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { type RecoverySweepStateError, RecoverySweepStateErrors } from "./errors.js";
import { parseRecoverySweepState, type RecoverySweepState } from "./recoverSchedule.js";

/**
 * Read the durable cadence state, distinguishing "never swept" from "unreadable" from "malformed".
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the state (`undefined` when no sweep has ever run), or `err` naming why it could not be trusted
 */
export function readRecoverySweepState({
  home = slopweaverHome(),
}: {
  home?: string;
} = {}): Result<RecoverySweepState | undefined, RecoverySweepStateError> {
  const path = stateHomePaths({ home }).live.slack.recoverySweepJson;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error["code"] : undefined;
    if (code === "ENOENT") {
      return ok(undefined);
    }
    return err(RecoverySweepStateErrors.unreadable({ cause: error, path }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(RecoverySweepStateErrors.malformedJson({ path }));
  }
  return parseRecoverySweepState({ raw: parsed });
}

/**
 * Write the durable cadence state atomically and durably.
 *
 * @param state the cadence state to persist
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the written path, or `err` on an I/O failure
 */
export function writeRecoverySweepState({
  state,
  home = slopweaverHome(),
}: {
  state: RecoverySweepState;
  home?: string;
}): Result<{ path: string }, RecoverySweepStateError> {
  const path = stateHomePaths({ home }).live.slack.recoverySweepJson;
  try {
    writeFileAtomic({ contents: `${JSON.stringify(state, null, 2)}\n`, path });
  } catch (error: unknown) {
    return err(RecoverySweepStateErrors.writeFailed({ cause: error, path }));
  }
  return ok({ path });
}
