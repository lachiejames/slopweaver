/**
 * What one kind's walk accumulates while its calls complete, and how one completed call folds into it.
 *
 * Split out of `syncEngine.ts`, which schedules the calls: this half is the pure fold and owns no I/O, so it
 * is read, and tested, without a client, a clock or a journal.
 */
import { appendAll } from "../../lib/arrays.js";
import type { AtlasDroppedField, AtlasProjection } from "../kit/projection.js";
import type { JumpcloudEntity } from "./entities.js";
import type { JumpcloudReadError } from "./errors.js";
import type { JumpcloudResumeEntry } from "./resume.js";
import type { JumpcloudObservedRecords } from "./syncEntities.js";

/** A mutable accumulator, private to the walk. */
export interface JumpcloudAccumulator {
  entities: JumpcloudEntity[];
  projections: AtlasProjection[];
  journalledDrops: AtlasDroppedField[];
  providerIds: string[];
  providerIdsBySurface: Record<string, string[]>;
  firstAt: string | null;
  lastAt: string | null;
  failures: { surface: string; error: JumpcloudReadError }[];
  emptyOperations: string[];
  incompleteOperations: string[];
  clearableIncomplete: string[];
  declaredTotal: number | null;
  pagesExhausted: boolean;
  resumed: number;
}

/**
 * A fresh, empty accumulator.
 *
 * @returns an accumulator that has seen no call: no epoch, no ids, no declared total, pages exhausted
 */
export function emptyJumpcloudAccumulator(): JumpcloudAccumulator {
  return {
    declaredTotal: null,
    clearableIncomplete: [],
    emptyOperations: [],
    entities: [],
    failures: [],
    firstAt: null,
    incompleteOperations: [],
    lastAt: null,
    pagesExhausted: true,
    journalledDrops: [],
    projections: [],
    providerIds: [],
    providerIdsBySurface: {},
    resumed: 0,
  };
}

/** The first total any call of this kind declared, kept once seen; until then, whatever this entry declares. */
function firstDeclaredTotal({
  accumulator,
  entry,
}: {
  accumulator: JumpcloudAccumulator;
  entry: JumpcloudResumeEntry;
}) {
  if (accumulator.declaredTotal !== null) {
    return accumulator.declaredTotal;
  }
  return entry.declaredTotal;
}

/**
 * Fold one journalled or freshly-read call into its kind's accumulator.
 *
 * The epoch is widened by the entry's OWN instant rather than by this run's clock, so a generation
 * assembled across a restart reports the interval its data was actually read over.
 *
 * @param accumulator the kind's accumulator, mutated in place
 * @param entry the completed call, journalled or fresh
 * @param observed the entities, projections and ids that call's records yielded
 */
export function absorbJumpcloudCall({
  accumulator,
  entry,
  observed,
}: {
  accumulator: JumpcloudAccumulator;
  entry: JumpcloudResumeEntry;
  observed: JumpcloudObservedRecords;
}): void {
  accumulator.firstAt = accumulator.firstAt === null || entry.at < accumulator.firstAt ? entry.at : accumulator.firstAt;
  accumulator.lastAt = accumulator.lastAt === null || entry.at > accumulator.lastAt ? entry.at : accumulator.lastAt;
  appendAll({ from: observed.entities, into: accumulator.entities });
  appendAll({ from: observed.projections, into: accumulator.projections });
  // An entry an older build journalled carries no `dropped` at all — it named no removals to fold in.
  if (entry.dropped !== undefined) {
    appendAll({ from: entry.dropped, into: accumulator.journalledDrops });
  }
  appendAll({ from: observed.providerIds, into: accumulator.providerIds });
  const seenForSurface = accumulator.providerIdsBySurface[entry.surface];
  if (seenForSurface === undefined) {
    accumulator.providerIdsBySurface[entry.surface] = [...observed.providerIds];
  } else {
    appendAll({ from: observed.providerIds, into: seenForSurface });
  }
  accumulator.declaredTotal = firstDeclaredTotal({ accumulator, entry });
  accumulator.pagesExhausted = accumulator.pagesExhausted && entry.pagesExhausted;
  if (entry.empty) {
    accumulator.emptyOperations.push(entry.surface);
  }
  if (!entry.complete) {
    accumulator.incompleteOperations.push(entry.surface);
    if (entry.incompleteIsClearable) {
      accumulator.clearableIncomplete.push(`${entry.surface} at ${entry.endpoint}: ${entry.reason}`);
    }
  }
}
