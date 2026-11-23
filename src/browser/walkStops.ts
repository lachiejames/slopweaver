/**
 * Every browser leg in this process that STOPPED before it finished, remembered until a reader takes them.
 *
 * ## The defect this exists to close
 *
 * MEASURED on a scheduled-asks seat: `slopweaver automation run-due --recipe
 * resync-atlas-hex` landed about a quarter of dozens of compiled routes, then every remaining visit answered `SESSION_LOST`
 * ("Target page, context or browser has been closed"). `atlas hex refresh` exited 0, the manifest clock moved
 * on the API half, and `live/resync/outcome.ts` graded the attempt SUCCEEDED — so the slot was stamped and
 * the next pass had no reason to retry. The Linear resync the same morning (well over half of hundreds of pages,
 * `Session closed`) and the nx-cloud resync (none of dozens) are the same class.
 *
 * A "reached zero of N" rule catches the last one and misses the first. A RATIO needs a threshold nobody
 * measured, and would fail a walk whose pages legitimately redirect or refuse. The signal is explicit
 * instead: a live relay transport answering a walk-stopping error ({@link isWalkStoppingError}). A relay
 * session's `stopped` is sticky and no walk verb retries a lease, so one such answer means every declared page
 * after it was attempted against nothing, however the verb then chose to exit.
 *
 * ## The way OUT of this register is the half that has to be watched
 *
 * An explicit signal only covers what is graded onto it, and a run-stopping condition graded per-page
 * arrives here as nothing at all. MEASURED, and it is the finding
 * `the-chrome-browser-walk-toolchain-is-version-skewed`: a `automation resync --atlas linear` pass
 * landed a small fraction of hundreds of declared pages, then had almost all the rest refused with `Client is v1.62.1, session
 * 'chrome' is v1.63.0` — a condition `browser/clientKill.ts` already RECOGNISED, and graded as costing one
 * page, so nothing reached this set and the attempt graded SUCCEEDED exactly as the hex pass above had.
 * The same skew appeared in that pass's hex and graphql-hive walks. It is run-stopping by construction —
 * `Session.run` compares two constants — and is graded so. The lesson for the next row
 * added to `CLIENT_PHRASES`: the question is never "is the relay gone", it is "will the next page fail the
 * same way", and only the second one is what this register is for.
 *
 * ## A drop that was RECOVERED from is not a stop, and has its own register
 *
 * Since `relayRun.ts` learned to rebuild a dropped relay and retry the page it lost, the two halves of
 * this question stopped being the same fact. `stops` is still what it always was: the walk ended early and
 * every page after it went unread, so the attempt fails. {@link noteRelayRecovery} is the other half — the
 * relay went and came back, the page was re-addressed, the walk reached its own end. Noting the second in
 * the first register would fail a resync whose walk actually completed, which is the exact refusal the
 * reconnect exists to remove; noting it nowhere would hide a relay dropping every twenty pages behind walks
 * that all technically passed.
 *
 * The placement is what keeps them apart, and it is structural rather than careful: {@link withWalkStopNoted}
 * is applied OUTSIDE `runRelayOperation` — at `playwrightCli.ts`'s `visit` and at `runLeasedOperation` —
 * while the reconnect happens inside it. So a recovered drop is never an answer this register can see.
 *
 * ## Why process-scoped, stated rather than discovered
 *
 * A scheduled resync runs its steps IN this process through `cli/main.ts` (`live/resync/run.ts`), and some
 * fifteen walk verbs each choose their own exit code. Teaching every one of them was the per-atlas fix the
 * owner has refused before — the next walk verb would regenerate the defect. Every live transport already
 * goes through `./relaySession.ts`, so the note is taken there, once, and the resync runner drains it around
 * each step. Nothing else reads it; a process that never runs a resync only ever holds a deduplicated handful.
 */
import type { Result } from "../lib/result.js";

import { type BrowserTransportError, isWalkStoppingError } from "./pageTransport.js";

/** What has stopped since the last {@link takeWalkStops}, deduplicated by message. */
const stops = new Set<string>();

/** What lost the relay to another live process since the last {@link takeWalkCollisions}, deduplicated. */
const collisions = new Set<string>();

/** What DROPPED and was rebuilt since the last {@link takeRelayRecoveries}, deduplicated by message. */
const recoveries = new Set<string>();

/**
 * How many rebuilds those recoveries took, which is NOT their count.
 *
 * The register deduplicates by message and the measured failure mode prints the same message every time
 * (`Error: Session closed`), so a walk that rebuilt its relay five times would have reported
 * one. A progress line saying `1 relay rebuild` through five drops hides exactly the degradation the
 * instrument exists to show, so the count is kept beside the set rather than derived from it.
 */
let rebuilds = 0;

/**
 * Remember that a relay drop was recovered from, so a walk that completed anyway still SAYS the relay went.
 *
 * The exact companion to {@link withWalkStopNoted}, and it is a separate register rather than a flag on that
 * one because the two are read for opposite purposes. A stop FAILS the attempt — the pages after it went
 * unread. A recovery does not, and must not: the page was retried against a rebuilt relay and the walk
 * reached its own end, so grading it a failure would reintroduce exactly the refusal
 * `relayRun.ts`'s reconnect exists to remove. What it is instead is a REPORT — a relay that drops
 * every twenty pages is degrading whether or not any one walk survives it, and a fix that quietly paid an
 * attach each time and said nothing would make the degradation unobservable.
 *
 * @param reason what dropped, in the diagnosis's own words — never a raw client message, never an address
 */
export function noteRelayRecovery({ reason }: { reason: string }): void {
  recoveries.add(reason);
  rebuilds += 1;
}

/**
 * Every recovered drop noted since the last call, in the order first seen, and forget them.
 *
 * @returns the recoveries' reasons, empty when no browser leg since the last call lost its relay
 */
export function takeRelayRecoveries(): readonly string[] {
  const taken = [...recoveries];
  recoveries.clear();
  rebuilds = 0;
  return taken;
}

/**
 * How many relay rebuilds have happened and not yet been taken — a PEEK, which drains nothing.
 *
 * Separate from {@link takeRelayRecoveries} because the two readers want opposite things. The drain belongs
 * to the resync runner, which reports once per step and must not report the same drop twice. A walk's own
 * progress line wants the running count on every page, so that if the walk later stops, the log says
 * whether the relay had been degrading all along — and a reader that drained the register to learn that
 * would take the report away from the runner.
 *
 * REBUILDS, not distinct messages: the measured drop prints the same diagnosis every time, so a count read
 * off the deduplicating register would report `1` through a walk that rebuilt its relay five times.
 *
 * @returns how many relay rebuilds have happened since the last drain
 */
export function relayRecoveryCount(): number {
  return rebuilds;
}

/**
 * Pass a live transport's answer through unchanged, noting it first when it stopped the walk. Any other
 * failure costs one page and is the walk's own to record.
 *
 * @param result what the transport is returning
 * @returns the same result
 */
export function withWalkStopNoted<T>({
  result,
}: {
  readonly result: Result<T, BrowserTransportError>;
}): Result<T, BrowserTransportError> {
  if (result.isErr() && isWalkStoppingError({ error: result.error })) {
    stops.add(result.error.message);
  }
  return result;
}

/**
 * Every stop noted since the last call, in the order first seen, and forget them.
 *
 * @returns the stops' messages, empty when every browser leg since the last call finished
 */
export function takeWalkStops(): readonly string[] {
  const taken = [...stops];
  stops.clear();
  return taken;
}

/**
 * Remember that a walk never started because ANOTHER live process held the machine's one relay lease.
 *
 * A third register, beside the stops rather than in them, because the two are read for different verdicts. A
 * collision is still a stop — the walk read nothing, so the attempt is not a resync — but it says nothing about
 * the recipe: the same walk run once the other one finishes is correct unchanged. MEASURED:
 * `resync-atlas-hex` met "another browser walk is driving the owner's Chrome, held by pid <n>", was graded a
 * failure, and the slot cooled for nearly two days behind a walk that finished in minutes. Noted where the lease is
 * refused (`./relayLeaseHold.ts`), the only place that knows the holder is another live process.
 *
 * @param reason the lease refusal's own words, naming the holder
 */
export function noteWalkCollision({ reason }: { reason: string }): void {
  collisions.add(reason);
}

/**
 * Every collision noted since the last call, in the order first seen, and forget them.
 *
 * @returns the collisions' reasons, empty when no walk since the last call lost the relay to another process
 */
export function takeWalkCollisions(): readonly string[] {
  const taken = [...collisions];
  collisions.clear();
  return taken;
}
