/**
 * The one released run `handover finish` may close without claiming it first: a run whose seat PARKED.
 *
 * A `parked` line releases the writer it names (`./runRelease.ts`), and a released run refuses every mutating
 * lifecycle verb until a session claims it (`./runOwner.ts`). That refusal protects a run somebody released in
 * order to hand it on. A parked run is a different shape: its seat closed itself, with its state kept, and the
 * only session that would ever claim it is a reseat whose whole job — once its pull request merged — is to run
 * `finish`. `handover wake` therefore asks the real `finish` first (`../cli/commands/handover/wakeFinish.ts`), and
 * this predicate is what lets that ask reach finish's own gates — phase, lessons, checks-read, page, probes —
 * rather than stopping at ownership. Every one of those gates still decides.
 *
 * Narrow on purpose: `finish` only, and only while the CURRENT cycle's last park still stands. A released run
 * with no standing park, and every other verb on a parked one (`ask`, `amend`, `correct`, `offer`, `withdraw`),
 * still refuse as before. A park cleared by a reseat's `dispatched` hands the run back to the seat, and the
 * exception closes with it.
 *
 * **Checked again on the same read the `finished` append makes** ({@link finishOwnershipPrecondition}). finish
 * reaches its write only after slow gates — the lessons store, the page gate, the probes — and a claim or launch
 * landing in that window clears the park and hands the run to a new owner. The verb-time
 * check alone would then close a run underneath that owner; the precondition refuses the append instead.
 *
 * **What that does not close** :`./rowEvent.ts`'s `applyRowEvent` reads, asks the precondition,
 * then appends, with no compare-and-append between them, so a line another process appends inside that window is
 * not seen — the window every precondition on that path shares, not one this module opens. The wake's own reseat
 * cannot land there, because its finish ask and its reseat hold the same per-park wake claim; a hand-run `cmux spawn`
 * of the same row inside that window can. A lock around the journal append is the mechanism that would close it.
 *
 * Pure: the journal's events and the derived ownership in, a verdict out.
 */
import type { RunEvent, RunPhase } from "./ledger.js";
import { activeParkedCheckpoint } from "./parked.js";
import { isUtcInstant } from "./parkWake.js";
import { type RunOwnership, runOwnership } from "./runOwner.js";

/**
 * Whether `handover finish` may proceed past a released run's ownership refusal because its seat parked.
 *
 * @param verb the lifecycle verb asking
 * @param events the run's journal events, in order
 * @param ownership the run's derived ownership for the reading session
 * @param phase the run's derived phase
 * @returns true only for `finish` on an open, released run whose current cycle's park still stands
 */
export function parkedReleaseOpensFinish({
  verb,
  events,
  ownership,
  phase,
}: {
  verb: string;
  events: readonly RunEvent[];
  ownership: RunOwnership;
  phase: RunPhase;
}): boolean {
  return (
    verb === "finish" &&
    ownership.kind === "released" &&
    phase !== "closed" &&
    activeParkedCheckpoint({ events }) !== undefined
  );
}

/** The one park a finish is bound to: its position in the run's journal events, and its own instant. */
export interface BoundPark {
  readonly index: number;
  readonly atIso: string;
}

/** What `--park-index` and `--parked-at` came to: both, neither, or a pair that cannot bind a park. */
export type BoundParkFlags =
  | { readonly kind: "bound"; readonly park: BoundPark }
  | { readonly kind: "unbound" }
  | { readonly kind: "invalid"; readonly why: string };

/**
 * Read the two flags that bind `handover finish` to one park. They travel together: an instant alone matches a
 * re-park that happened to carry the same instant, and an index alone matches whatever later landed there.
 *
 * @param parkIndex `--park-index`, the park's position in the run's journal events
 * @param parkedAt `--parked-at`, the park's own UTC instant
 * @returns the bound park, `unbound` when neither flag is given, or why the pair is refused
 */
export function boundParkFlags({
  parkIndex,
  parkedAt,
}: {
  parkIndex: string | undefined;
  parkedAt: string | undefined;
}): BoundParkFlags {
  if (parkIndex === undefined && parkedAt === undefined) {
    return { kind: "unbound" };
  }
  if (parkIndex === undefined || parkedAt === undefined) {
    return { kind: "invalid", why: "--park-index and --parked-at bind one park together; give both or neither" };
  }
  if (!/^\d+$/.test(parkIndex)) {
    return { kind: "invalid", why: `--park-index must be a journal position, not "${parkIndex}"` };
  }
  if (!isUtcInstant({ text: parkedAt })) {
    return { kind: "invalid", why: `--parked-at must be a UTC instant ending in Z, not "${parkedAt}"` };
  }
  return { kind: "bound", park: { atIso: parkedAt, index: Number(parkIndex) } };
}

/**
 * Why a finish must not run its probes: the caller proved a different `repo:` than the doc names on finish's own read.
 * `handover wake` proves the merge in the doc's repo before it asks, and finish re-reads the doc; a doc rewritten
 * between the two would have finish probe a tree nobody proved. Finish's probes
 * resolve against this same read of `repo:`, so equality here binds the very value they use.
 *
 * @param probedRepo `--probed-repo`, the `repo:` the caller classified and proved against; absent, nothing to bind
 * @param docRepo the `repo:` on finish's own read of the doc
 * @returns the refusal, or `undefined` when no repo was named or the doc still names it
 */
export function probedRepoMoved({
  docRepo,
  probedRepo,
}: {
  docRepo: string | undefined;
  probedRepo: string | undefined;
}): string | undefined {
  if (probedRepo === undefined || docRepo === probedRepo) {
    return undefined;
  }
  const now = docRepo === undefined ? "names no repo:" : `names ${docRepo}`;
  return `--probed-repo ${probedRepo} was proved, but the doc now ${now}, so finish will not probe a tree nobody proved`;
}

/**
 * Why a finish bound to one park must not close the run on this read: that park no longer stands. A wake asks
 * about ONE park, and between its last look and the append a reseat can clear it and the new seat park again —
 * a released run with a park standing, just not the one asked about. The standing park
 * must be the very event at the bound position, carrying the bound instant: an instant alone would match a re-park
 * that carried the same one.
 *
 * @param park the park the finish was asked about
 * @returns the refusal, or `undefined` while that very park still stands
 */
function boundParkGone({ events, park }: { events: readonly RunEvent[]; park: BoundPark }): string | undefined {
  const standing = activeParkedCheckpoint({ events });
  const same =
    standing !== undefined && events[park.index] === standing && Date.parse(standing.atIso) === Date.parse(park.atIso);
  if (same) {
    return undefined;
  }
  return (
    `the park of ${park.atIso} at journal position ${String(park.index)} this finish was asked about no longer ` +
    "stands, so finish will not close the run on its behalf"
  );
}

/**
 * The precondition `handover finish` hands its `finished` append: on the very journal read the append makes, the
 * run is still this session's or nobody's, or still released by a park that stands — never another session's —
 * and, when the finish was bound to one park (`--park-index`, `--parked-at`), that park is the one still standing.
 *
 * @param phase the run's phase as finish resolved it, which the closing lock keeps from moving to closed
 * @param sessionId this session's id, or `undefined` when it could not be determined
 * @param park the one park this finish may close; absent, any park standing
 * @returns a precondition naming why the append is refused, or answering `undefined` to let it through
 */
export function finishOwnershipPrecondition({
  park,
  phase,
  sessionId,
}: {
  park?: BoundPark | undefined;
  phase: RunPhase;
  sessionId: string | undefined;
}): (args: { events: readonly RunEvent[] }) => string | undefined {
  return ({ events }) => {
    if (park !== undefined) {
      const gone = boundParkGone({ events, park });
      if (gone !== undefined) {
        return gone;
      }
    }
    const ownership = runOwnership({ events, sessionId });
    if (ownership.kind !== "elsewhere" && ownership.kind !== "released") {
      return undefined;
    }
    if (parkedReleaseOpensFinish({ events, ownership, phase, verb: "finish" })) {
      return undefined;
    }
    return (
      `session ${ownership.writer.sessionId} took the run while finish was running its gates, so finish ` +
      "will not close it underneath them"
    );
  };
}
