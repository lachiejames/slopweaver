/**
 * Parsing the `--accounted-for-ts` flag `turn answer` accepts — the ONE escape from the live
 * thread-freshness guard (`./threadFreshness.ts`), which refuses an answer once new conversation has landed
 * under the message it replies to.
 *
 * ## Why this is a list rather than a single timestamp
 *
 * The flag was built for the compound-instruction case, where exactly one later message ("add X to the
 * whitelist, then answer their question above") authorises answering an older one. One timestamp covered
 * that, so the flag took one.
 *
 * A live office-hours turn found the other shape: a turn blocked long enough on a real investigation that
 * TWELVE messages landed under it, two of them further owner tags queued behind the ask. The answer was
 * re-read and revised against every one of them — genuinely accounted for — and still could not post,
 * because only one timestamp could be named. Node's `parseArgs` is last-wins for a repeated option rather
 * than array-collecting, so writing the flag twelve times silently honoured the twelfth and refused on the
 * other eleven: a caller doing exactly the right thing got a refusal that read like a bug in their input.
 *
 * The guard itself is deliberately untouched — it earned its keep in that same incident by catching an
 * answer that had genuinely gone stale. What changes is only the caller's ability to say "I read all of
 * these", which was always the flag's purpose.
 *
 * A malformed entry is REFUSED rather than filtered away. The sibling `--channels` flag drops empties
 * silently, which is right for a channel list where a stray comma is harmless; here a dropped entry means a
 * message the caller believed was accounted for silently is not, and the refusal that follows names the
 * wrong cause. Fail loud, name the entry.
 */
import { err, ok, type Result } from "../../lib/result.js";

/**
 * A Slack message timestamp: whole seconds, a dot, then the fractional suffix — `1787287180.226079`.
 * Anchored and bounded on both sides, so it is linear-time by construction.
 */
const SLACK_MESSAGE_TS = /^\d{1,12}\.\d{1,6}$/;

/**
 * The message timestamps a `--accounted-for-ts` value names, comma-separated — the same list spelling
 * `listen recover --channels` already uses, so the CLI has one convention for a list flag rather than two.
 *
 * @param raw the flag's raw value, or `undefined` when the caller did not pass it
 * @returns every named timestamp in the order given, or a reason per malformed entry
 */
export function parseAccountedForTs({ raw }: { raw: string | undefined }): Result<readonly string[]> {
  if (raw === undefined) {
    return ok([]);
  }
  const entries = raw.split(",").map((entry) => entry.trim());
  const refusals = entries
    .filter((entry) => !SLACK_MESSAGE_TS.test(entry))
    .map((entry) =>
      entry.length === 0
        ? "--accounted-for-ts has an empty entry — comma-separate the timestamps, with no trailing comma"
        : `--accounted-for-ts is not a Slack message timestamp: ${entry}`,
    );
  return refusals.length > 0 ? err(refusals) : ok(entries);
}
