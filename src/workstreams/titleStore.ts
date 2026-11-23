/**
 * Recording the title a person gives a candidate — the effectful half of `./titles.ts`.
 *
 * One critical section under the ledgers' lock (`./ledgerLock.ts`), because a title given AFTER the yes is carried
 * onto the workstream the yes made. Everything that could refuse is read first, so a refusal records nothing. Row
 * first, register second, the order `./definitionStore.ts` keeps: a register write that fails leaves a row the
 * workstream does not carry yet, and the same call again appends nothing and repairs it.
 *
 * Only a workstream the owner's own word PROMOTED from this candidate is renamed. A candidate they named as the same
 * as an existing workstream, or one the register already held, is their title for the candidate, never a rename of a
 * workstream they had already named themselves.
 */
import { err, ok, type Result } from "#lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import { candidateById, readTitleRows, standingOf } from "./candidateStore.js";
import type { Candidate, ReactionVia } from "./candidates.js";
import { appendEntries } from "./candidateTile.js";
import { appendLedgerRows } from "./ledgerAppend.js";
import { underLedgerLock } from "./ledgerLock.js";
import { noteEntry, takesNotes } from "./placement.js";
import type { CandidateState } from "./reactionFold.js";
import { aggregateOf } from "./reactionStore.js";
import type { WorkstreamStore } from "./store/port.js";
import type { WorkstreamAggregate, WorkstreamRegisterSnapshot } from "./store/types.js";
import { latestTitles, type TitleRow, titleRowSchema } from "./titles.js";

/** What one `recordTitle` call did. */
export interface TitleReceipt {
  readonly row: TitleRow;
  /** False when the same title already stood, so nothing was appended. */
  readonly appended: boolean;
  /** The register id renamed (or already carrying it), or `null` when no workstream was promoted from it yet. */
  readonly appliedTo: string | null;
}

/**
 * The dated note a retitled workstream keeps its mined name in. No retry compares it: `renameOnto` returns before
 * writing one when the workstream already carries the title.
 *
 * @internal
 * @param minedName the name the candidate was mined under
 * @returns the note's text
 */
export function retitleNote({ minedName }: { minedName: string }): string {
  return `The owner retitled this from the mined name "${minedName}"`;
}

/**
 * Record the title a person gives one candidate; when a yes, done or abandoned word already made it a register
 * workstream, that workstream takes the title with a dated note keeping the mined name.
 *
 * @param home the state home, the resolved one when absent
 * @param nowIso the instant it was given, which is also the lock's clock
 * @param candidateId the candidate retitled
 * @param title the title, in their words
 * @param store the workstream register
 * @param mintId the fresh canonical UUID the note takes
 * @returns what was written, or why nothing was
 */
export async function recordTitle({
  home,
  nowIso,
  candidateId,
  title,
  via,
  bySession,
  store,
  mintId,
}: {
  home?: string;
  nowIso: string;
  candidateId: string;
  title: string;
  via: ReactionVia;
  bySession: string;
  store: WorkstreamStore;
  mintId: () => string;
}): Promise<Result<TitleReceipt, CandidatesError>> {
  return underLedgerLock({
    home,
    nowIso,
    run: ({ locked }) => titleUnderLock({ bySession, candidateId, home: locked, mintId, nowIso, store, title, via }),
  });
}

/**
 * The critical section {@link recordTitle} runs once it holds the lock.
 *
 * @returns what was written, or why nothing was
 */
async function titleUnderLock({
  home,
  nowIso,
  candidateId,
  title,
  via,
  bySession,
  store,
  mintId,
}: {
  home: string;
  nowIso: string;
  candidateId: string;
  title: string;
  via: ReactionVia;
  bySession: string;
  store: WorkstreamStore;
  mintId: () => string;
}): Promise<Result<TitleReceipt, CandidatesError>> {
  const found = candidateById({ candidateId, home, refusal: CandidatesErrors.amendmentRefused });
  if (found.isErr()) {
    return err(found.error);
  }
  const candidate = found.value;
  const said = title.trim();
  if (said.length === 0) {
    return err(CandidatesErrors.amendmentRefused({ problems: ["a title says something"] }));
  }
  const rows = readTitleRows({ home });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const placed = await standingOf({ candidateId: candidate.id, home, store });
  if (placed.isErr()) {
    return err(placed.error);
  }
  const standing = latestTitles({ rows: rows.value }).get(candidate.id);
  const repeat = standing === said;
  const row: TitleRow = { bySession, candidate: candidate.id, iso: nowIso, name: candidate.name, title: said, via };
  if (!repeat) {
    const appended = appendLedgerRows({
      path: stateHomePaths({ home }).workstreamsTitlesJsonl,
      refusal: CandidatesErrors.amendmentRefused,
      rows: [row],
      schema: titleRowSchema,
    });
    if (appended.isErr()) {
      return err(appended.error);
    }
  }
  const renamed = await renameOnto({ candidate, home, mintId, nowIso, store, title: said, ...placed.value });
  return renamed.map((appliedTo) => ({ appended: !repeat, appliedTo, row }));
}

/**
 * Rename the workstream the owner's own word promoted from this candidate, noting the mined name among its entries when it
 * keeps a story.
 *
 * @param state the candidate's latest word, read before the row was appended
 * @param register the register as read before the row was appended; empty when the store holds nothing yet
 * @returns the register id renamed or already carrying the title, `null` when none was promoted, or the refusal
 */
async function renameOnto({
  candidate,
  home,
  mintId,
  nowIso,
  store,
  title,
  state,
  register,
}: {
  candidate: Candidate;
  home: string;
  mintId: () => string;
  nowIso: string;
  store: WorkstreamStore;
  title: string;
  state: CandidateState | undefined;
  register: WorkstreamRegisterSnapshot;
}): Promise<Result<string | null, CandidatesError>> {
  const promoted = state?.promotedAs;
  if (promoted == null) {
    return ok(null);
  }
  const entry = register.workstreams.find((one) => one.id === promoted);
  if (entry === undefined) {
    return ok(null);
  }
  if (entry.name === title) {
    return ok(entry.id);
  }
  let renamed: WorkstreamAggregate = { ...aggregateOf({ stored: entry }), name: title };
  if (takesNotes({ workstream: renamed })) {
    const note = noteEntry({ nowIso, text: retitleNote({ minedName: entry.name }) });
    renamed = { ...renamed, entries: appendEntries({ entries: renamed.entries, mintId, pending: [note] }) };
  }
  const written = await store.applyBatch({
    deletes: [],
    home,
    writes: [{ aggregate: renamed, expectedRevision: entry.revision }],
  });
  if (written.isErr()) {
    return err(CandidatesErrors.titleOwed({ candidate: candidate.id, cause: written.error }));
  }
  return ok(entry.id);
}
