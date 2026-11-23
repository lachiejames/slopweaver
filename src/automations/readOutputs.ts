/**
 * The effectful half of `./outputs.ts` and `./steering.ts`: each store read ONCE per status read, then indexed by
 * recipe, so the cost of a read grows with the stores and never with the number of cards. The relay ledger's steers
 * are `./readSteers.ts`'s.
 *
 * Bounded on purpose: the board is never listed — a finding is opened by
 * the one slug its failure derives. An unreadable store is an issue, never an empty reading.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { handRegisterPath, readHandRows } from "../hand/store.js";
import { settledAskOf } from "../handover/askRow.js";
import { readExactDoc } from "../handover/store.js";
import { unsetFieldAsNull } from "../lib/absent.js";
import type { RecipeDefinition } from "../live/automation/definition.js";
import { failureFindingSlug } from "../live/automation/failureHold.js";
import { readFiringPosting } from "../live/automation/postingLedger.js";
import type { RecipeSlotAttempt } from "../live/automation/slotAttempt.js";
import { readReadingIndex } from "../readings/store.js";
import { stateHomePaths } from "../stateHome.js";
import { type FiringView, firingViewsOf } from "./card.js";
import { RECENT_FIRINGS } from "./cardAnswers.js";
import {
  type AutomationOutputs,
  automationOutputs,
  type FindingLookup,
  type NoteOutput,
  type PostingLookup,
  type ReadingOutput,
  recipeActor,
} from "./outputs.js";
import { whatOf } from "./rowAsks.js";
import { type AutomationSteering, automationSteering, type EarliestTrace, type SteerView } from "./steering.js";

/**
 * The gap a store reports when some of its lines would not read, said as an issue too — `null` when every line read,
 * so a partly unreadable store never draws as complete.
 *
 * @param issues where the gap is said
 * @param undecoded how many lines would not read
 * @param what the store's line, in the gap's words
 * @returns the gap, or `null` when every line read
 */
export function undecodedGap({
  issues,
  undecoded,
  what,
}: {
  issues: string[];
  undecoded: number;
  what: string;
}): string | null {
  if (undecoded === 0) {
    return null;
  }
  const gap = `${String(undecoded)} ${what} line(s) would not read — a card may be missing what they held`;
  issues.push(gap);
  return gap;
}

/**
 * Readings grouped by who took them, or none with the reason said.
 *
 * @param home the state home
 * @param issues where an unreadable index is said
 * @returns readings by their `by` value, and why the index would not read when it would not
 */
export function readingsByActor({ home, issues }: { home: string; issues: string[] }): {
  rows: ReadonlyMap<string, readonly ReadingOutput[]>;
  gap: string | null;
} {
  const index = readReadingIndex({ home });
  const byActor = new Map<string, ReadingOutput[]>();
  if (index.isErr()) {
    const gap = `${index.error.message} — no card shows the readings its row took`;
    issues.push(gap);
    return { gap, rows: byActor };
  }
  for (const record of index.value) {
    const reading = { atIso: record.recordedAtIso, bytes: record.bytes, file: record.file, producer: record.producer };
    const list = byActor.get(record.by);
    if (list === undefined) {
      byActor.set(record.by, [reading]);
    } else {
      list.push(reading);
    }
  }
  return { gap: null, rows: byActor };
}

/**
 * Floating notes grouped by who posted them, or none with the reason said.
 *
 * @param home the state home
 * @param issues where an unreadable register is said
 * @returns notes by their `postedBy` value, and why the register would not read when it would not
 */
export function notesByActor({ home, issues }: { home: string; issues: string[] }): {
  rows: ReadonlyMap<string, readonly NoteOutput[]>;
  gap: string | null;
} {
  const read = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  const byActor = new Map<string, NoteOutput[]>();
  if (read.isErr()) {
    const gap = `${read.error.message} — no card shows the floating notes its row put up`;
    issues.push(gap);
    return { gap, rows: byActor };
  }
  for (const row of read.value.rows) {
    if (row.kind !== "posted") {
      continue;
    }
    const { step } = row;
    const note = { atIso: step.postedIso, url: unsetFieldAsNull({ key: "url", record: step }), what: step.what };
    const list = byActor.get(step.postedBy);
    if (list === undefined) {
      byActor.set(step.postedBy, [note]);
    } else {
      list.push(note);
    }
  }
  return { gap: undecodedGap({ issues, undecoded: read.value.unparsed.length, what: "floating-note" }), rows: byActor };
}

/**
 * What the posting ledger holds for one firing.
 *
 * @param home the state home
 * @param recipeId the row
 * @param slotIso the firing
 * @returns the lookup
 */
function postingLookup({
  home,
  recipeId,
  slotIso,
}: {
  home: string;
  recipeId: string;
  slotIso: string;
}): PostingLookup {
  const read = readFiringPosting({ home, recipeId, slotIso });
  if (read.isErr()) {
    return { kind: "unreadable", why: read.error.join("; ") };
  }
  if (read.value === undefined) {
    return { kind: "none" };
  }
  return { kind: "found", posting: read.value };
}

/**
 * The finding a failed or dead firing filed, read by the slug its failure derives — `none` for any other firing.
 *
 * @param home the state home
 * @param recipeId the row
 * @returns the lookup
 */
function findingLookup({
  home,
  recipeId,
  firing,
}: {
  home: string;
  recipeId: string;
  firing: FiringView;
}): FindingLookup {
  if (firing.outcome !== "failed" && firing.outcome !== "dead") {
    return { kind: "none" };
  }
  const slug = failureFindingSlug({ attempt: firing.attempt, recipeId, slotIso: firing.slotIso });
  const read = readExactDoc({ handoverDir: stateHomePaths({ home }).handovers, slug });
  if (read.isErr()) {
    return { kind: "unreadable", why: read.error.message };
  }
  if (read.value === undefined) {
    return { kind: "none" };
  }
  const { doc } = read.value;
  const settled = settledAskOf({ doc });
  let summary: string | null = null;
  if (doc.summary !== undefined) {
    summary = doc.summary;
  } else if (doc.problem !== undefined) {
    summary = doc.problem;
  }
  return {
    finding: { settlement: settled === undefined ? null : settled.settlement, slug, status: doc.status, summary },
    kind: "found",
  };
}

/**
 * When a definition file was created and last written, or `null` for either the filesystem will not say.
 *
 * @param home the state home
 * @param file the definition's file name in the definitions directory
 * @returns the two instants
 */
export function definitionFileDates({ home, file }: { home: string; file: string }): {
  readonly bornIso: string | null;
  readonly editedIso: string | null;
} {
  try {
    const stats = statSync(join(stateHomePaths({ home }).live.recipe.definitionsDir, file));
    // A filesystem that records no birth time reports 0, which is no instant at all.
    const bornIso = stats.birthtimeMs > 0 ? stats.birthtime.toISOString() : null;
    return { bornIso, editedIso: stats.mtime.toISOString() };
  } catch {
    return { bornIso: null, editedIso: null };
  }
}

/** The older of the row file's birth and its oldest firing, named as which, or `null` when neither is known. */
function earliestTraceOf({
  bornIso,
  oldest,
}: {
  bornIso: string | null;
  oldest: FiringView | undefined;
}): { atIso: string; from: EarliestTrace } | null {
  const traces: { atIso: string; from: EarliestTrace }[] = [];
  if (bornIso !== null) {
    traces.push({ atIso: bornIso, from: "file-born" });
  }
  if (oldest !== undefined) {
    traces.push({ atIso: oldest.startedAtIso, from: "oldest-firing" });
  }
  const earliest = traces.toSorted((a, b) => a.atIso.localeCompare(b.atIso))[0];
  if (earliest === undefined) {
    return null;
  }
  return earliest;
}

/** The rows one actor left in a store read once for every card, or none. */
function rowsOf<T>({ store, key }: { store: { rows: ReadonlyMap<string, readonly T[]> }; key: string }): readonly T[] {
  const rows = store.rows.get(key);
  if (rows === undefined) {
    return [];
  }
  return rows;
}

/**
 * One row's outputs and steering, joined from the stores already read once for every card.
 *
 * @param file the row's definition file name
 * @param firings every firing the slot ledger holds for the row
 * @param nextFiringIso when it next fires, or `null`
 * @param readings readings by actor, and why the index would not read
 * @param notes floating notes by actor, and why the register would not read
 * @param steers steers by recipe, and why the relay ledger would not read
 * @returns the card's outputs and steering sections
 */
export function outputsAndSteering({
  definition,
  file,
  firings,
  home,
  nextFiringIso,
  readings,
  notes,
  steers,
}: {
  definition: RecipeDefinition;
  file: string;
  firings: readonly RecipeSlotAttempt[];
  home: string;
  nextFiringIso: string | null;
  readings: { rows: ReadonlyMap<string, readonly ReadingOutput[]>; gap: string | null };
  notes: { rows: ReadonlyMap<string, readonly NoteOutput[]>; gap: string | null };
  steers: { rows: ReadonlyMap<string, readonly SteerView[]>; gap: string | null };
}): { outputs: AutomationOutputs; steering: AutomationSteering } {
  const { recipeId } = definition;
  const views = firingViewsOf({ attempts: firings });
  const actor = recipeActor({ recipeId });
  const postings = new Map<string, PostingLookup>();
  const postingFor = ({ slotIso }: { slotIso: string }): PostingLookup => {
    const known = postings.get(slotIso);
    if (known !== undefined) {
      return known;
    }
    const looked = postingLookup({ home, recipeId, slotIso });
    postings.set(slotIso, looked);
    return looked;
  };
  const outputGaps = [readings.gap, notes.gap].filter((gap): gap is string => gap !== null);
  const outputs = automationOutputs({
    findingFor: ({ firing }) => findingLookup({ firing, home, recipeId }),
    firings: views.slice(0, RECENT_FIRINGS),
    kind: definition.kind,
    notes: rowsOf({ key: actor, store: notes }),
    postingFor,
    readings: rowsOf({ key: actor, store: readings }),
    storeGap: outputGaps.length === 0 ? null : outputGaps.join("; "),
  });
  const dates = definitionFileDates({ file, home });
  const steering = automationSteering({
    earliest: earliestTraceOf({ bornIso: dates.bornIso, oldest: views.at(-1) }),
    editedIso: dates.editedIso,
    firings: views,
    nextFiringIso,
    postingFor,
    recipeId,
    steers: rowsOf({ key: recipeId, store: steers }),
    storeGap: steers.gap,
    what: whatOf({ definition }),
  });
  return { outputs, steering };
}
