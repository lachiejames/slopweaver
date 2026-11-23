/**
 * The WAKE JOURNAL — what every `handover wake` reseat acted on, in one append-only file each wake on the machine
 * reads, so the tick's own wake and any later one share a single memory. Pure: rows, their decoding, and the two
 * questions asked of them. The file itself is `./wakeJournalStore.ts`.
 *
 * MEASURED on one run journal: the tick's wake reseated
 * a park on a checks wake; the seat found its CI already green, enqueued, and parked again
 * on that same wake; the chair's wake judged the re-park due on the same green head and booted a second seat
 * for nothing. A checks wake is due whenever the checks are terminal, so without a record of what a reseat
 * acted on, every re-park on a verdict the seat already has is due at once.
 *
 * Its own file rather than a run-journal kind: every checkout reads the one shared home, and an older build reads an
 * unknown run-journal kind as an unreadable line — which stops `handover wake` judging that run at all
 * (`../../.claude/rules/area-handover.md`).
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { isRepoSlug, isUtcInstant, sameWakeObservation, type WakeObservation } from "./parkWake.js";

/** A reseat about to be attempted: the park it acts on and what the wake saw. Written BEFORE `cmux spawn` runs. */
export interface WakeAttemptRow {
  readonly kind: "attempt";
  readonly atIso: string;
  /** This attempt's id — what its settlement and a `handover wake --retry` name. */
  readonly nonce: string;
  readonly slug: string;
  /** The park's position in its run journal. */
  readonly parkIndex: number;
  /** The park's own instant, so a journal recreated under the same slug is never mistaken for this one. */
  readonly parkedAtIso: string;
  readonly observed: WakeObservation;
}

/** How one attempt ended. A `spawn-deferred` carries the instant the spawn backoff opens again, when it was read. */
export interface WakeSettledRow {
  readonly kind: "settled";
  readonly atIso: string;
  readonly nonce: string;
  readonly action: "spawned" | "spawn-failed" | "spawn-deferred";
  readonly retryAfterIso?: string;
}

/** One line of the wake journal. */
export type WakeJournalRow = WakeAttemptRow | WakeSettledRow;

/** An attempt with the settlement that ended it, when one was written. */
export interface WakeAttemptState {
  readonly attempt: WakeAttemptRow;
  readonly settlement: WakeSettledRow | undefined;
}

const UTC_INSTANT = z.string().refine((text) => isUtcInstant({ text }), { message: "not a UTC instant" });
const REPO = z.string().refine((text) => isRepoSlug({ text }), { message: "not owner/name" });
const PR_NUMBER = z.number().int().positive();

const OBSERVATION_SCHEMA = z.union([
  z.object({ atIso: UTC_INSTANT, kind: z.literal("at") }).strict(),
  z
    .object({ kind: z.literal("checks"), number: PR_NUMBER, prState: z.enum(["CLOSED", "MERGED"]), repo: REPO })
    .strict(),
  z
    .object({
      fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
      headSha: z.string().min(1),
      kind: z.literal("checks"),
      number: PR_NUMBER,
      prState: z.literal("OPEN"),
      repo: REPO,
    })
    .strict(),
]);

const ROW_SCHEMA = z.discriminatedUnion("kind", [
  z
    .object({
      atIso: UTC_INSTANT,
      kind: z.literal("attempt"),
      nonce: z.string().min(1),
      observed: OBSERVATION_SCHEMA,
      parkIndex: z.number().int().nonnegative(),
      parkedAtIso: z.string().min(1),
      slug: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.enum(["spawned", "spawn-failed", "spawn-deferred"]),
      atIso: UTC_INSTANT,
      kind: z.literal("settled"),
      nonce: z.string().min(1),
      retryAfterIso: UTC_INSTANT.optional(),
    })
    .strict(),
]);

/**
 * Decode one parsed line. Anything that is not exactly a row is refused, never coerced: a wake that misread its own
 * journal would either reseat twice or never.
 *
 * @param value the line, already parsed as JSON
 * @returns the row, or what was wrong with it
 */
export function decodeWakeJournalRow({ value }: { value: unknown }): Result<WakeJournalRow> {
  const parsed = ROW_SCHEMA.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const row = parsed.data;
  if (row.kind === "attempt") {
    return ok(row);
  }
  const { action, atIso, kind, nonce, retryAfterIso } = row;
  return ok(
    retryAfterIso === undefined ? { action, atIso, kind, nonce } : { action, atIso, kind, nonce, retryAfterIso },
  );
}

/**
 * Pair every attempt with the FIRST settlement that follows it, in journal order. A settlement naming no earlier
 * attempt is ignored: it says nothing about any park, and one written before its attempt cannot be that attempt's
 * outcome.
 *
 * @param rows the journal, in order
 * @returns one entry per attempt
 */
export function foldWakeJournal({ rows }: { rows: readonly WakeJournalRow[] }): readonly WakeAttemptState[] {
  const states: { attempt: WakeAttemptRow; settlement: WakeSettledRow | undefined }[] = [];
  const unsettled = new Map<string, number[]>();
  for (const row of rows) {
    const waiting = unsettled.get(row.nonce);
    if (row.kind === "attempt") {
      unsettled.set(row.nonce, waiting === undefined ? [states.length] : [...waiting, states.length]);
      states.push({ attempt: row, settlement: undefined });
      continue;
    }
    if (waiting === undefined) {
      continue;
    }
    for (const index of waiting) {
      states[index]!.settlement = row;
    }
    unsettled.delete(row.nonce);
  }
  return states;
}

/**
 * The key {@link reparkedOnActedCondition} matches a reseated park by: its position AND its instant.
 *
 * @returns `<parkIndex>@<parkedAtIso>`
 */
export function parkKey({ parkIndex, parkedAtIso }: { parkIndex: number; parkedAtIso: string }): string {
  return `${String(parkIndex)}@${parkedAtIso}`;
}

/**
 * The reseat a park re-parked on: the latest wake attempt on the ONE park the current seat came up from, when what
 * it observed is the condition the current park would wake on now. A park on a new head, a re-run, a merge, a close,
 * a different pull request or a new instant is a new condition and is never matched. Neither is a park whose seat
 * came up some other way (the owner's answer, a hand spawn), nor a legacy row with no attempt, so each wakes once and gains
 * one.
 *
 * Which park the seat came up from is the RUN journal's word (`actedPark`, `./wakeProofs.ts`
 * `lastReseatedParkBefore`), never the settlement's: a spawn that exited non-zero with its seat left open still
 * reseated, and a wake killed between the dispatch and its settlement wrote none. That reading is bounded to the
 * run's current cycle, so an earlier run under the same slug can never hold a park of this one.
 *
 * @param attempts the folded wake journal
 * @param observed what the current park's wake would act on now
 * @param actedPark the {@link parkKey} of the last park before the current one, this cycle, that a seat came up from
 * @returns the matching attempt, or `undefined` when the current park is on a new condition
 */
export function reparkedOnActedCondition({
  actedPark,
  attempts,
  observed,
  slug,
}: {
  actedPark: string | undefined;
  attempts: readonly WakeAttemptState[];
  slug: string;
  observed: WakeObservation;
}): WakeAttemptRow | undefined {
  if (actedPark === undefined) {
    return undefined;
  }
  const latest = attempts
    .map((state) => state.attempt)
    .findLast((attempt) => attempt.slug === slug && parkKey(attempt) === actedPark);
  if (latest === undefined || !sameWakeObservation({ left: latest.observed, right: observed })) {
    return undefined;
  }
  return latest;
}

/** No attempt in the wake journal carries the nonce — a caller's mistake, not a state. */
interface RetryNonceUnknownError {
  readonly code: "RETRY_NONCE_UNKNOWN";
  readonly message: string;
  readonly nonce: string;
}

/** The attempt exists and did not end in a backoff deferral, so there is nothing to retry. */
interface RetryNotDeferredError {
  readonly code: "RETRY_NOT_DEFERRED";
  readonly message: string;
  readonly nonce: string;
}

/** The attempt was deferred, but its settlement read no retry instant, so the next tick takes the park. */
interface RetryNoInstantError {
  readonly code: "RETRY_NO_INSTANT";
  readonly message: string;
  readonly nonce: string;
}

/**
 * The attempt has no settlement: its spawn may still be running, or its outcome was never journalled, so the
 * park may still be owed and the next tick judges it.
 */
interface RetryUnsettledError {
  readonly code: "RETRY_UNSETTLED";
  readonly message: string;
  readonly nonce: string;
}

/** Two attempts carry the nonce — a hand-edited journal, never a minted one — so which park it names is unknown. */
interface RetryNonceAmbiguousError {
  readonly code: "RETRY_NONCE_AMBIGUOUS";
  readonly message: string;
  readonly nonce: string;
}

/** Why a `handover wake --retry <nonce>` has no deferred attempt to wait on. */
export type WakeRetryError =
  RetryNonceUnknownError | RetryNonceAmbiguousError | RetryNotDeferredError | RetryNoInstantError | RetryUnsettledError;

/** The one place each {@link WakeRetryError} is built. */
export const WakeRetryErrors = {
  noInstant: ({ attempt }: { attempt: WakeAttemptRow }): RetryNoInstantError => ({
    code: "RETRY_NO_INSTANT",
    message: `wake attempt ${attempt.nonce} (${attempt.slug}) was deferred with no retry instant read, so the next tick takes it`,
    nonce: attempt.nonce,
  }),
  nonceAmbiguous: ({ count, nonce }: { count: number; nonce: string }): RetryNonceAmbiguousError => ({
    code: "RETRY_NONCE_AMBIGUOUS",
    message: `${String(count)} wake attempts carry the nonce ${nonce}, so which park it names is unknown — repair the wake journal`,
    nonce,
  }),
  nonceUnknown: ({ nonce }: { nonce: string }): RetryNonceUnknownError => ({
    code: "RETRY_NONCE_UNKNOWN",
    message: `no wake attempt carries the nonce ${nonce}`,
    nonce,
  }),
  notDeferred: ({
    attempt,
    settlement,
  }: {
    attempt: WakeAttemptRow;
    settlement: WakeSettledRow;
  }): RetryNotDeferredError => ({
    code: "RETRY_NOT_DEFERRED",
    message: `wake attempt ${attempt.nonce} (${attempt.slug}) ended ${settlement.action}, so it is not a deferred reseat to retry`,
    nonce: attempt.nonce,
  }),
  unsettled: ({ attempt }: { attempt: WakeAttemptRow }): RetryUnsettledError => ({
    code: "RETRY_UNSETTLED",
    message: `wake attempt ${attempt.nonce} (${attempt.slug}) has no settlement, so its spawn is still running or its outcome was never journalled; the next tick judges the park`,
    nonce: attempt.nonce,
  }),
} as const;

/**
 * The deferred attempt a `handover wake --retry <nonce>` names, refused unless the backoff deferred it and its
 * settlement recorded when the backoff opens.
 *
 * @param attempts the folded wake journal
 * @param nonce the attempt `handover wake` printed beside its deferral
 * @returns the attempt and its retry instant, or why it is not one to retry
 */
export function deferredAttemptForRetry({
  attempts,
  nonce,
}: {
  attempts: readonly WakeAttemptState[];
  nonce: string;
}): Result<{ readonly attempt: WakeAttemptRow; readonly retryAfterIso: string }, WakeRetryError> {
  const matching = attempts.filter((candidate) => candidate.attempt.nonce === nonce);
  const state = matching[0];
  if (state === undefined) {
    return err(WakeRetryErrors.nonceUnknown({ nonce }));
  }
  if (matching.length > 1) {
    return err(WakeRetryErrors.nonceAmbiguous({ count: matching.length, nonce }));
  }
  const { attempt, settlement } = state;
  if (settlement === undefined) {
    return err(WakeRetryErrors.unsettled({ attempt }));
  }
  if (settlement.action !== "spawn-deferred") {
    return err(WakeRetryErrors.notDeferred({ attempt, settlement }));
  }
  if (settlement.retryAfterIso === undefined) {
    return err(WakeRetryErrors.noInstant({ attempt }));
  }
  return ok({ attempt, retryAfterIso: settlement.retryAfterIso });
}
