/**
 * What a failing run said, in the fewest words the record allows: the service's own answer when it gave one, else
 * the reason with the runner's framing taken off. Split out of `./brokenAccount.ts`, which reads it for the account's
 * `said` line, as `./cardAnswers.ts` does for each firing.
 */
import { serviceWordsOf } from "./serviceWords.js";

/**
 * What opens a segment the runner appends to a failed command's reason: "`slopweaver … sync` exited 1", "exited 1",
 * and "`…` exited 0, and " ahead of the browser walk's own words (`src/live/resync/run.ts`), with
 * whatever joins it to further words: every character up to the next word or quoted command, then an "and" if one
 * follows.
 */
const RUNNER_TAIL = /^(?:`[^`]+` )?exited \d+\b[^\w`]*(?:and\b[^\w`]*)?/;

/**
 * What the runner opens a reason with: an exit code ("exit 1: ") or a failure code ("HOLDER_GONE: "), as many as it
 * stacked — a dead firing's reason is its failure code ahead of the run's own. It writes a colon after
 * each. An exit code goes with whatever joins it, as the tail's does; a failure code with a colon or a dash only
 * a hyphen with a space each side, and never a comma or a bare space — any of those would eat
 * a service's own capitalised word ("HTTP-500", "API, then", "API returned").
 */
const RUNNER_HEAD = /^(?:exit \d+\b[^\w`]*|[A-Z][A-Z_]+(?:\s*[:—–]\s*|\s+-\s+|$))+/;

/**
 * A reason with every code and "`<command>` exited N" the runner opened it with removed, in whatever order they
 * stacked — a failure code can mask the command's own tail behind it.
 */
function unframed({ reason }: { reason: string }): string {
  const stripped = reason.replace(RUNNER_HEAD, "").replace(RUNNER_TAIL, "");
  if (stripped === reason) {
    return reason;
  }
  return unframed({ reason: stripped });
}

/**
 * What a failing run said, as short as the record allows. A run that called a service carries that service's
 * answer inside a request path and a JSON body — MEASURED on `resync-atlas-vanta`, whose reason opens
 * with a 60-character request path — so the service's own `message` is lifted out when there is one. Otherwise the
 * runner's own framing is dropped: the exit or failure code it opens with and the "`<command>` exited N" segments it
 * appends — MEASURED the same day, `resync-atlas-jumpcloud` read "exit 1: nothing was published: … / `slopweaver
 * atlas jumpcloud sync` exited 1 / exited 1", and four rows read only "exit 1". Repro: `slopweaver automation status
 * --json` and read each card's `newestFailure.detail`. Words are only ever taken from the record, never written over
 * it, and the whole record stays in the account's `detail`.
 *
 * @param raw the failure's own reason, verbatim
 * @returns the service's words, else the reason without the runner's framing, else `null` when nothing failed in
 *   words — a bare exit code says nothing the owner can read
 */
export function saidPlainlyOf({ raw }: { raw: string | null }): string | null {
  if (raw === null) {
    return null;
  }
  const serviceWords = serviceWordsOf({ raw });
  if (serviceWords !== null) {
    return serviceWords;
  }
  const words = raw
    .split(" / ")
    .map((segment) => unframed({ reason: segment }))
    .filter((segment) => segment !== "")
    .join(" / ")
    .trim();
  if (words === "") {
    return null;
  }
  return words;
}
