/**
 * `handover wake --retry <nonce>` — the one park a backoff deferral printed, judged again once the backoff opens.
 *
 * Split from `./wakeRun.ts`, which owns the plain tick wake: this half resolves the nonce off the wake journal
 * (`../../../handover/wakeJournal.ts`), waits at most {@link MAX_RETRY_WAIT_MS}, reads the board again and narrows it
 * to that park, and says why the retry stops whenever it does not reach one.
 */

import { type WakeCandidate, wakeCandidates } from "../../../handover/wakeCandidates.js";
import { deferredAttemptForRetry, foldWakeJournal, type WakeRetryError } from "../../../handover/wakeJournal.js";
import { readWakeJournal } from "../../../handover/wakeJournalStore.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import type { HandoverWakeDeps } from "./wakeRows.js";

/**
 * The longest a `--retry` waits for the backoff to open. Past it the window is the next tick's, twenty minutes
 * apart, so a longer wait would only hold a background job over a tick that reads the park anyway. The backoff's own
 * cap (`../../../live/machine/spawnBackoff.ts` `SPAWN_BACKOFF_MAX_SECONDS`) is the most one held reading earns.
 */
const MAX_RETRY_WAIT_MS = 15 * 60_000;

/** The deferred attempt `--retry <nonce>` resolved to: the one park it names, and the backoff wait it took. */
export interface WakeRetry {
  readonly nonce: string;
  readonly slug: string;
  readonly parkIndex: number;
  readonly parkedAtIso: string;
  readonly retryAfterIso: string;
  /** Zero when the backoff had already opened; a dry run never waits, so it stops on 4 before one opens. */
  readonly waitedMs: number;
}

/** Where a retry stops short of judging its park: the exit, every line already written. */
interface RetryStop {
  readonly kind: "stop";
  readonly exit: number;
}

/** What waiting on a `--retry` came to: the park to judge, or the exit and why the retry stops here. */
type RetryAwaited =
  | { readonly kind: "target"; readonly retry: WakeRetry }
  | { readonly kind: "stop"; readonly exit: number; readonly lines: readonly string[] };

/** The park a `--retry` judges, as the one candidate standing after its wait. */
interface RetryTarget {
  readonly kind: "target";
  readonly retry: WakeRetry;
  readonly candidates: readonly WakeCandidate[];
}

/**
 * The exit a `--retry` stops on: an unknown nonce is the argv's mistake, an attempt that never deferred is nothing
 * to do, and a deferral whose instant did not read or an attempt with no settlement at all is
 * a reseat that may still be OWED, which the next tick takes.
 */
function retryStopExit({ error }: { error: WakeRetryError }): number {
  switch (error.code) {
    case "RETRY_NONCE_UNKNOWN":
      return EXIT_USAGE;
    case "RETRY_NONCE_AMBIGUOUS":
      return EXIT_ERROR;
    case "RETRY_NOT_DEFERRED":
      return EXIT_EXPECTED_EMPTY;
    case "RETRY_NO_INSTANT":
    case "RETRY_UNSETTLED":
      return EXIT_DEFERRED;
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/**
 * Resolve `--retry <nonce>` against the wake journal and wait out the backoff it recorded, at most
 * {@link MAX_RETRY_WAIT_MS}.
 *
 * @param nonce the attempt `handover wake` printed beside its deferral
 * @returns the park to judge, or 1 on an unreadable journal, 2 on an unknown nonce, 3 on an attempt that never
 *   settled as something other than a deferral, 4 on an unsettled attempt, a deferral with no retry instant, one
 *   opening past the retry window, or a dry run whose backoff has not opened yet (it never sleeps, so the reseat is
 *   still owed)
 */
async function awaitRetry({
  deps,
  dryRun,
  home,
  nonce,
}: {
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  nonce: string;
}): Promise<RetryAwaited> {
  const rows = readWakeJournal({ home });
  if (rows.isErr()) {
    return { exit: EXIT_ERROR, kind: "stop", lines: [rows.error.message] };
  }
  const deferred = deferredAttemptForRetry({ attempts: foldWakeJournal({ rows: rows.value }), nonce });
  if (deferred.isErr()) {
    return { exit: retryStopExit({ error: deferred.error }), kind: "stop", lines: [deferred.error.message] };
  }
  const { attempt, retryAfterIso } = deferred.value;
  const waitMs = Math.max(0, Date.parse(retryAfterIso) - deps.now().getTime());
  if (waitMs > MAX_RETRY_WAIT_MS) {
    return {
      exit: EXIT_DEFERRED,
      kind: "stop",
      lines: [
        `the backoff opens at ${retryAfterIso}, past the ${String(MAX_RETRY_WAIT_MS / 60_000)}-minute retry window; the next tick's wake judges ${attempt.slug}`,
      ],
    };
  }
  if (dryRun && waitMs > 0) {
    return {
      exit: EXIT_DEFERRED,
      kind: "stop",
      lines: [
        `dry run: would wait ${String(waitMs)}ms for the backoff opening ${retryAfterIso}, then judge ${attempt.slug}'s park again; nothing was spawned`,
      ],
    };
  }
  if (waitMs > 0) {
    await deps.sleep({ ms: waitMs });
  }
  return {
    kind: "target",
    retry: {
      nonce,
      parkedAtIso: attempt.parkedAtIso,
      parkIndex: attempt.parkIndex,
      retryAfterIso,
      slug: attempt.slug,
      waitedMs: waitMs,
    },
  };
}

/**
 * Wait out a `--retry`'s backoff, read the board again and narrow it to the one park the nonce names.
 *
 * @param nonce the attempt `handover wake` printed beside its deferral
 * @returns the park to judge, or where the retry stops — {@link awaitRetry}'s stops, 1 on a board or wake journal
 *   that did not read after the wait, 4 on a park the rescan could not judge, 3 on one that no longer stands
 */
export async function retryTarget({
  deps,
  dryRun,
  home,
  nonce,
}: {
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  nonce: string;
}): Promise<RetryTarget | RetryStop> {
  const awaited = await awaitRetry({ deps, dryRun, home, nonce });
  if (awaited.kind === "stop") {
    awaited.lines.forEach((line) => {
      deps.writeDiagnostic(`handover wake --retry: ${line}`);
    });
    return { exit: awaited.exit, kind: "stop" };
  }
  const { retry } = awaited;
  // The board is read again: the wait may have outlasted the park, and a re-park is a new park the tick judges.
  const rescanned = wakeCandidates({ home, rerunAllowed: deps.rerunAllowed });
  if (rescanned.isErr()) {
    deps.writeDiagnostic(`handover wake: the board did not read — ${rescanned.error.message}`);
    return { exit: EXIT_ERROR, kind: "stop" };
  }
  // Read again after the wait whatever the rescan holds, before it narrows to the target: a retry resolved its nonce
  // from this journal, so one that broke during the wait fails it even when its own park has gone.
  if (wakeJournalFault({ deps, home, required: true })) {
    return { exit: EXIT_ERROR, kind: "stop" };
  }
  // Stated residue: a park is named by slug, index and instant, so a run journal recreated with a park
  // at the same index and the same millisecond reads as the nonce's park. It is a standing, due park either way, so
  // the retry reseats one the next plain wake would; closing it needs a journal incarnation id on the park.
  const candidates = rescanned.value.candidates.filter(
    (candidate) =>
      candidate.slug === retry.slug &&
      candidate.parkIndex === retry.parkIndex &&
      candidate.parked.atIso === retry.parkedAtIso,
  );
  if (candidates.length > 0) {
    return { candidates, kind: "target", retry };
  }
  // A slug two docs share, or a journal that will not read, drops out of the candidates with its park standing,
  // so its absence proves nothing and the reseat may still be owed.
  const unjudged = whyUnjudged({ scan: rescanned.value, slug: retry.slug });
  if (unjudged !== undefined) {
    deps.writeDiagnostic(
      `handover wake --retry: ${retry.slug}'s park of ${retry.parkedAtIso} could not be judged (${unjudged}), so nothing was spawned and the next tick takes it`,
    );
    return { exit: EXIT_DEFERRED, kind: "stop" };
  }
  deps.writeDiagnostic(
    `handover wake --retry: ${retry.slug}'s park of ${retry.parkedAtIso} no longer stands, so there is nothing to retry`,
  );
  return { exit: EXIT_EXPECTED_EMPTY, kind: "stop" };
}

/**
 * Whether the wake journal will not read when this run depends on it, naming the fault when it does. A plain wake
 * depends on it whenever any park carries a wake, not only once one is due: a journal that will not read fails the
 * tick it is first seen on, rather than lying unseen until a park comes due over it.
 *
 * @param required whether this run depends on the journal; when not, nothing is read
 * @returns true when the journal did not read and the run must stop, its diagnostic already written
 */
export function wakeJournalFault({
  deps,
  home,
  required,
}: {
  deps: HandoverWakeDeps;
  home: string;
  required: boolean;
}): boolean {
  if (!required) {
    return false;
  }
  const journal = readWakeJournal({ home });
  if (journal.isOk()) {
    return false;
  }
  deps.writeDiagnostic(
    `handover wake: the wake journal did not read — ${journal.error.message}; no park reseats until it is repaired`,
  );
  return true;
}

/** Why the scan left a slug unjudged, when it did: a slug two docs share, or a run journal that did not read. */
function whyUnjudged({
  scan,
  slug,
}: {
  scan: { readonly duplicateSlugs: readonly string[]; readonly unreadable: readonly string[] };
  slug: string;
}): string | undefined {
  if (scan.duplicateSlugs.includes(slug)) {
    return "two board docs share the slug";
  }
  if (scan.unreadable.includes(`${slug} (journal)`)) {
    return "its run journal did not read";
  }
  return undefined;
}
