/**
 * How many docs move ready→done, per day, and how long that takes — read from the run journals
 * (`../handover/ledger.js`'s `RunEvent`s), never guessed from a handover doc's own `status` field, which
 * only ever shows the CURRENT state and carries no history of when it got there.
 *
 * A journal may carry more than one run cycle (a follow-up, a re-run after an amendment) — `../handover/
 * ledger.js`'s own `currentCycle` deliberately keeps only the LAST one, because every other reader of a
 * journal cares about "where is this doc right now". This module cares about "how many times, and how
 * fast", so it walks every cycle rather than just the last — its own small fold, kept local rather than
 * bolted onto `ledger.js`'s cycle helper, the same way `../handover/boardTypes.js`'s `runDisposition`
 * already keeps its own fold apart from `ledger.js`'s `runStateOf` for the same reason: two different
 * questions asked of the same events.
 *
 * Pure throughout: no filesystem, no clock — the caller supplies each journal's already-parsed events.
 */
import type { RunEvent } from "../handover/ledger.js";
import { parseIsoMs } from "../lib/date.js";
import type { DayWindow } from "./windows.js";

/** One doc's slug and its journal's events, in file order. */
export interface RunJournal {
  readonly slug: string;
  readonly events: readonly RunEvent[];
}

/**
 * Split one journal's events into its run cycles — everything from one `started` up to (not including) the
 * next `started`. Events before the first `started` belong to no cycle and are dropped, the same convention
 * `../handover/ledger.js`'s `currentCycle` uses for its own single slice.
 *
 * @param events the journal's events, in order
 * @returns each cycle's events, oldest first
 */
function cyclesOf({ events }: { events: readonly RunEvent[] }): readonly (readonly RunEvent[])[] {
  const cycles: RunEvent[][] = [];
  let current: RunEvent[] = [];
  for (const event of events) {
    if (event.kind === "started") {
      if (current.length > 0) {
        cycles.push(current);
      }
      current = [event];
    } else if (current.length > 0) {
      current.push(event);
    }
  }
  if (current.length > 0) {
    cycles.push(current);
  }
  return cycles;
}

/**
 * One clean landing — a cycle that reached `finished` with no residue (no probe was forced through).
 *
 * @internal — the exported functions below take and return it; nothing outside this file names the shape.
 */
export interface DocLanding {
  readonly slug: string;
  readonly finishedIso: string;
  /** Hours from that cycle's `started` to its `finished`, or `undefined` when the cycle carries no `started`. */
  readonly latencyHours: number | undefined;
}

/**
 * Every clean landing across a board's run journals — one per cycle that reached `finished` with an empty
 * `residue`. A cycle that finished WITH residue (a probe forced through) or that never finished at all
 * contributes nothing here, because neither is the "ready → done" event this measures.
 *
 * @param journals each doc's slug and its journal's events
 * @returns one landing per clean `finished` cycle, unordered
 */
export function docLandings({ journals }: { journals: readonly RunJournal[] }): readonly DocLanding[] {
  const landings: DocLanding[] = [];
  for (const { slug, events } of journals) {
    for (const cycle of cyclesOf({ events })) {
      const landing = landingOf({ cycle, slug });
      if (landing !== undefined) {
        landings.push(landing);
      }
    }
  }
  return landings;
}

/**
 * One cycle's landing, or `undefined` when it never reached a clean ending.
 *
 * A `closed` cycle counts alongside a clean `finished` one: both are the run saying it got there with nothing
 * unmet, and `closed` is the stronger of the two — it says the work SHIPPED. Excluding it would make every
 * landing recorded through `handover close` invisible to velocity.
 *
 * @param cycle one run cycle's events, in order
 * @param slug the doc the cycle belongs to
 * @returns the landing, or `undefined` when the cycle never ended cleanly
 */
function landingOf({ cycle, slug }: { cycle: readonly RunEvent[]; slug: string }): DocLanding | undefined {
  const landed = cycle
    .toReversed()
    .find((event) => (event.kind === "finished" || event.kind === "closed") && event.residue.length === 0);
  if (landed === undefined) {
    return undefined;
  }
  const started = cycle.find((event) => event.kind === "started");
  const startedMs = started === undefined ? undefined : parseIsoMs({ tsIso: started.atIso });
  const finishedMs = parseIsoMs({ tsIso: landed.atIso });
  const latencyHours =
    startedMs === undefined || finishedMs === undefined ? undefined : (finishedMs - startedMs) / 3_600_000;
  return { finishedIso: landed.atIso, latencyHours, slug };
}

/** One day's landing count. */
export interface DayLandingCount {
  readonly dayKey: string;
  readonly landed: number;
}

/**
 * Landings bucketed into each trailing-window day, by the `finished` event's own timestamp.
 *
 * @param landings every landing to bucket
 * @param windows the day windows to bucket into, in order
 * @returns one count per window, in the same order
 */
export function landingsByDay({
  landings,
  windows,
}: {
  landings: readonly DocLanding[];
  windows: readonly DayWindow[];
}): readonly DayLandingCount[] {
  return windows.map((window) => ({
    dayKey: window.dayKey,
    landed: landings.filter(
      (landing) => landing.finishedIso >= window.sinceIso && landing.finishedIso < window.untilIso,
    ).length,
  }));
}

/**
 * Landings whose `finished` event falls inside `[sinceIso, untilIso)`.
 *
 * @param landings every landing to filter
 * @param sinceIso the period's start (inclusive)
 * @param untilIso the period's end (exclusive)
 * @returns landings within the period, unordered
 */
export function landingsInSpan({
  landings,
  sinceIso,
  untilIso,
}: {
  landings: readonly DocLanding[];
  sinceIso: string;
  untilIso: string;
}): readonly DocLanding[] {
  return landings.filter((landing) => landing.finishedIso >= sinceIso && landing.finishedIso < untilIso);
}
