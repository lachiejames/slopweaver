/**
 * Recording the owner's reactions — the write path of `./candidateStore.ts`'s ledgers.
 *
 * A reaction that promotes a yes is ONE critical section under the ledgers' lock (`./ledgerLock.ts`): read the
 * register, build the workstreams, judge every one the store would be asked to hold, append the rows, and only then
 * write the register in ONE batch at the revisions it was read at. The two writes cannot be one atomic act, so the
 * order decides what a failure between them leaves. Rows first: a register that would refuse a workstream records
 * nothing, and a register write that fails (or a crash) after the append leaves a yes row naming a workstream that is
 * not there — which `candidatesDocument` reads as a promotion owed, and the next yes promotes exactly once. The other
 * order left a workstream no row named, linked to its candidate only by a tag the seat is free to rewrite.
 */
import { isDeepStrictEqual } from "node:util";

import { err, ok, type Result } from "#lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import type { CandidateCatalog } from "./candidateCatalog.js";
import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import { readDefinitionRows, readReactionRows, readTitleRows } from "./candidateStore.js";
import { type ReactionVia, reactionRowSchema } from "./candidates.js";
import { latestDefinitions } from "./definitions.js";
import { appendLedgerRows } from "./ledgerAppend.js";
import { underLedgerLock } from "./ledgerLock.js";
import { applyMarks, type Placement } from "./placement.js";
import { firstRegister, planReactions, type ReactionPlan } from "./promotion.js";
import type { ReactionPick } from "./reactionBatch.js";
import { decodeWorkstreamMeta } from "./store/decode.js";
import { WorkstreamStoreErrors } from "./store/errors.js";
import { judgeProposedAggregate, type WorkstreamBatchRequest } from "./store/judge.js";
import type { WorkstreamStore } from "./store/port.js";
import type {
  StoredWorkstream,
  WorkstreamAggregate,
  WorkstreamRegisterMeta,
  WorkstreamRegisterSnapshot,
} from "./store/types.js";
import { latestTitles } from "./titles.js";

/**
 * The register as it stands, with the register document to plan against: its own, or — when the store holds none —
 * the one a first accepted candidate starts (`firstRegister`). Any store error refuses: a register that will not read
 * is never read as empty.
 *
 * @param catalog the candidates, whose provenance a first register document states
 * @returns the register and the document to plan against, or why it could not be had
 */
async function registerOrFirst({
  catalog,
  home,
  store,
}: {
  catalog: CandidateCatalog;
  home: string;
  store: WorkstreamStore;
}): Promise<Result<{ snapshot: WorkstreamRegisterSnapshot; meta: WorkstreamRegisterMeta }, CandidatesError>> {
  const read = await store.read({ home });
  if (read.isErr()) {
    return err(CandidatesErrors.registerRefused({ cause: read.error }));
  }
  const snapshot = read.value;
  if (snapshot.meta === null) {
    return ok({ meta: firstRegister({ catalog }), snapshot });
  }
  return ok({ meta: snapshot.meta.document, snapshot });
}

/**
 * What one `recordReactions` call wrote: the plan, less the workstreams, endings and channel names, which are on the
 * register.
 */
export type ReactionReceipt = Omit<ReactionPlan, "added" | "channels" | "endings" | "marks" | "updated">;

/** What the batch is handed, beside the home, store and minting seam every write threads. */
interface ReactionAsk {
  readonly nowIso: string;
  readonly picks: readonly ReactionPick[];
  readonly catalog: CandidateCatalog;
  readonly via: ReactionVia;
  readonly bySession: string;
  readonly anchor: string | null;
  readonly reason: string | null;
  readonly heard: string | null;
  readonly placement?: Placement;
}

/**
 * Record the owner's reactions, promoting every yes the register does not already hold and ending every workstream an
 * abandoned word names — one critical section.
 *
 * @param home the state home, the resolved one when absent
 * @param nowIso the instant the owner reacted, which is also the lock's clock
 * @param picks each candidate and the owner's word, already parsed against `catalog`
 * @param catalog the candidates the picks name, stated and mined alike
 * @param via where the reaction came from
 * @param bySession who recorded it
 * @param anchor where the owner said it, for a relayed word; `null` for a press
 * @param reason why it was abandoned, in the owner's words; `null` unless a pick is abandoned
 * @param heard the owner's words as heard, kept on every row so a later reading can name the ruling; `null` for a press
 * @param placement what a done, no, same-as, milestone-of or yes word carries beyond itself; none when absent
 * @param store the workstream register
 * @param mintId the fresh canonical UUID each new entry takes
 * @returns what was written, or why nothing was
 */
export async function recordReactions({
  home,
  store,
  mintId,
  ...asked
}: ReactionAsk & {
  home?: string;
  store: WorkstreamStore;
  mintId: () => string;
}): Promise<Result<ReactionReceipt, CandidatesError>> {
  return underLedgerLock({
    home,
    nowIso: asked.nowIso,
    run: ({ locked }) => recordUnderLock({ ...asked, home: locked, mintId, store }),
  });
}

/**
 * One workstream as a writer proposes it, its stored-only fields dropped, so an unchanged one compares equal and a
 * rewrite carries nothing the store derives.
 *
 * @returns the aggregate, every id on it kept
 */
export function aggregateOf({ stored }: { stored: StoredWorkstream }): WorkstreamAggregate {
  const { detail, entries, id, kind, links, milestones, name, outcome, status, workspace } = stored;
  return { detail, entries, id, kind, links, milestones, name, outcome, status, workspace };
}

/**
 * One workstream as the plan leaves it: carried over by an update, then marked, then ended.
 *
 * @param original the workstream as it stood, or as the plan created it
 * @returns the planned aggregate, or why its marks cannot be applied
 */
function plannedAggregate({
  mintId,
  original,
  plan,
}: {
  mintId: () => string;
  original: WorkstreamAggregate;
  plan: ReactionPlan;
}): Result<WorkstreamAggregate, CandidatesError> {
  let current = original;
  const carried = plan.updated.get(current.id);
  if (carried !== undefined) {
    current = carried;
  }
  const marked = plan.marks.get(current.id);
  if (marked !== undefined) {
    const applied = applyMarks({ aggregate: current, marks: marked, mintId });
    if (applied.isErr()) {
      return err(CandidatesErrors.registerRefused({ cause: applied.error }));
    }
    current = applied.value;
  }
  const ending = plan.endings.get(current.id);
  if (ending !== undefined && current.kind !== "local") {
    current = { ...current, detail: { ...current.detail, ending } };
  }
  return ok(current);
}

/**
 * The batch a planned plan leaves: its new workstreams created, each updated, marked and ended one written at the
 * revision it was read at, and — when it changes any workstream — the register document, its new channel names merged
 * under its own. A workstream the plan leaves exactly as it stood is not written, so a retry writes nothing new.
 *
 * @param plan the batch, planned
 * @param meta the register document planned against
 * @returns the batch to judge and send, or why a workstream cannot be grown
 */
function grownBatch({
  meta,
  mintId,
  plan,
  snapshot,
}: {
  meta: WorkstreamRegisterMeta;
  mintId: () => string;
  plan: ReactionPlan;
  snapshot: WorkstreamRegisterSnapshot;
}): Result<WorkstreamBatchRequest, CandidatesError> {
  const revisions = new Map(snapshot.workstreams.map((one) => [one.id, one.revision] as const));
  const writes: WorkstreamBatchRequest["writes"][number][] = [];
  const proposed = [...snapshot.workstreams.map((stored) => aggregateOf({ stored })), ...plan.added];
  for (const original of proposed) {
    const planned = plannedAggregate({ mintId, original, plan });
    if (planned.isErr()) {
      return err(planned.error);
    }
    const current = planned.value;
    const revision = revisions.get(current.id);
    const unchanged = revision !== undefined && isDeepStrictEqual(current, original);
    if (!unchanged) {
      // oxlint-disable-next-line prefer-nullish-coalescing -- no-silent-fallback bans `?? null`; a create states none
      writes.push({ aggregate: current, expectedRevision: revision === undefined ? null : revision });
    }
  }
  if (writes.length === 0) {
    return ok({ deletes: [], writes });
  }
  const grownMeta: WorkstreamRegisterMeta = { ...meta, channels: { ...plan.channels, ...meta.channels } };
  if (snapshot.meta === null) {
    return ok({ deletes: [], meta: { document: grownMeta, expectedRevision: null }, writes });
  }
  if (isDeepStrictEqual(grownMeta, snapshot.meta.document)) {
    return ok({ deletes: [], writes });
  }
  return ok({ deletes: [], meta: { document: grownMeta, expectedRevision: snapshot.meta.revision }, writes });
}

/**
 * Every problem the store would refuse the batch for, judged before any row is appended, so a register that would
 * refuse a workstream records nothing.
 *
 * @returns nothing, or the refusal
 */
function judgedBatch({ batch }: { batch: WorkstreamBatchRequest }): Result<null, CandidatesError> {
  const problems = batch.writes.flatMap(({ aggregate }) => {
    const judged = judgeProposedAggregate({ aggregate });
    return judged.isErr() ? judged.error : [];
  });
  if (batch.meta !== undefined && batch.meta.document !== null) {
    const decoded = decodeWorkstreamMeta({ value: batch.meta.document });
    problems.push(...(decoded.isErr() ? decoded.error : []));
  }
  if (problems.length > 0) {
    return err(CandidatesErrors.registerRefused({ cause: WorkstreamStoreErrors.invalid({ problems }) }));
  }
  return ok(null);
}

/**
 * Plan the batch against every ledger it reads — the reactions so far, the definitions a yes carries and the titles a
 * new workstream takes — as they stand under the lock.
 *
 * @param asked the batch as {@link recordUnderLock} was handed it
 * @returns the plan, or why a ledger would not read or the batch is refused
 */
function planAgainstLedgers({
  asked,
  home,
  meta,
  mintId,
  workstreams,
}: {
  asked: ReactionAsk;
  home: string;
  meta: WorkstreamRegisterMeta;
  mintId: () => string;
  workstreams: readonly WorkstreamAggregate[];
}): Result<ReactionPlan, CandidatesError> {
  const ledgers = readReactionRows({ home }).andThen((held) =>
    readDefinitionRows({ home }).andThen((definitions) =>
      readTitleRows({ home }).map((titles) => ({ definitions, held, titles })),
    ),
  );
  if (ledgers.isErr()) {
    return err(ledgers.error);
  }
  return planReactions({
    ...asked,
    definitions: latestDefinitions({ rows: ledgers.value.definitions }),
    held: ledgers.value.held,
    meta,
    mintId,
    titles: latestTitles({ rows: ledgers.value.titles }),
    workstreams,
  });
}

/**
 * The critical section {@link recordReactions} runs once it holds the lock. Call it only from inside
 * `underLedgerLock` (`./ledgerLock.ts`).
 *
 * @param home the locked state home, the one `underLedgerLock` hands its run
 * @param store the workstream register
 * @param mintId the fresh canonical UUID each new entry takes
 * @returns what was written, or why nothing was
 */
export async function recordUnderLock({
  home,
  mintId,
  store,
  ...asked
}: ReactionAsk & {
  home: string;
  mintId: () => string;
  store: WorkstreamStore;
}): Promise<Result<ReactionReceipt, CandidatesError>> {
  const register = await registerOrFirst({ catalog: asked.catalog, home, store });
  if (register.isErr()) {
    return err(register.error);
  }
  const { meta, snapshot } = register.value;
  const plan = planAgainstLedgers({ asked, home, meta, mintId, workstreams: snapshot.workstreams });
  if (plan.isErr()) {
    return err(plan.error);
  }
  const { alreadyHeld, ended, placed, promoted, rows } = plan.value;
  // Judged before anything is written, so a register that would refuse a workstream records nothing. A batch that
  // changes no workstream writes nothing to the register — on a fresh install, a `no` must not start an empty one.
  const batch = grownBatch({ meta, mintId, plan: plan.value, snapshot }).andThen((grown) =>
    judgedBatch({ batch: grown }).map(() => grown),
  );
  if (batch.isErr()) {
    return err(batch.error);
  }
  // Durable, because the register write below depends on it; the append makes the directory when none exists yet.
  const appended = appendLedgerRows({
    path: stateHomePaths({ home }).workstreamsReactionsJsonl,
    refusal: CandidatesErrors.reactionRefused,
    rows,
    schema: reactionRowSchema,
  });
  if (appended.isErr()) {
    return err(appended.error);
  }
  if (batch.value.writes.length > 0) {
    const written = await store.applyBatch({ ...batch.value, home });
    if (written.isErr()) {
      const owed = new Set([...promoted, ...ended, ...placed].map((one) => one.candidate));
      return err(CandidatesErrors.promotionOwed({ candidates: [...owed], cause: written.error }));
    }
  }
  return ok({ alreadyHeld, ended, placed, promoted, rows });
}
