/**
 * Recording what a person says DONE means for a candidate — the effectful half of `./definitions.ts`.
 *
 * One critical section under the ledgers' lock (`./ledgerLock.ts`), because a definition picked AFTER the yes is
 * carried onto the workstream the yes made. Everything that could refuse is read first, so a refusal records nothing.
 * Row first, register second, the same order `./reactionStore.ts` keeps: a register write that fails leaves a row the
 * workstream does not say yet, and the same call again appends nothing and repairs it with one note, since
 * `definitionApplied` judges the workstream rather than the ledger.
 */
import { err, ok, type Result } from "#lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import { candidateById, readDefinitionRows, standingOf } from "./candidateStore.js";
import type { Candidate, ReactionVia } from "./candidates.js";
import {
  type DefinitionRow,
  definitionApplied,
  definitionRowSchema,
  latestDefinitions,
  resolveSelection,
  sameSelection,
} from "./definitions.js";
import { appendLedgerRows } from "./ledgerAppend.js";
import { underLedgerLock } from "./ledgerLock.js";
import { heldAs } from "./promotion.js";
import type { CandidateState } from "./reactionFold.js";
import { aggregateOf } from "./reactionStore.js";
import { DONE_MILESTONE_ID, redefineDone } from "./store/doneMilestone.js";
import type { WorkstreamStore } from "./store/port.js";
import type { WorkstreamRegisterSnapshot } from "./store/types.js";

/** What one `recordDefinition` call did. */
export interface DefinitionReceipt {
  /** The standing definition, appended now or already standing. */
  readonly row: DefinitionRow;
  /** False when the same pick already stood, so nothing was appended. */
  readonly appended: boolean;
  /** The register id the definition was carried onto, or `null` when the candidate is not an accepted workstream yet. */
  readonly appliedTo: string | null;
}

/**
 * Record a definition of done for one candidate: one of its offered options, or the person's own words. An exact
 * repeat of the standing pick appends nothing; when the candidate is already an accepted workstream, its definition
 * of done (the `done` milestone) and its outcome become the definition, with a dated note saying so.
 *
 * @param home the state home, the resolved one when absent
 * @param nowIso the instant it was picked, which is also the lock's clock
 * @param candidateId the candidate the definition is for
 * @param optionId the offered option picked, or `undefined` for their own words
 * @param words their own words, or `undefined` for an offered option
 * @param all every option offered, rather than one; false when absent
 * @param first which of all the options leads, once the owner has said
 * @param stretch the rung beyond their own words, when they gave one
 * @param via where the pick came from
 * @param bySession who recorded it
 * @param store the workstream register
 * @param mintId the fresh canonical UUID the note takes
 * @returns what was written, or why nothing was
 */
export async function recordDefinition({
  home,
  nowIso,
  candidateId,
  optionId,
  words,
  all = false,
  first,
  stretch,
  via,
  bySession,
  store,
  mintId,
}: {
  home?: string;
  nowIso: string;
  candidateId: string;
  optionId: string | undefined;
  words: string | undefined;
  all?: boolean;
  first?: string | undefined;
  stretch?: string | undefined;
  via: ReactionVia;
  bySession: string;
  store: WorkstreamStore;
  mintId: () => string;
}): Promise<Result<DefinitionReceipt, CandidatesError>> {
  const picked = { all, first, optionId, stretch, words };
  return underLedgerLock({
    home,
    nowIso,
    run: ({ locked }) => defineUnderLock({ bySession, candidateId, home: locked, mintId, nowIso, picked, store, via }),
  });
}

/**
 * The critical section {@link recordDefinition} runs once it holds the lock.
 *
 * @returns what was written, or why nothing was
 */
async function defineUnderLock({
  home,
  nowIso,
  candidateId,
  picked,
  via,
  bySession,
  store,
  mintId,
}: {
  home: string;
  nowIso: string;
  candidateId: string;
  picked: {
    all: boolean;
    first: string | undefined;
    optionId: string | undefined;
    stretch: string | undefined;
    words: string | undefined;
  };
  via: ReactionVia;
  bySession: string;
  store: WorkstreamStore;
  mintId: () => string;
}): Promise<Result<DefinitionReceipt, CandidatesError>> {
  const found = candidateById({ candidateId, home, refusal: CandidatesErrors.definitionRefused });
  if (found.isErr()) {
    return err(found.error);
  }
  const candidate = found.value;
  const selection = resolveSelection({ candidate, ...picked });
  if (selection.isErr()) {
    return err(selection.error);
  }
  const rows = readDefinitionRows({ home });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const placed = await standingOf({ candidateId: candidate.id, home, store });
  if (placed.isErr()) {
    return err(placed.error);
  }
  const said = {
    bySession,
    candidate: candidate.id,
    iso: nowIso,
    name: candidate.name,
    selection: selection.value,
    via,
  };
  const stood = standOrAppend({ home, rows: rows.value, said });
  if (stood.isErr()) {
    return err(stood.error);
  }
  const { appended, row } = stood.value;
  const carried = await carryOnto({ candidate, home, mintId, row, store, ...placed.value });
  return carried.map((appliedTo) => ({ appended, appliedTo, row }));
}

/**
 * The standing definition when the pick repeats it exactly, else the new row appended to the ledger.
 *
 * @param rows every definition row, read under the lock
 * @param said the pick as this call would record it
 * @returns the row that now stands and whether it was appended, or the refusal
 */
function standOrAppend({
  home,
  rows,
  said,
}: {
  home: string;
  rows: readonly DefinitionRow[];
  said: DefinitionRow;
}): Result<{ appended: boolean; row: DefinitionRow }, CandidatesError> {
  const standing = latestDefinitions({ rows }).get(said.candidate);
  if (standing !== undefined && sameSelection({ a: standing.selection, b: said.selection })) {
    return ok({ appended: false, row: standing });
  }
  const path = stateHomePaths({ home }).workstreamsDefinitionsJsonl;
  return appendLedgerRows({
    path,
    refusal: CandidatesErrors.definitionRefused,
    rows: [said],
    schema: definitionRowSchema,
  }).map(() => ({ appended: true, row: said }));
}

/**
 * Carry a standing definition onto the workstream its candidate was accepted as, when it was: only a yes makes one,
 * and only an outcome or standing workstream whose definition of done is the `done` milestone has one to rename. No
 * yes, no such workstream, or an echo of some other kind is not a failure — the definition waits in the ledger, and
 * the yes that makes the workstream carries it.
 *
 * @param candidate the candidate the definition is for
 * @param row the standing definition
 * @param state the candidate's latest word, read before the row was appended
 * @param register the register as read before the row was appended; empty when the store holds nothing yet
 * @returns the register id it was carried onto (or already said), `null` when there is no workstream to carry it
 *   onto, or the refusal
 */
async function carryOnto({
  candidate,
  home,
  mintId,
  row,
  state,
  store,
  register,
}: {
  candidate: Candidate;
  home: string;
  mintId: () => string;
  row: DefinitionRow;
  state: CandidateState | undefined;
  store: WorkstreamStore;
  register: WorkstreamRegisterSnapshot;
}): Promise<Result<string | null, CandidatesError>> {
  if (state === undefined || state.reaction !== "yes") {
    return ok(null);
  }
  const holding = heldAs({ candidate, state, workstreams: register.workstreams });
  const entry = register.workstreams.find((one) => one.id === holding);
  const own = entry !== undefined && (entry.kind === "outcome" || entry.kind === "standing");
  if (entry === undefined || !own || !entry.milestones.some((one) => one.id === DONE_MILESTONE_ID)) {
    return ok(null);
  }
  if (definitionApplied({ aggregate: entry, row })) {
    return ok(entry.id);
  }
  const anchor = `candidate:${candidate.id}`;
  const carried = redefineDone({
    aggregate: aggregateOf({ stored: entry }),
    anchor,
    definition: row,
    entryId: mintId(),
  });
  if (carried.isErr()) {
    return err(CandidatesErrors.definitionOwed({ candidate: candidate.id, cause: carried.error }));
  }
  const { revision } = entry;
  const written = await store.applyBatch({
    deletes: [],
    home,
    writes: [{ aggregate: carried.value, expectedRevision: revision }],
  });
  if (written.isErr()) {
    return err(CandidatesErrors.definitionOwed({ candidate: candidate.id, cause: written.error }));
  }
  return ok(entry.id);
}
