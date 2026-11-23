/**
 * The standing-ask register as the store holds it, with no I/O: its rows, what the one-time import of the home
 * journal writes, and the lines an export carries. What a read answers is `./standingAskProjection.ts`; one
 * `profile standing` write is `./standingAskWrites.ts`.
 *
 * `standing_ask_event` keeps every event's exact line in `journal_seq` order, so an export writes the journal's
 * identical nonblank event lines in order. `standing_ask` and its coverage are the projection the database
 * enforces its unique indexes over.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { HisWordsCut, HisWordsWhere } from "../handover/hisWords.js";
import { type StandingAskError } from "./standingAskErrors.js";
import { applyStandingAskEvent, parseStandingAskEvent, type StandingAsk } from "./standingAsks.js";

/**
 * Every state a generation can stand in, in the order the store's `standing_ask_state` type declares them:
 * active, stored but not yet in effect, or withdrawn.
 */
export const STANDING_ASK_STATES = ["active", "inactive", "withdrawn"] as const;

/** Whether one generation stands behind a card. */
type StandingAskState = (typeof STANDING_ASK_STATES)[number];

/**
 * Every writer a generation or an event can name, in the order the store's `standing_ask_origin` type declares
 * them. `store-import` is an applied store import's, written by `./standingAskImportRows.ts` alone.
 */
export const STANDING_ASK_ORIGINS = ["legacy-file", "profile", "store-import"] as const;

/** Which writer produced a generation or an event; it never changes, so the import's rows say `legacy-file`. */
type StandingAskOrigin = (typeof STANDING_ASK_ORIGINS)[number];

/** One stored generation of one ask, as a read returns it. */
export interface StoredStandingAsk {
  readonly rowId: string;
  readonly askId: string;
  readonly state: StandingAskState;
  readonly origin: StandingAskOrigin;
  readonly quoteAnchor: string;
  readonly quoteAt: string;
  readonly quoteCut: HisWordsCut;
  readonly quoteWhere: HisWordsWhere;
  readonly quoteWords: string;
  readonly recordedAt: string;
  /** Null only on an inactive imported generation, which no journal event recorded. */
  readonly recordedSeq: number | null;
}

/** One card kind one generation covers. */
export interface StoredStandingAskCoverage {
  readonly askRowId: string;
  readonly ordinal: number;
  readonly coverage: string;
  readonly state: StandingAskState;
}

/** One journal event, its exact line beside the generation it belongs to. */
export interface StoredStandingAskEvent {
  readonly journalSeq: number;
  readonly askRowId: string;
  readonly kind: "recorded" | "withdrawn";
  readonly origin: StandingAskOrigin;
  readonly exactLine: string;
}

/** What one read of the register returns: every generation, every coverage row and every event. */
export interface StoredStandingAsks {
  readonly asks: readonly StoredStandingAsk[];
  readonly coverage: readonly StoredStandingAskCoverage[];
  readonly events: readonly StoredStandingAskEvent[];
}

/** One nonblank line of the home journal, at its 1-based place in the file. */
export interface StandingAskHomeFileLine {
  readonly number: number;
  readonly line: string;
}

/**
 * One event the one-time import writes: its line kept exactly, its sequence the line's nonblank ordinal, and — on a
 * recording — the ask with the state the whole journal's fold leaves it in.
 */
export type ImportedStandingAskEvent =
  | {
      readonly kind: "recorded";
      readonly journalSeq: number;
      readonly exactLine: string;
      readonly ask: StandingAsk;
      readonly finalState: "active" | "withdrawn";
    }
  | {
      readonly kind: "withdrawn";
      readonly journalSeq: number;
      readonly exactLine: string;
      /** The `journal_seq` of the recording it withdraws. */
      readonly recordedSeq: number;
    };

/**
 * The events the one-time import writes, folded first so a journal that does not fold imports nothing. Each line's
 * sequence is its nonblank ordinal, and each recording carries the state the WHOLE journal leaves its generation in.
 *
 * @param lines the home journal's nonblank lines, in file order
 * @returns the events, or the first line that breaks the register
 */
export function importedStandingAskEvents({
  lines,
}: {
  lines: readonly StandingAskHomeFileLine[];
}): Result<readonly ImportedStandingAskEvent[], StandingAskError> {
  let active: readonly StandingAsk[] = [];
  const recordedSeqOf = new Map<string, number>();
  const withdrawn = new Set<number>();
  const drafts: ({ readonly line: string; readonly journalSeq: number } & (
    | { readonly kind: "recorded"; readonly ask: StandingAsk }
    | { readonly kind: "withdrawn"; readonly recordedSeq: number }
  ))[] = [];
  for (const [at, { line, number }] of lines.entries()) {
    const journalSeq = at + 1;
    const event = parseStandingAskEvent({ line, number });
    if (event.isErr()) {
      return err(event.error);
    }
    const applied = applyStandingAskEvent({ active, event: event.value });
    if (applied.isErr()) {
      return err(applied.error);
    }
    active = applied.value;
    if (event.value.kind === "withdrawn") {
      // The fold admitted the withdrawal, so the id names an active generation.
      const recordedSeq = recordedSeqOf.get(event.value.id)!;
      recordedSeqOf.delete(event.value.id);
      withdrawn.add(recordedSeq);
      drafts.push({ journalSeq, kind: "withdrawn", line, recordedSeq });
      continue;
    }
    const { kind: _kind, ...ask } = event.value;
    recordedSeqOf.set(ask.id, journalSeq);
    drafts.push({ ask, journalSeq, kind: "recorded", line });
  }
  return ok(
    drafts.map((draft): ImportedStandingAskEvent => {
      if (draft.kind === "withdrawn") {
        return {
          exactLine: draft.line,
          journalSeq: draft.journalSeq,
          kind: "withdrawn",
          recordedSeq: draft.recordedSeq,
        };
      }
      const finalState = withdrawn.has(draft.journalSeq) ? "withdrawn" : "active";
      return { ask: draft.ask, exactLine: draft.line, finalState, journalSeq: draft.journalSeq, kind: "recorded" };
    }),
  );
}

/**
 * One generation's columns, as a write inserts them.
 *
 * @param ask the ask the generation records
 * @param recordedSeq the `journal_seq` of the event recording it, null for an inactive imported generation none records
 * @returns the row, its id the database's to mint
 */
export function standingAskRowOf({
  ask,
  origin,
  state,
  recordedSeq,
}: {
  ask: StandingAsk;
  origin: StandingAskOrigin;
  state: StandingAskState;
  recordedSeq: number | null;
}): Omit<StoredStandingAsk, "rowId"> {
  return {
    askId: ask.id,
    origin,
    quoteAnchor: ask.quote.anchor,
    quoteAt: ask.quote.atIso,
    quoteCut: ask.quote.cut,
    quoteWhere: ask.quote.where,
    quoteWords: ask.quote.words,
    recordedAt: ask.recordedAtIso,
    recordedSeq,
    state,
  };
}

/**
 * One generation's coverage rows, in the order its `covers` lists them.
 *
 * @param askRowId the generation they belong to
 * @param state the generation's state, which each row carries
 * @returns the rows
 */
export function coverageRowsOf({
  ask,
  askRowId,
  state,
}: {
  ask: StandingAsk;
  askRowId: string;
  state: StandingAskState;
}): readonly StoredStandingAskCoverage[] {
  return ask.covers.map((coverage, ordinal) => ({ askRowId, coverage, ordinal, state }));
}

/**
 * The register's portable lines, as an export writes them.
 *
 * @param events every event the store holds
 * @returns each event's exact line, in journal order
 */
export function standingAskExportLines({ events }: { events: readonly StoredStandingAskEvent[] }): readonly string[] {
  return events.toSorted((left, right) => left.journalSeq - right.journalSeq).map((event) => event.exactLine);
}

/**
 * The sequence the next event takes: one past the highest the journal holds, so it orders after every one.
 *
 * @param events every event the store holds
 * @returns the next `journal_seq`, 1 on an empty journal
 */
export function nextJournalSeq({ events }: { events: readonly StoredStandingAskEvent[] }): number {
  return events.reduce((highest, event) => Math.max(highest, event.journalSeq), 0) + 1;
}

/** The rows one write or one import inserts, ids minted by the caller so an event can name its generation. */
export interface StandingAskInsertRows {
  readonly asks: readonly StoredStandingAsk[];
  readonly coverage: readonly StoredStandingAskCoverage[];
  readonly events: readonly StoredStandingAskEvent[];
}

/**
 * Every row the one-time import inserts: each recording a generation in the state the journal's fold leaves it,
 * each withdrawal an event naming the generation it withdrew. Every row is `legacy-file`.
 *
 * @param events the import's events, in journal order
 * @param mintId a fresh row id per call
 * @returns the rows
 */
export function importedStandingAskRows({
  events,
  mintId,
}: {
  events: readonly ImportedStandingAskEvent[];
  mintId: () => string;
}): StandingAskInsertRows {
  const asks: StoredStandingAsk[] = [];
  const coverage: StoredStandingAskCoverage[] = [];
  const stored: StoredStandingAskEvent[] = [];
  const rowOfSeq = new Map<number, string>();
  for (const event of events) {
    const base = { exactLine: event.exactLine, journalSeq: event.journalSeq, origin: "legacy-file" as const };
    if (event.kind === "withdrawn") {
      // The import's fold admitted the withdrawal, so the recording it names was inserted before it.
      stored.push({ ...base, askRowId: rowOfSeq.get(event.recordedSeq)!, kind: "withdrawn" });
      continue;
    }
    const rowId = mintId();
    rowOfSeq.set(event.journalSeq, rowId);
    const row = standingAskRowOf({
      ask: event.ask,
      origin: "legacy-file",
      recordedSeq: event.journalSeq,
      state: event.finalState,
    });
    asks.push({ ...row, rowId });
    coverage.push(...coverageRowsOf({ ask: event.ask, askRowId: rowId, state: event.finalState }));
    stored.push({ ...base, askRowId: rowId, kind: "recorded" });
  }
  return { asks, coverage, events: stored };
}
