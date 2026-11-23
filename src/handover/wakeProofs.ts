/**
 * Whether a wake really did what its exit code says, read back off the run journal: a reseat is believed only when the
 * FIRST line to clear its park is `dispatched`, a finish only when it is `finished`, and the park a seat came up from
 * is the last one this cycle whose first boundary was a dispatch. Kept apart from `./wakeCandidates.ts`, which asks
 * which parks a wake may judge before it acts.
 */

import { currentCycle, type RunEvent } from "./ledger.js";
import { clearsPark } from "./parked.js";
import { readRunJournal } from "./runStore.js";
import { parkKey } from "./wakeJournal.js";

/**
 * Whether a reseat that exited 0 really cleared its park, read back off the journal.
 *
 * @param parkIndex the park's position when the scan found it
 * @returns why nothing proves a seat came up, or `undefined` when the first line to clear the park is `dispatched`
 */
export function reseatUnproven({
  parkIndex,
  runsDir,
  slug,
}: {
  parkIndex: number;
  runsDir: string;
  slug: string;
}): string | undefined {
  return boundaryUnproven({
    expected: "dispatched",
    parkIndex,
    runsDir,
    slug,
    verb: "cmux spawn",
    what: "a seat came up",
  });
}

/**
 * Why a `handover finish` the wake ran on a merged park cannot be believed: the same proof as
 * {@link reseatUnproven}, with `finished` as the line that must clear the park first.
 *
 * @param parkIndex the park's position when the scan found it
 * @returns why nothing proves the run closed, or `undefined` when the first line to clear the park is `finished`
 */
export function finishUnproven({
  parkIndex,
  runsDir,
  slug,
}: {
  parkIndex: number;
  runsDir: string;
  slug: string;
}): string | undefined {
  return boundaryUnproven({
    expected: "finished",
    parkIndex,
    runsDir,
    slug,
    verb: "handover finish",
    what: "the run closed",
  });
}

/** The shared proof: re-read the journal and require `expected` to be the first line to clear the park. */
function boundaryUnproven({
  expected,
  parkIndex,
  runsDir,
  slug,
  verb,
  what,
}: {
  expected: "dispatched" | "finished";
  parkIndex: number;
  runsDir: string;
  slug: string;
  verb: string;
  what: string;
}): string | undefined {
  const after = readRunJournal({ runsDir, slug });
  if (after.isErr()) {
    return `${verb} exited 0 but the journal did not re-read to confirm it: ${after.error.message}`;
  }
  const { events, unreadable } = after.value;
  if (unreadable.length > 0) {
    return `${verb} exited 0 but the journal now carries ${String(unreadable.length)} line(s) this build cannot read, so nothing proves the park cleared`;
  }
  // Judged on the first boundary after THIS park, never on whether a park stands now: a reseated seat that parks
  // again before the spawn returns leaves a park standing behind a real dispatch.
  const next = firstBoundaryAfterPark({ events, parkIndex });
  if (next === undefined) {
    return `${verb} exited 0 but no \`${expected}\` line cleared the park; still parked`;
  }
  if (next.kind !== expected) {
    return `${verb} exited 0 and the park cleared, but not first by a \`${expected}\` line, so nothing proves ${what}`;
  }
  return undefined;
}

/**
 * The first line after a park that ends or replaces it: a replacement park, a new `started` cycle (which
 * `activeParkedCheckpoint` never looks behind), or anything that clears it. Only a `dispatched` there proves the
 * park's seat came up.
 *
 * @param events a run's journal events, in order
 * @param parkIndex the park's position in them
 * @returns that line, or `undefined` while nothing after the park has ended it
 */
function firstBoundaryAfterPark({
  events,
  parkIndex,
}: {
  events: readonly RunEvent[];
  parkIndex: number;
}): RunEvent | undefined {
  return events
    .slice(parkIndex + 1)
    .find((event) => event.kind === "parked" || event.kind === "started" || clearsPark({ event, parkIndex }));
}

/**
 * The park the seat now parked at `parkIndex` came up from: the LAST park before it, in the run's current cycle,
 * whose first boundary is `dispatched`. Only that one reseat can have acted on what the current park waits on — an
 * earlier cycle is another run under the same slug, and an earlier reseat in this cycle was followed by a later one
 * (a wake's, or one after the owner answered) that saw the run more recently.
 *
 * @param events a run's journal events, in order
 * @param parkIndex the current park's position, which lies in the current cycle
 * @returns that park's `parkKey`, or `undefined` when no seat came up from a park before it this cycle
 */
export function lastReseatedParkBefore({
  events,
  parkIndex,
}: {
  events: readonly RunEvent[];
  parkIndex: number;
}): string | undefined {
  const cycleStart = events.length - currentCycle({ events }).length;
  for (let index = parkIndex - 1; index >= cycleStart; index -= 1) {
    const event = events[index]!;
    if (event.kind === "parked" && firstBoundaryAfterPark({ events, parkIndex: index })?.kind === "dispatched") {
      return parkKey({ parkIndex: index, parkedAtIso: event.atIso });
    }
  }
  return undefined;
}
