/**
 * The rows an applied store import writes into the standing-ask register, apart from the SQL. Pure.
 *
 * Each imported ask lands the way the owner's answer said. One the owner activated, or took over the live asks it met, is a
 * `recorded` event like any `profile standing` write, numbered past the journal's highest; each live ask it replaces is
 * withdrawn first by its own `withdrawn` event, so the journal an export carries folds to exactly what the tables
 * hold. One the owner left inactive is a generation with its coverage and NO event: audit state the journal never mentions,
 * which `./standingAskProjection.ts` reads as such and an export leaves out.
 *
 * Every event is `store-import`, every generation names the question that admitted it, and every line is read back
 * with the journal's own grammar before it is written, as `./standingAskWrites.ts` does.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type StandingAskError, StandingAskErrors } from "./standingAskErrors.js";
import { activeStandingAsksOf } from "./standingAskProjection.js";
import {
  coverageRowsOf,
  nextJournalSeq,
  type StoredStandingAsk,
  type StoredStandingAskCoverage,
  type StoredStandingAskEvent,
  type StoredStandingAsks,
  standingAskRowOf,
} from "./standingAskRecords.js";
import { admitStandingAsk, parseStandingAskEvent, type StandingAsk, standingAskLine } from "./standingAsks.js";

/** One imported ask and what the owner's answer made of it. */
export interface ImportedStandingAskVersion {
  readonly ask: StandingAsk;
  /** `activate` and `take-imported` are active; `leave-inactive` is not. */
  readonly state: "active" | "inactive";
  /** The import question whose answer admitted it. */
  readonly questionId: string;
  /** The live asks withdrawn before it is recorded — `take-imported` only, re-derived from the fresh plan. */
  readonly withdraws: readonly string[];
}

/** Every row an applied import changes, and how many rows that is. */
export interface StandingAskImportRows {
  /** The active generations set `withdrawn`; their coverage follows by the cascading key. */
  readonly withdrawRowIds: readonly string[];
  readonly asks: readonly (StoredStandingAsk & { readonly importQuestionId: string })[];
  readonly coverage: readonly StoredStandingAskCoverage[];
  readonly events: readonly StoredStandingAskEvent[];
  /** Every row inserted or updated, each cascaded coverage row included. */
  readonly writes: number;
}

/** The register as the fold so far leaves it, threaded through each version in turn. */
interface Draft {
  active: readonly StandingAsk[];
  journalSeq: number;
  withdrawRowIds: string[];
  asks: (StoredStandingAsk & { readonly importQuestionId: string })[];
  coverage: StoredStandingAskCoverage[];
  events: StoredStandingAskEvent[];
  writes: number;
}

/** Refuse a line every later read would refuse, with the reader's own grammar. */
function readBack({ exactLine }: { exactLine: string }): Result<true, StandingAskError> {
  const parsed = parseStandingAskEvent({ line: exactLine, number: 1 });
  if (parsed.isErr()) {
    return err(StandingAskErrors.writeUnreadable({ why: parsed.error.message }));
  }
  return ok(true);
}

/** Withdraw one live ask the imported one replaces, as its own `withdrawn` event. */
function withdraw({
  draft,
  stored,
  id,
  questionId,
  withdrawnAtIso,
}: {
  draft: Draft;
  stored: StoredStandingAsks;
  id: string;
  questionId: string;
  withdrawnAtIso: string;
}): Result<true, StandingAskError> {
  const generation = stored.asks.find((one) => one.askId === id && one.state === "active");
  if (generation === undefined || !draft.active.some((one) => one.id === id)) {
    return err(StandingAskErrors.writeConflict({ reason: `the import replaces ${id}, which no longer stands` }));
  }
  const reason = `replaced by an applied store import, question ${questionId}`;
  const exactLine = standingAskLine({ event: { id, kind: "withdrawn", reason, withdrawnAtIso } });
  return readBack({ exactLine }).map(() => {
    const cascaded = stored.coverage.filter((row) => row.askRowId === generation.rowId).length;
    draft.withdrawRowIds.push(generation.rowId);
    draft.events.push({
      askRowId: generation.rowId,
      exactLine,
      journalSeq: draft.journalSeq,
      kind: "withdrawn",
      origin: "store-import",
    });
    draft.journalSeq += 1;
    draft.active = draft.active.filter((one) => one.id !== id);
    draft.writes += 2 + cascaded;
    return true as const;
  });
}

/**
 * Withdraw every live ask one imported version replaces. A live ask two imported asks both take over is withdrawn once,
 * by the first; one gone before this apply read the register still refuses, since only a withdrawal THIS fold made is
 * recorded in `withdrawnHere`.
 */
function withdrawReplaced({
  draft,
  stored,
  version,
  withdrawnAtIso,
  withdrawnHere,
}: {
  draft: Draft;
  stored: StoredStandingAsks;
  version: ImportedStandingAskVersion;
  withdrawnAtIso: string;
  withdrawnHere: Set<string>;
}): Result<true, StandingAskError> {
  for (const id of version.withdraws) {
    if (withdrawnHere.has(id)) {
      continue;
    }
    const withdrawn = withdraw({ draft, id, questionId: version.questionId, stored, withdrawnAtIso });
    if (withdrawn.isErr()) {
      return err(withdrawn.error);
    }
    withdrawnHere.add(id);
  }
  return ok(true);
}

/** Record one imported ask: active, with its event, after the register admits it; inactive, with none. */
function record({
  draft,
  version,
  mintId,
}: {
  draft: Draft;
  version: ImportedStandingAskVersion;
  mintId: () => string;
}): Result<true, StandingAskError> {
  const rowId = mintId();
  const { ask, questionId, state } = version;
  const generationOf = ({ recordedSeq }: { recordedSeq: number | null }): void => {
    draft.asks.push({
      ...standingAskRowOf({ ask, origin: "store-import", recordedSeq, state }),
      importQuestionId: questionId,
      rowId,
    });
    draft.coverage.push(...coverageRowsOf({ ask, askRowId: rowId, state }));
    draft.writes += 1 + ask.covers.length;
  };
  if (state === "inactive") {
    generationOf({ recordedSeq: null });
    return ok(true);
  }
  const exactLine = standingAskLine({ event: { kind: "recorded", ...ask } });
  return admitStandingAsk({ active: draft.active, ask })
    .andThen(() => readBack({ exactLine }))
    .map(() => {
      generationOf({ recordedSeq: draft.journalSeq });
      draft.events.push({
        askRowId: rowId,
        exactLine,
        journalSeq: draft.journalSeq,
        kind: "recorded",
        origin: "store-import",
      });
      draft.journalSeq += 1;
      draft.active = [...draft.active, ask];
      draft.writes += 1;
      return true as const;
    });
}

/**
 * The refusal for the first version that would withdraw live asks while written inactive — a pair no answer produces,
 * since only `take-imported` withdraws and it writes the import active.
 *
 * @returns `STANDING_ASK_IMPORT_ANSWER_CONTRADICTORY` naming that version's ask, or undefined when every pair is one
 *   an answer gives
 */
export function contradictoryStandingAskVersion({
  versions,
}: {
  versions: readonly ImportedStandingAskVersion[];
}): StandingAskError | undefined {
  const contradictory = versions.find((version) => version.state !== "active" && version.withdraws.length > 0);
  if (contradictory === undefined) {
    return undefined;
  }
  return StandingAskErrors.importAnswerContradictory({ id: contradictory.ask.id });
}

/**
 * The rows an applied import writes into the standing-ask register, judged against the register as one transaction
 * read it: every replacement withdrawn by its own event first, then each imported ask recorded or left inactive. A
 * live ask more than one imported ask replaces is withdrawn once.
 *
 * @param stored the WHOLE register, read inside the apply transaction under the standing-ask lock
 * @param versions the imported asks, in the order the plan lists them
 * @param withdrawnAtIso the instant every replacement withdrawal records
 * @param mintId a fresh row id per call
 * @returns the rows and their count, or the register's refusal: a version withdrawing live asks while written
 *   inactive (before anything is judged), a replacement that no longer stands, an ask the register would not admit,
 *   or a line its grammar would not read
 */
export function standingAskImportRows({
  stored,
  versions,
  withdrawnAtIso,
  mintId,
}: {
  stored: StoredStandingAsks;
  versions: readonly ImportedStandingAskVersion[];
  withdrawnAtIso: string;
  mintId: () => string;
}): Result<StandingAskImportRows, StandingAskError> {
  const contradiction = contradictoryStandingAskVersion({ versions });
  if (contradiction !== undefined) {
    return err(contradiction);
  }
  const active = activeStandingAsksOf({ stored });
  if (active.isErr()) {
    return err(active.error);
  }
  const draft: Draft = {
    active: active.value,
    asks: [],
    coverage: [],
    events: [],
    journalSeq: nextJournalSeq({ events: stored.events }),
    withdrawRowIds: [],
    writes: 0,
  };
  const withdrawnHere = new Set<string>();
  for (const version of versions) {
    const withdrawn = withdrawReplaced({ draft, stored, version, withdrawnAtIso, withdrawnHere });
    if (withdrawn.isErr()) {
      return err(withdrawn.error);
    }
    const recorded = record({ draft, mintId, version });
    if (recorded.isErr()) {
      return err(recorded.error);
    }
  }
  const { active: _active, journalSeq: _journalSeq, ...rows } = draft;
  return ok(rows);
}
