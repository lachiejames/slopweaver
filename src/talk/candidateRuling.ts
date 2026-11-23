/**
 * A spoken ruling on a mined workstream candidate, written to that candidate the same turn — the write whose absence
 * made the console voice re-present candidates the owner had already answered.
 *
 * `talk relay` calls this once the owner's words are on the board, when the voice named the candidate it read them and the
 * word their reaction was. The row goes through `../workstreams/candidateStore.ts`'s critical section, the one writer
 * of the reactions ledger that `recordReactions` runs, under the same ledgers' lock, so a yes promotes a workstream
 * exactly as a typed one does; it keeps the owner's transcribed words as
 * `heard`, so a later reading can say what they said, and carries provenance `talk:<turnId>`.
 *
 * ## A replay writes nothing twice
 *
 * The relay is idempotent on its turn, and so is this: a row this turn already wrote for the same candidate and word
 * means the write is done. A row this turn wrote for a DIFFERENT candidate or word is refused rather than overwritten
 * — one turn carries one ruling, and a replay that names another is not this turn's. The turn's digest binds the
 * ruling too (`relayDraft.ts`), so such a replay conflicts before it reaches here even when the first write failed
 * and left no row; this check is the second line, for a row written some other way.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { CandidateCatalog } from "../workstreams/candidateCatalog.js";
import type { CandidatesError } from "../workstreams/candidateErrors.js";
import { readCandidateCatalog, readReactionRows } from "../workstreams/candidateStore.js";
import type { Candidate, Reaction, ReactionRow } from "../workstreams/candidates.js";
import { underLedgerLock } from "../workstreams/ledgerLock.js";
import { recordUnderLock } from "../workstreams/reactionStore.js";
import type { WorkstreamStore } from "../workstreams/store/port.js";

/** The candidate the voice read the owner and the word their reaction was. */
export interface CandidateVerdict {
  readonly candidate: string;
  readonly reaction: Reaction;
}

/** What one relayed ruling came to. */
export interface CandidateRuling {
  readonly candidate: string;
  readonly reaction: Reaction;
  /** Whether this run wrote the row; `false` on a replay that found it already written. */
  readonly written: boolean;
  /**
   * Why the register tile a yes needed was not written, when the row was and the promotion is owed — the row is the
   * owner's ruling, so the candidate is ruled either way.
   */
  readonly promotionOwed: string | null;
}

/** No candidate carries the id the voice named. */
export interface CandidateUnknownError {
  readonly code: "CANDIDATE_UNKNOWN";
  readonly message: string;
  readonly candidate: string;
}

/** This turn already recorded a different ruling, so the one now named is not this turn's. */
export interface TurnRuledOtherwiseError {
  readonly code: "TURN_RULED_OTHERWISE";
  readonly message: string;
  readonly turnId: string;
}

/** Why a relayed ruling on a candidate was not recorded. */
export type CandidateRulingError = CandidateUnknownError | TurnRuledOtherwiseError | CandidatesError;

/** Builds every {@link CandidateRulingError} this module owns. */
export const CandidateRulingErrors = {
  turnRuledOtherwise: ({ turnId, held }: { turnId: string; held: ReactionRow }): TurnRuledOtherwiseError => ({
    code: "TURN_RULED_OTHERWISE",
    message: `turn ${turnId} already recorded ${held.candidate} as ${held.reaction} — one turn carries one ruling`,
    turnId,
  }),
  unknown: ({ candidate }: { candidate: string }): CandidateUnknownError => ({
    candidate,
    code: "CANDIDATE_UNKNOWN",
    message: `no candidate has the id ${candidate} — the owner's words are on the board, and the candidate is still open`,
  }),
} as const;

/**
 * The provenance a relayed ruling carries.
 *
 * @returns `talk:<turnId>`, the `bySession` of the row the turn writes
 */
function candidateRulingSession({ turnId }: { turnId: string }): string {
  return `talk:${turnId}`;
}

/**
 * Whether a relayed ruling still needs its row written, over the candidates and the ledger as they stand — pure, so
 * the replay and the refusals are unit tests.
 *
 * @param catalog every candidate the owner can rule on, stated and mined alike
 * @param rows every reactions.jsonl row, in file order
 * @param verdict the candidate and the word the voice relayed
 * @param turnId the relay's turn, which makes a replay find its own row
 * @returns whether to write, or why the ruling is refused
 */
export function planCandidateRuling({
  catalog,
  rows,
  verdict,
  turnId,
}: {
  catalog: { readonly candidates: readonly Candidate[] };
  rows: readonly ReactionRow[];
  verdict: CandidateVerdict;
  turnId: string;
}): Result<{ readonly write: boolean }, CandidateRulingError> {
  // The ledger is checked before the file: a row this turn wrote stays the owner's ruling even when a re-mine since dropped
  // the candidate, so a replay answers recorded rather than unknown.
  const held = turnHolds({ rows, turnId, verdict });
  if (held.isErr()) {
    return err(held.error);
  }
  if (held.value) {
    return ok({ write: false });
  }
  if (!catalog.candidates.some((one) => one.id === verdict.candidate)) {
    return err(CandidateRulingErrors.unknown({ candidate: verdict.candidate }));
  }
  return ok({ write: true });
}

/**
 * Whether this turn already wrote its row for the verdict, from the ledger alone — what a replay is answered by
 * before the candidates file is read at all.
 *
 * @param rows every reactions.jsonl row, in file order
 * @returns `true` when the turn's row is held, or why the turn's row is not this verdict's
 */
function turnHolds({
  rows,
  verdict,
  turnId,
}: {
  rows: readonly ReactionRow[];
  verdict: CandidateVerdict;
  turnId: string;
}): Result<boolean, TurnRuledOtherwiseError> {
  const bySession = candidateRulingSession({ turnId });
  const mine = rows.filter((row) => row.bySession === bySession);
  // The exact row answers first: a second row carrying this session (`workstreams react --by-session` can write one)
  // does not make the ruling this turn did record read as unrecorded.
  if (mine.some((row) => row.candidate === verdict.candidate && row.reaction === verdict.reaction)) {
    return ok(true);
  }
  const other = mine.find((row) => row.candidate !== verdict.candidate || row.reaction !== verdict.reaction);
  if (other !== undefined) {
    return err(CandidateRulingErrors.turnRuledOtherwise({ held: other, turnId }));
  }
  return ok(false);
}

/**
 * Record the owner's spoken ruling on the candidate the voice read them, in the ledger under `home`.
 *
 * @param home the state home whose candidates and ledger are read and written
 * @param verdict the candidate and the word the owner's reaction was
 * @param heard the owner's transcribed words, kept on the row; empty when the page attached none
 * @param anchor the relay row's anchor, where the owner said it
 * @param turnId the relay's turn
 * @param nowIso when the ruling is recorded
 * @param store the workstream register a yes promotes into
 * @param mintId the fresh canonical UUID each written entry takes
 * @returns what was recorded, or why nothing was
 */
export async function applyCandidateRuling({
  heard,
  home,
  nowIso,
  turnId,
  verdict,
  ...carried
}: {
  home: string;
  verdict: CandidateVerdict;
  heard: string;
  anchor: string;
  turnId: string;
  nowIso: string;
  store: WorkstreamStore;
  mintId: () => string;
}): Promise<Result<CandidateRuling, CandidateRulingError>> {
  // The ledger is append-only, so a row this turn already wrote stays written: a replay that finds it is answered
  // without the lock or the candidates file, and so never reads as unrecorded while another writer holds the lock or
  // the file will not read.
  const before = readReactionRows({ home });
  if (before.isErr()) {
    return err(before.error);
  }
  const held = turnHolds({ rows: before.value, turnId, verdict });
  if (held.isErr()) {
    return err(held.error);
  }
  if (held.value) {
    return ok({ candidate: verdict.candidate, promotionOwed: null, reaction: verdict.reaction, written: false });
  }
  const catalog = readCandidateCatalog({ home });
  if (catalog.isErr()) {
    return err(catalog.error);
  }
  const settled = planCandidateRuling({ catalog: catalog.value, rows: before.value, turnId, verdict });
  if (settled.isErr()) {
    return err(settled.error);
  }
  if (!settled.value.write) {
    return ok({ candidate: verdict.candidate, promotionOwed: null, reaction: verdict.reaction, written: false });
  }
  // Not yet written, so the check runs again with the append in one critical section: a page retry racing the first
  // attempt finds the first one's row rather than appending a second.
  return underLedgerLock({
    home,
    nowIso,
    run: ({ locked }) =>
      rulingUnderLock({
        ...carried,
        ...keptWords({ heard, verdict }),
        catalog: catalog.value,
        home: locked,
        nowIso,
        turnId,
        verdict,
      }),
  });
}

/**
 * The owner's words as the row keeps them, and the reason an abandoned word carries.
 *
 * @param heard the transcribed words, empty when the page attached none
 * @returns the words, `null` when none were heard, and the reason, `null` for any word but abandoned
 */
function keptWords({ heard, verdict }: { heard: string; verdict: CandidateVerdict }): {
  kept: string | null;
  reason: string | null;
} {
  const words = heard.trim();
  let kept: string | null = null;
  if (words.length > 0) {
    kept = words;
  }
  let reason: string | null = null;
  if (verdict.reaction === "abandoned") {
    // An abandoned row carries why, in the owner's words; with none heard, the ledger refuses it and says so.
    reason = kept;
  }
  return { kept, reason };
}

/**
 * The relay's ruling once the ledgers' lock is held: plan against the ledger as it stands, then write if this turn
 * has not.
 *
 * @param kept the owner's words as the row keeps them, `null` when none were heard
 * @param reason why an abandoned word ended its entry, in the owner's words
 * @returns what was recorded, or why nothing was
 */
async function rulingUnderLock({
  catalog,
  home,
  kept,
  turnId,
  verdict,
  ...carried
}: {
  home: string;
  catalog: CandidateCatalog;
  verdict: CandidateVerdict;
  kept: string | null;
  reason: string | null;
  anchor: string;
  turnId: string;
  nowIso: string;
  store: WorkstreamStore;
  mintId: () => string;
}): Promise<Result<CandidateRuling, CandidateRulingError>> {
  const rows = readReactionRows({ home });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const planned = planCandidateRuling({ catalog, rows: rows.value, turnId, verdict });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const ruling = { candidate: verdict.candidate, reaction: verdict.reaction };
  if (!planned.value.write) {
    return ok({ ...ruling, promotionOwed: null, written: false });
  }
  const recorded = await recordUnderLock({
    ...carried,
    bySession: candidateRulingSession({ turnId }),
    catalog,
    heard: kept,
    home,
    picks: [verdict],
    via: "word",
  });
  if (recorded.isErr() && recorded.error.code === "PROMOTION_OWED") {
    // The row is appended before the register write is tried, so the owner's ruling stands; only the workstream is owed.
    return ok({ ...ruling, promotionOwed: recorded.error.message, written: true });
  }
  if (recorded.isErr() && rowLanded({ catalog, home, turnId, verdict })) {
    // The append can land its bytes and still throw (an fsync refused after the write), so the ledger read again is
    // the answer: a row this turn holds is the owner's ruling recorded.
    return ok({ ...ruling, promotionOwed: null, written: true });
  }
  if (recorded.isErr()) {
    return err(recorded.error);
  }
  return ok({ ...ruling, promotionOwed: null, written: true });
}

/**
 * Whether the ledger, read again, holds this turn's row for the verdict — what a failed write is judged by.
 *
 * @returns `true` only when the re-read succeeds and finds the row
 */
function rowLanded({
  home,
  catalog,
  verdict,
  turnId,
}: {
  home: string;
  catalog: CandidateCatalog;
  verdict: CandidateVerdict;
  turnId: string;
}): boolean {
  const rows = readReactionRows({ home });
  if (rows.isErr()) {
    return false;
  }
  const planned = planCandidateRuling({ catalog, rows: rows.value, turnId, verdict });
  return planned.isOk() && !planned.value.write;
}
