/**
 * What one read of the store's standing-ask register answers, and the check that makes it the journal's answer.
 * Pure.
 *
 * `standing_ask_event` is the authority: a read FOLDS its exact lines with the grammar a journal file was folded
 * with (`./standingAsks.ts`). `standing_ask` and its coverage are the projection the database indexes, and EVERY
 * generation in it — withdrawn ones too — is checked against the line that recorded it and the state the journal
 * leaves it in. A projection edited apart from its journal is a refusal, never a second answer and never a silent
 * edit to a withdrawn ask an export would later carry.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type StandingAskError, StandingAskErrors } from "./standingAskErrors.js";
import type {
  StoredStandingAsk,
  StoredStandingAskCoverage,
  StoredStandingAskEvent,
  StoredStandingAsks,
} from "./standingAskRecords.js";
import {
  applyStandingAskEvent,
  parseStandingAskEvent,
  type StandingAsk,
  type StandingAskEvent,
} from "./standingAsks.js";

/** One stored event beside what its line parses to. */
interface ParsedStoredEvent {
  readonly stored: StoredStandingAskEvent;
  readonly event: StandingAskEvent;
}

/** One stored generation as the ask it projects, its covers in their recorded order. */
function projectedAsk({
  ask,
  coverage,
}: {
  ask: StoredStandingAsk;
  coverage: readonly StoredStandingAskCoverage[];
}): StandingAsk {
  const covers = coverage
    .filter((row) => row.askRowId === ask.rowId)
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .map((row) => row.coverage);
  return {
    covers,
    id: ask.askId,
    quote: {
      anchor: ask.quoteAnchor,
      atIso: ask.quoteAt,
      cut: ask.quoteCut,
      where: ask.quoteWhere,
      words: ask.quoteWords,
    },
    recordedAtIso: ask.recordedAt,
  };
}

/** Whether two asks are the same ask, field for field, covers in order. */
function sameAsk({ left, right }: { left: StandingAsk; right: StandingAsk }): boolean {
  return (
    left.id === right.id &&
    left.recordedAtIso === right.recordedAtIso &&
    left.quote.anchor === right.quote.anchor &&
    left.quote.atIso === right.quote.atIso &&
    left.quote.cut === right.quote.cut &&
    left.quote.where === right.quote.where &&
    left.quote.words === right.quote.words &&
    left.covers.length === right.covers.length &&
    left.covers.every((coverage, at) => coverage === right.covers[at])
  );
}

/**
 * Parse the stored journal in order, checking each line reads as the kind its row declares.
 *
 * @param events every event the store holds
 * @returns each event beside its parse, or the first that does not read
 */
function parsedJournal({
  events,
}: {
  events: readonly StoredStandingAskEvent[];
}): Result<readonly ParsedStoredEvent[], StandingAskError> {
  const parsed: ParsedStoredEvent[] = [];
  for (const stored of events.toSorted((left, right) => left.journalSeq - right.journalSeq)) {
    const event = parseStandingAskEvent({ line: stored.exactLine, number: stored.journalSeq });
    if (event.isErr()) {
      return err(event.error);
    }
    if (event.value.kind !== stored.kind) {
      return err(
        StandingAskErrors.rowUnreadable({
          why: `event ${String(stored.journalSeq)} is stored as ${stored.kind} and its line reads as ${event.value.kind}`,
        }),
      );
    }
    parsed.push({ event: event.value, stored });
  }
  return ok(parsed);
}

/**
 * Why one event's generation is not the one its line describes, or undefined when it is.
 *
 * @param entry the event and its parse
 * @param generation the stored generation the event names
 * @param coverage every stored coverage row
 * @param withdrawn the generations some withdrawal names
 * @param withdrawsSeq on a withdrawal, the `recorded_seq` of the generation the journal's order says it withdraws
 * @returns the reason, or undefined
 */
function generationMismatch({
  entry,
  generation,
  coverage,
  withdrawn,
  withdrawsSeq,
}: {
  entry: ParsedStoredEvent;
  generation: StoredStandingAsk;
  coverage: readonly StoredStandingAskCoverage[];
  withdrawn: ReadonlySet<string>;
  withdrawsSeq: number | undefined;
}): string | undefined {
  const seq = String(entry.stored.journalSeq);
  if (entry.event.kind === "withdrawn") {
    // The link is checked against the journal's ORDER, never trusted: two content-identical generations of one id
    // would otherwise let a withdrawal and the two states be swapped together, each still looking consistent.
    return generation.askId === entry.event.id && generation.recordedSeq === withdrawsSeq
      ? undefined
      : `withdrawal ${seq} names a generation other than the one the journal withdraws`;
  }
  const { kind: _kind, ...recorded } = entry.event;
  if (
    generation.recordedSeq !== entry.stored.journalSeq ||
    !sameAsk({ left: projectedAsk({ ask: generation, coverage }), right: recorded })
  ) {
    return `generation ${generation.askId} is not the ask its recording event ${seq} records`;
  }
  const expected = withdrawn.has(generation.rowId) ? "withdrawn" : "active";
  if (generation.state !== expected) {
    return `generation ${generation.askId} is stored ${generation.state} and the journal leaves it ${expected}`;
  }
  return undefined;
}

/**
 * Why a stored row's writer cannot be the one the journal implies, or undefined when every one can be.
 *
 * @param stored one read of the whole register
 * @param parsed its journal, parsed, in journal order
 * @returns the reason, or undefined
 */
function originRefusal({
  stored,
  parsed,
}: {
  stored: StoredStandingAsks;
  parsed: readonly ParsedStoredEvent[];
}): string | undefined {
  // The one-time import writes the journal's first events, and every later write numbers past them. So the imported
  // events are a PREFIX; with the marker's count and contiguous sequences, exactly 1 … N. A count alone would accept
  // two origins swapped together.
  const inOrder = parsed.map((entry) => entry.stored);
  const firstLater = inOrder.findIndex((one) => one.origin !== "legacy-file");
  const lateImport =
    firstLater === -1 ? undefined : inOrder.slice(firstLater).find((one) => one.origin === "legacy-file");
  if (lateImport !== undefined) {
    return `event ${String(lateImport.journalSeq)} is from legacy-file and follows an event a later writer recorded`;
  }
  // Only an applied store import leaves a generation inactive, and it records no event for one.
  const strayInactive = stored.asks.find((one) => one.state === "inactive" && one.origin !== "store-import");
  if (strayInactive !== undefined) {
    return `generation ${strayInactive.askId} is inactive and from ${strayInactive.origin}, which never leaves one inactive`;
  }
  return undefined;
}

/**
 * Why the stored rows are not shaped as the journal's writers leave them — coverage outside its generation's
 * state, covers numbered other than in order, or a generation count other than the journal's recordings.
 *
 * @param stored one read of the whole register
 * @param parsed its journal, parsed
 * @param byRow every stored generation by its row id
 * @returns the reason, or undefined
 */
function rowShapeRefusal({
  stored,
  parsed,
  byRow,
}: {
  stored: StoredStandingAsks;
  parsed: readonly ParsedStoredEvent[];
  byRow: ReadonlyMap<string, StoredStandingAsk>;
}): string | undefined {
  const stray = stored.coverage.find((row) => byRow.get(row.askRowId)?.state !== row.state);
  if (stray !== undefined) {
    return `coverage ${stray.coverage} does not sit under a generation in its state`;
  }
  // Every writer numbers a generation's covers 0, 1, 2 … in the order its line lists them. Sorting by ordinal and
  // comparing the strings would accept any order-preserving renumbering, so the numbering is checked as itself.
  const misnumbered = stored.asks.find((ask) =>
    stored.coverage
      .filter((row) => row.askRowId === ask.rowId)
      .map((row) => row.ordinal)
      .toSorted((left, right) => left - right)
      .some((ordinal, at) => ordinal !== at),
  );
  if (misnumbered !== undefined) {
    return `generation ${misnumbered.askId} numbers its coverage other than 0, 1, 2 in order`;
  }
  // An inactive imported generation is audit state no event recorded, so the journal counts only the rest.
  const recordings = parsed.filter((entry) => entry.stored.kind === "recorded").length;
  const recorded = stored.asks.filter((ask) => ask.state !== "inactive").length;
  if (recordings !== recorded) {
    return `the journal records ${String(recordings)} generation(s) and the tables hold ${String(recorded)} recorded`;
  }
  const namedInactive = parsed.find((entry) => byRow.get(entry.stored.askRowId)?.state === "inactive");
  if (namedInactive !== undefined) {
    return `event ${String(namedInactive.stored.journalSeq)} names an inactive generation, which no event records`;
  }
  return undefined;
}

/**
 * Walk the journal in order and check each event's generation: stored, from the writer that recorded it, the ask
 * its line records, in the state the journal leaves it, and on a withdrawal the generation the order withdraws.
 *
 * @param stored one read of the whole register
 * @param parsed its journal, parsed, in journal order
 * @param byRow every stored generation by its row id
 * @returns the reason, or undefined
 */
function journalWalkRefusal({
  stored,
  parsed,
  byRow,
}: {
  stored: StoredStandingAsks;
  parsed: readonly ParsedStoredEvent[];
  byRow: ReadonlyMap<string, StoredStandingAsk>;
}): string | undefined {
  const withdrawn = new Set(
    parsed.filter((entry) => entry.stored.kind === "withdrawn").map((entry) => entry.stored.askRowId),
  );
  // Each id's latest recording, walked in journal order: what a withdrawal at this point withdraws.
  const latestRecordingOf = new Map<string, number>();
  for (const entry of parsed) {
    const generation = byRow.get(entry.stored.askRowId);
    if (generation === undefined) {
      return `event ${String(entry.stored.journalSeq)} names no stored generation`;
    }
    if (entry.stored.kind === "recorded" && entry.stored.origin !== generation.origin) {
      return `generation ${generation.askId} is stored from ${generation.origin} and its recording event ${String(entry.stored.journalSeq)} from ${entry.stored.origin}`;
    }
    let withdrawsSeq: number | undefined;
    if (entry.event.kind === "withdrawn") {
      withdrawsSeq = latestRecordingOf.get(entry.event.id);
      latestRecordingOf.delete(entry.event.id);
    } else {
      latestRecordingOf.set(entry.event.id, entry.stored.journalSeq);
    }
    const mismatch = generationMismatch({ coverage: stored.coverage, entry, generation, withdrawn, withdrawsSeq });
    if (mismatch !== undefined) {
      return mismatch;
    }
  }
  return undefined;
}

/**
 * Check every stored generation and coverage row against the journal: one generation per recording, each the
 * ask its line records, from the writer that recorded it, in the state the journal leaves it, and no coverage
 * outside its generation's state.
 *
 * @param stored one read of the whole register
 * @param parsed its journal, parsed
 * @returns the reason it does not read, or undefined
 */
function projectionRefusal({
  stored,
  parsed,
}: {
  stored: StoredStandingAsks;
  parsed: readonly ParsedStoredEvent[];
}): string | undefined {
  const byRow = new Map(stored.asks.map((ask) => [ask.rowId, ask]));
  const checks = [
    () => originRefusal({ parsed, stored }),
    () => rowShapeRefusal({ byRow, parsed, stored }),
    () => journalWalkRefusal({ byRow, parsed, stored }),
  ];
  for (const check of checks) {
    const why = check();
    if (why !== undefined) {
      return why;
    }
  }
  return undefined;
}

/**
 * Why a stored sequence cannot be trusted as itself, or undefined when every one can. Both sequence columns are
 * `bigint` read as a JavaScript number, and past `Number.MAX_SAFE_INTEGER` two different values read alike, so a
 * generation could stand for two recordings and the checks below would not see it. Nothing this register writes
 * comes near that, so such a value is a store edited by hand.
 */
function unsafeSequence({ stored }: { stored: StoredStandingAsks }): string | undefined {
  const event = stored.events.find((one) => !Number.isSafeInteger(one.journalSeq) || one.journalSeq < 1);
  if (event !== undefined) {
    return `event sequence ${String(event.journalSeq)} is not a positive safe integer`;
  }
  // An inactive imported generation carries no sequence, by the table's CHECK, and every other one carries one.
  const misrecorded = stored.asks.find((one) => (one.recordedSeq === null) !== (one.state === "inactive"));
  if (misrecorded !== undefined) {
    return `generation ${misrecorded.askId} is ${misrecorded.state} with recorded sequence ${String(misrecorded.recordedSeq)}: only an inactive one carries none`;
  }
  const generation = stored.asks.find(
    (one) => one.recordedSeq !== null && (!Number.isSafeInteger(one.recordedSeq) || one.recordedSeq < 1),
  );
  if (generation !== undefined) {
    return `generation ${generation.askId} has recorded sequence ${String(generation.recordedSeq)}, not a positive safe integer`;
  }
  // Every writer numbers the journal 1, 2, 3 …: the import by line, a write as the highest plus one under the lock.
  // A gap is an event removed from under the rest, which the fold of what remains cannot see.
  const ordered = stored.events.map((one) => one.journalSeq).toSorted((left, right) => left - right);
  const gap = ordered.findIndex((seq, at) => seq !== at + 1);
  if (gap !== -1) {
    return `event sequence ${String(ordered[gap]!)} stands at position ${String(gap + 1)}: the journal has a gap`;
  }
  return undefined;
}

/**
 * The asks standing now: the journal's fold, once every stored generation — withdrawn ones included — is the one
 * its own recording line describes, in the state the journal leaves it.
 *
 * @param stored one read of the WHOLE register: every generation, every coverage row, every event
 * @returns the active asks in the order recorded, or why the register does not read
 */
export function activeStandingAsksOf({
  stored,
}: {
  stored: StoredStandingAsks;
}): Result<readonly StandingAsk[], StandingAskError> {
  const unsafe = unsafeSequence({ stored });
  if (unsafe !== undefined) {
    return err(StandingAskErrors.rowUnreadable({ why: unsafe }));
  }
  const parsed = parsedJournal({ events: stored.events });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  let active: readonly StandingAsk[] = [];
  for (const { event } of parsed.value) {
    const applied = applyStandingAskEvent({ active, event });
    if (applied.isErr()) {
      return err(applied.error);
    }
    active = applied.value;
  }
  const refused = projectionRefusal({ parsed: parsed.value, stored });
  if (refused !== undefined) {
    return err(StandingAskErrors.rowUnreadable({ why: refused }));
  }
  // The checks above already pin every generation to its line, its state and its withdrawal; the property they add
  // up to — the active projection IS the fold — is stated here once more as itself, so a later edit to one of them
  // cannot quietly weaken it.
  const projected = stored.asks
    .filter((ask) => ask.state === "active")
    // Every generation carries a sequence: `unsafeSequence` refused the register otherwise.
    .toSorted((left, right) => left.recordedSeq! - right.recordedSeq!)
    .map((ask) => projectedAsk({ ask, coverage: stored.coverage }));
  const agrees =
    projected.length === active.length && projected.every((ask, at) => sameAsk({ left: ask, right: active[at]! }));
  if (!agrees) {
    return err(
      StandingAskErrors.rowUnreadable({
        why: `the tables hold ${String(projected.length)} active ask(s) that are not the ${String(active.length)} the journal folds to`,
      }),
    );
  }
  return ok(active);
}
