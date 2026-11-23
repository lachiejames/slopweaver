/**
 * The two instants a sync run's rows date it by: when it last did anything, and when it last wrote new rows. Pure.
 * They differ on purpose — a run keeps writing progress and finish rows after its last commit, so "the newest rows"
 * are dated by the commit and never by the run's later activity.
 */
import type { SyncRunEvent } from "./event.js";

/**
 * When the run last did anything: its newest row of any kind, compared as ISO strings.
 *
 * @param events the file's decoded rows, in file order
 * @param startedAtIso its start row's instant, the floor when no later row exists
 * @returns the newest instant any row carries
 */
export function lastActivityIsoOf({
  events,
  startedAtIso,
}: {
  events: readonly SyncRunEvent[];
  startedAtIso: string;
}): string {
  return events.reduce((newest, event) => (event.atIso > newest ? event.atIso : newest), startedAtIso);
}

/**
 * When the newest `committed` row that wrote at least one new row landed.
 *
 * @param events the file's decoded rows, in file order
 * @returns that instant, or `null` when no commit wrote anything
 */
export function lastCommittedIsoOf({ events }: { events: readonly SyncRunEvent[] }): string | null {
  let newest: string | null = null;
  for (const event of events) {
    const wrote = event.type === "committed" && Object.values(event.kinds).some((tally) => tally.written > 0);
    if (wrote && (newest === null || event.atIso > newest)) {
      newest = event.atIso;
    }
  }
  return newest;
}
