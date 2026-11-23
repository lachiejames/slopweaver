/**
 * What one corpus sync propagated, and the ONE open judgement pass every sync joins.
 *
 * Two records, and why each is the shape it is:
 *
 * - **One immutable record per successful sync** ({@link PropagationRecord}), named by a digest of the recipe id
 *   and the sync's own finish instant. Keyed by the recipe id alone, the next sync of that source would
 *   overwrite evidence a still-open pass has not read yet.
 * - **One active batch** ({@link PropagationBatch}): the pass that is open, the syncs it covers, and how far it
 *   has confirmed. Seven corpus resyncs finishing in one seat must seat ONE session, not seven — so only the
 *   transition from no batch to a batch owns a seat, and every later sync appends to it.
 *
 * ## `revision` is what makes `done` safe
 *
 * Each covered sync gets the next revision. A pass confirms THROUGH the revision it actually read
 * ({@link completeThrough}); a sync that joined while it was working carries a higher one, so it stays pending
 * rather than being acknowledged by a snapshot that never saw it. The batch retires only when nothing is pending.
 *
 * Pure: shapes, parsers and transitions. No I/O, no clock.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { type CorpusSource } from "../../corpus/types.js";
import { ALL_CORPUS_SOURCES } from "../../integrations/corpusSources.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type PropagationSurface, SURFACES } from "./propagation.js";
import { type PropagationError, PropagationErrors } from "./propagationErrors.js";

/**
 * Whether the seated pass's workspace is still there, as cmux's own inventory answers it.
 *
 * A pass whose session was closed leaves its batch open, and every later sync would join a pass nobody is working
 * — the silent stop this lane exists to end — so `gone` reseats it. Age never does: a clock that reseats a
 * slow pass puts two visible sessions on one batch. `unknown` — cmux did not answer —
 * reseats nothing, because a false `gone` is the duplicate and a false `open` costs one more sync's wait.
 */
export type PassSession = "open" | "gone" | "unknown";

const isoInstant = z.iso.datetime({ offset: true });
const corpusSource = z.enum(ALL_CORPUS_SOURCES);
const surface = z.enum(SURFACES);

const surfaceOutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      observedAtIso: isoInstant,
      producer: z.string().min(1),
      readingId: z.string().min(1),
      status: z.literal("re-derived"),
      surface,
    })
    .strict(),
  z.object({ detail: z.string().min(1), status: z.literal("failed"), surface }).strict(),
  z.object({ detail: z.string().min(1), status: z.literal("live"), surface }).strict(),
  z.object({ detail: z.string().min(1), status: z.literal("judgement"), surface }).strict(),
]);

/** What happened to one surface after one sync. */
export type SurfaceOutcome =
  | {
      readonly surface: PropagationSurface;
      readonly status: "re-derived";
      readonly producer: string;
      readonly readingId: string;
      readonly observedAtIso: string;
    }
  | { readonly surface: PropagationSurface; readonly status: "failed" | "live" | "judgement"; readonly detail: string };

const recordSchema = z
  .object({
    propagatedAtIso: isoInstant,
    propagationId: z.string().min(1),
    recipeId: z.string().min(1),
    schemaVersion: z.literal(1),
    source: corpusSource,
    surfaces: z.array(surfaceOutcomeSchema),
    syncFinishedAtIso: isoInstant,
  })
  .strict();

/** One successful sync's propagation, written once. */
export interface PropagationRecord {
  readonly schemaVersion: 1;
  readonly propagationId: string;
  readonly recipeId: string;
  readonly source: CorpusSource;
  readonly syncFinishedAtIso: string;
  readonly propagatedAtIso: string;
  readonly surfaces: readonly SurfaceOutcome[];
}

const coveredSchema = z
  .object({
    propagationId: z.string().min(1),
    recipeId: z.string().min(1),
    revision: z.number().int().positive(),
    source: corpusSource,
    syncFinishedAtIso: isoInstant,
  })
  .strict();

/** One sync a batch covers. */
export type CoveredSync = z.output<typeof coveredSchema>;

const seatSchema = z
  .object({
    lastProblem: z.string().nullable(),
    registeredAtIso: isoInstant.nullable(),
    seatedAtIso: isoInstant.nullable(),
    slug: z.string().min(1),
  })
  .strict();

const batchSchema = z
  .object({
    batchId: z.string().min(1),
    covered: z.array(coveredSchema),
    doneThrough: z.number().int().nonnegative(),
    openedAtIso: isoInstant,
    revision: z.number().int().nonnegative(),
    schemaVersion: z.literal(1),
    seat: seatSchema,
  })
  .strict();

/** The one open judgement pass. */
export type PropagationBatch = z.output<typeof batchSchema>;

/**
 * Validate one propagation record read off disk.
 *
 * @param value the parsed JSON
 * @returns the record, or every reason it is not one
 */
export function parsePropagationRecord({ value }: { readonly value: unknown }): Result<PropagationRecord> {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(parsed.data);
}

/**
 * Validate the active batch read off disk.
 *
 * @param value the parsed JSON
 * @returns the batch, or every reason it is not one
 */
export function parsePropagationBatch({ value }: { readonly value: unknown }): Result<PropagationBatch> {
  const parsed = batchSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(parsed.data);
}

/**
 * The stable id of one sync's propagation — the same sync always names the same record.
 *
 * @param recipeId the resync row that synced
 * @param syncFinishedAtIso the instant its attempt finished
 * @returns sixteen hex characters
 */
export function propagationIdOf({
  recipeId,
  syncFinishedAtIso,
}: {
  readonly recipeId: string;
  readonly syncFinishedAtIso: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([recipeId, syncFinishedAtIso]))
    .digest("hex")
    .slice(0, 16);
}

/**
 * The board slug a pass is seated on.
 *
 * @param nowIso the instant the seat is minted, whose UTC day names it
 * @param batchId the batch, whose first eight characters keep two passes on one day apart
 * @returns the slug
 */
export function passSlugOf({ nowIso, batchId }: { readonly nowIso: string; readonly batchId: string }): string {
  return `corpus-propagation-pass-${nowIso.slice(0, 10)}-${batchId.slice(0, 8).toLowerCase()}`;
}

/** A freshly opened batch covering nothing yet, its seat not yet registered. */
function emptyBatch({ batchId, nowIso }: { readonly batchId: string; readonly nowIso: string }): PropagationBatch {
  return {
    batchId,
    covered: [],
    doneThrough: 0,
    openedAtIso: nowIso,
    revision: 0,
    schemaVersion: 1,
    seat: { lastProblem: null, registeredAtIso: null, seatedAtIso: null, slug: passSlugOf({ batchId, nowIso }) },
  };
}

/** The batch with one more sync covered, at the next revision. */
function withSync({
  batch,
  record,
}: {
  readonly batch: PropagationBatch;
  readonly record: PropagationRecord;
}): PropagationBatch {
  const revision = batch.revision + 1;
  const covered: CoveredSync = {
    propagationId: record.propagationId,
    recipeId: record.recipeId,
    revision,
    source: record.source,
    syncFinishedAtIso: record.syncFinishedAtIso,
  };
  return { ...batch, covered: [...batch.covered, covered], revision };
}

/** What joining a sync to the batch produced. */
export interface JoinedBatch {
  readonly batch: PropagationBatch;
  /** Whether this call opened the batch, as opposed to joining one already open. */
  readonly opened: boolean;
  /** Whether the sync was already covered — a repeated call, which changes nothing. */
  readonly repeat: boolean;
}

/**
 * Join one sync to the open batch, or open one for it.
 *
 * @param active the batch on disk, or null when no pass is open
 * @param record the sync's propagation record
 * @param batchId the id a NEW batch takes; ignored when one is open
 * @param nowIso the instant of the join
 * @returns the batch to write, and whether it was opened or the sync was already in it
 */
export function joinBatch({
  active,
  record,
  batchId,
  nowIso,
}: {
  readonly active: PropagationBatch | null;
  readonly record: PropagationRecord;
  readonly batchId: string;
  readonly nowIso: string;
}): JoinedBatch {
  if (active === null) {
    return { batch: withSync({ batch: emptyBatch({ batchId, nowIso }), record }), opened: true, repeat: false };
  }
  if (active.covered.some((covered) => covered.propagationId === record.propagationId)) {
    return { batch: active, opened: false, repeat: true };
  }
  return { batch: withSync({ batch: active, record }), opened: false, repeat: false };
}

/**
 * The syncs a pass has not confirmed yet.
 *
 * @param batch the open batch
 * @returns every covered sync above `doneThrough`, in revision order
 */
export function pendingSyncs({ batch }: { readonly batch: PropagationBatch }): readonly CoveredSync[] {
  return batch.covered.filter((covered) => covered.revision > batch.doneThrough);
}

/** Whether a batch needs its session opened, and why. */
export type SeatNeed =
  { readonly kind: "seated" } | { readonly kind: "unseated" } | { readonly kind: "lapsed"; readonly slug: string };

/**
 * Whether the batch's visible session still has to be opened.
 *
 * A batch never seated needs a seat. One seated whose workspace cmux no longer lists, with syncs still pending,
 * is LAPSED and needs a fresh seat on a fresh slug, because the old board row is still standing and registering
 * the same slug twice would be refused. See {@link PassSession} for why nothing else lapses one.
 *
 * @param batch the open batch
 * @param session what cmux says of the seated pass's workspace
 * @param batchId the id a lapsed batch's new slug is minted from
 * @param nowIso the instant of the check, for that slug's day
 * @returns the need
 */
export function seatNeed({
  batch,
  session,
  batchId,
  nowIso,
}: {
  readonly batch: PropagationBatch;
  readonly session: PassSession;
  readonly batchId: string;
  readonly nowIso: string;
}): SeatNeed {
  if (batch.seat.seatedAtIso === null) {
    return { kind: "unseated" };
  }
  if (session === "gone" && pendingSyncs({ batch }).length > 0) {
    return { kind: "lapsed", slug: passSlugOf({ batchId, nowIso }) };
  }
  return { kind: "seated" };
}

/**
 * The batch with a fresh, unseated slug — what a lapsed pass is replaced by.
 *
 * @param batch the open batch whose seat lapsed
 * @param slug the new slug
 * @returns the batch, its seat reset
 */
export function reseatBatch({
  batch,
  slug,
}: {
  readonly batch: PropagationBatch;
  readonly slug: string;
}): PropagationBatch {
  return { ...batch, seat: { lastProblem: null, registeredAtIso: null, seatedAtIso: null, slug } };
}

/** What confirming a pass through one revision produced. */
export interface CompletedThrough {
  readonly batch: PropagationBatch;
  /** The syncs still pending after the confirmation — joined while the pass worked. */
  readonly remaining: readonly CoveredSync[];
}

/**
 * Confirm the pass through the revision it read, in the batch it read.
 *
 * A revision is only meaningful inside one batch: a retired batch's successor counts from 1 again, so a stale
 * confirmation naming revision 1 would otherwise retire a sync it never read.
 *
 * @param batch the open batch
 * @param batchId the batch `automation propagate --status` printed when the pass read it
 * @param through the highest revision the pass read with `automation propagate --status`
 * @returns the batch and what is still pending, or why it cannot be confirmed
 */
export function completeThrough({
  batch,
  batchId,
  through,
}: {
  readonly batch: PropagationBatch;
  readonly batchId: string;
  readonly through: number;
}): Result<CompletedThrough, PropagationError> {
  if (batchId !== batch.batchId) {
    return err(PropagationErrors.batchMismatch({ expected: batch.batchId, got: batchId }));
  }
  if (!Number.isInteger(through) || through < 1) {
    return err(PropagationErrors.revisionNotPositive({ through }));
  }
  if (through > batch.revision) {
    return err(PropagationErrors.revisionAhead({ revision: batch.revision, through }));
  }
  const next: PropagationBatch = { ...batch, doneThrough: Math.max(batch.doneThrough, through) };
  return ok({ batch: next, remaining: pendingSyncs({ batch: next }) });
}
