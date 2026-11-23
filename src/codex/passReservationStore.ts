/**
 * Route one Codex pass and, on a usage-limited account, reserve its share of the week in the same locked
 * transaction — the effectful half of `./passReservation.ts`, and the only writer of the reservation document
 * (`./passReservationDocument.ts`).
 *
 * ## The transaction
 *
 * ```text
 * fleet read → no row carries a sub-100 limit → ordinary route: no lock, no document read, nothing written
 *            → a limit exists → lock (waiting) → fresh fleet read → read document → decide → publish → unlock
 * ```
 *
 * The fleet is read again UNDER the lock, because a sibling may have finished and released while this pass waited,
 * and only a reading taken after that release can carry what the sibling spent. The lock is the operation lock
 * under one key, taken with {@link CODEX_PASS_RESERVATION_LOCK_WAIT_SECONDS} of waiting: a review's properties all
 * reach it together, and refusing a sibling at the first contention would be a refusal nothing earned. Releasing is
 * the same locked read, remove, publish; a release that fails leaves the row to expire, never deleted unlocked.
 *
 * ## Fail closed, without failing the unlimited fleet
 *
 * A document that will not read or parse, a publish that fails, and a lock that does not come all leave the pass with
 * no reservation it can count on, so every usage-limited account is held out of it while a genuinely unlimited one
 * may still take it. A lock that did not come is followed by a FRESH fleet read, taken outside the transaction, for
 * that unlimited-only decision. A limited account is never routed without a published reservation.
 *
 * The fleet read files the ordinary, reservation-unaware fleet-cap record exactly as every other read does; the
 * pass-only gate is not cap evidence and changes no other reader.
 */
import type { OperationLockResult } from "../admit/operationLock.js";
import { acquireOperationLockWaiting } from "../admit/operationLockWait.js";
import { err, ok, type Result } from "../lib/result.js";
import type { PlanRegisterError } from "../plans/errors.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { stateHomePaths } from "../stateHome.js";
import type { WaitClock } from "../wait/loop.js";
import type { ReadCodexAccountsLive } from "./accountLive.js";
import type { CodexDestination } from "./destinations.js";
import type { CodexFleetCapPort } from "./fleetCapPort.js";
import { readCodexFleetSnapshot } from "./fleetRead.js";
import type { CodexFleetSnapshot } from "./fleetTypes.js";
import {
  type CodexPassReservation,
  type CodexPassReservationDecision,
  type CodexPassReservationStore,
  codexFleetHasUsageLimit,
  decideCodexPassReservation,
  EMPTY_CODEX_PASS_RESERVATIONS,
  releaseCodexPassReservation,
} from "./passReservation.js";
import { readCodexPassReservations, writeCodexPassReservations } from "./passReservationDocument.js";
import { type CodexPassReservationError, CodexPassReservationErrors } from "./passReservationErrors.js";
import type { CodexSignInPort } from "./signInPort.js";
import type { PassBound } from "./types.js";

/** The operation-lock key every reservation and release takes. */
export const CODEX_PASS_RESERVATION_LOCK_KEY = "codex-pass-reservations";

/** How long one pass waits for the lock before it is held to unlimited accounts. See the header's § The transaction. */
export const CODEX_PASS_RESERVATION_LOCK_WAIT_SECONDS = 60;

/** One fleet read at one instant — `readCodexFleetSnapshot` over its ports in production, a fake in a test. */
export type CodexPassFleetRead = (request: {
  readonly home: string;
  readonly nowIso: string;
}) => Promise<Result<CodexFleetSnapshot, PlanRegisterError>>;

/** Where one pass goes: a destination with the release its reservation needs, or why nowhere. */
export type CodexPassRoute =
  | {
      readonly kind: "routed";
      readonly destination: CodexDestination;
      readonly why: string;
      /** The row this pass holds, or undefined on an account with no usage limit, whose release does nothing. */
      readonly reservation: CodexPassReservation | undefined;
      readonly release: () => Promise<Result<void, CodexPassReservationError>>;
    }
  | { readonly kind: "refused"; readonly why: string };

/** Routes one pass, reserving where its account is limited. */
export interface CodexPassReservationPort {
  readonly acquire: (request: {
    readonly bound: PassBound;
    readonly home: string;
  }) => Promise<Result<CodexPassRoute, CodexPassReservationError>>;
}

/** Everything the file-backed port reads the world through. */
export interface CodexPassReservationSeams {
  readonly readFleet: CodexPassFleetRead;
  /** Read afresh for every fleet read, lock attempt and release, so a wait never dates a decision. */
  readonly nowIso: () => string;
  readonly newId: () => string;
  /** The reserving process, kept on each row as diagnostic evidence only. */
  readonly pid: number;
  readonly waitClock: WaitClock;
  readonly lockWaitSeconds: number;
  /** Where a changed lock-waiting line goes — stderr in production. */
  readonly emit: (line: string) => void;
}

/**
 * The production fleet read for a pass: the same snapshot every Codex reader takes, over the given ports.
 *
 * @param fleetCap where the read files the ordinary fleet-cap record
 * @param port where the plan register is read
 * @param readLive the live account reader
 * @param signInPort where each store's sign-in observation is filed
 * @returns the read
 */
export function codexPassFleetRead({
  fleetCap,
  port,
  readLive,
  signInPort,
}: {
  fleetCap: CodexFleetCapPort;
  port: PlanRegisterPort;
  readLive: ReadCodexAccountsLive;
  signInPort: CodexSignInPort;
}): CodexPassFleetRead {
  return ({ home, nowIso }) => readCodexFleetSnapshot({ fleetCap, home, nowIso, port, readLive, signInPort });
}

/**
 * The pure decision over one snapshot. Readings are ranked at the snapshot's own instant, exactly as routing with no
 * reservation ranks them; a new row is dated by a clock read taken NOW — after the awaited fleet read, so nothing
 * awaited sits between it and the synchronous publish. Dated at the snapshot's instant instead, a read that stalled
 * past a pass's bound would publish a reservation already expired, which the next pass ignores (found by a Codex
 * review); ranked at the later one, a window resetting mid-read would route differently than before (also Codex).
 */
function decide({
  bound,
  seams,
  snapshot,
  store,
}: {
  bound: PassBound;
  seams: CodexPassReservationSeams;
  snapshot: CodexFleetSnapshot;
  store: CodexPassReservationStore;
}): CodexPassReservationDecision {
  return decideCodexPassReservation({
    bound,
    nowIso: snapshot.readAtIso,
    observations: snapshot.observations,
    pid: seams.pid,
    reservationId: seams.newId(),
    reservedAtIso: seams.nowIso(),
    store,
    thresholds: snapshot.thresholds,
  });
}

/** Read the fleet now, typing a register fault as this domain's own. */
async function readFleetNow({
  home,
  seams,
}: {
  home: string;
  seams: CodexPassReservationSeams;
}): Promise<Result<CodexFleetSnapshot, CodexPassReservationError>> {
  const read = await seams.readFleet({ home, nowIso: seams.nowIso() });
  if (read.isErr()) {
    return err(CodexPassReservationErrors.fleetReadFailed({ reason: read.error.message }));
  }
  return ok(read.value);
}

/** Why a write was withheld: a later holder took this one's aged-out lease over. */
const LEASE_TAKEN_OVER = "this pass's reservation lock was taken over after its lease aged out";

/**
 * Take the reservation lock, waiting up to the seams' bound. The lock's filesystem staging THROWS on a fault (a full
 * disk, a file where its directory belongs), so a throw is returned as an unheld lock: escaping, it would skip the
 * branch that still routes an unlimited account (found by a Codex review).
 */
async function takeLock({
  home,
  seams,
}: {
  home: string;
  seams: CodexPassReservationSeams;
}): Promise<OperationLockResult> {
  try {
    return await acquireOperationLockWaiting({
      clock: seams.waitClock,
      emit: seams.emit,
      home,
      key: CODEX_PASS_RESERVATION_LOCK_KEY,
      nowIso: seams.nowIso,
      timeoutSeconds: seams.lockWaitSeconds,
    });
  } catch (cause) {
    // Forwarded as the fault's own words: every caller wraps it in `lockUnavailable`, which names the lock.
    const fault = cause instanceof Error ? cause.message : String(cause);
    return err(fault);
  }
}

/**
 * Remove one reservation under the lock. A failure at any step leaves the row standing until it expires.
 *
 * @param reservationId the finishing pass's row
 * @returns nothing, or why the row still stands
 */
async function releasePass({
  home,
  reservationId,
  seams,
}: {
  home: string;
  reservationId: string;
  seams: CodexPassReservationSeams;
}): Promise<Result<void, CodexPassReservationError>> {
  const lock = await takeLock({ home, seams });
  if (lock.isErr()) {
    return err(CodexPassReservationErrors.lockUnavailable({ reason: lock.error }));
  }
  try {
    const path = stateHomePaths({ home }).live.codexPassReservationsJson;
    const read = readCodexPassReservations({ path });
    if (read.isErr()) {
      return err(read.error);
    }
    const document = releaseCodexPassReservation({ document: read.value, nowIso: seams.nowIso(), reservationId });
    // The fence: a takeover is unfenced, so a holder that outlived its lease must not write over a newer document.
    if (!lock.value.stillHeld()) {
      return err(CodexPassReservationErrors.lockUnavailable({ reason: LEASE_TAKEN_OVER }));
    }
    return writeCodexPassReservations({ document, path });
  } finally {
    lock.value.release();
  }
}

/** The route a decision amounts to, with the release its reservation needs. */
function routeOf({
  decision,
  home,
  seams,
}: {
  decision: CodexPassReservationDecision;
  home: string;
  seams: CodexPassReservationSeams;
}): CodexPassRoute {
  if (decision.kind === "refused") {
    return { kind: "refused", why: decision.why };
  }
  if (decision.kind === "unlimited") {
    const release = (): Promise<Result<void, CodexPassReservationError>> => Promise.resolve(ok(undefined));
    return { destination: decision.destination, kind: "routed", release, reservation: undefined, why: decision.why };
  }
  const { reservation } = decision;
  return {
    destination: decision.destination,
    kind: "routed",
    release: () => releasePass({ home, reservationId: reservation.id, seams }),
    reservation,
    why: decision.why,
  };
}

/**
 * Under the lock: read the fleet again, read the document, decide, and publish a new reservation — but only while
 * this holder's lease still stands. A holder stalled past the lock's stale threshold can be taken over while still
 * alive, and without the fence it would publish a document read before the new holder's row, granting both past the
 * limit (found by a Codex review). A lost lease reads as an unavailable store, which refuses a limited account.
 *
 * @param stillHeld the lock handle's own fence, asked immediately before the write
 * @returns the route, or why the fleet could not be read at all
 */
export async function reserveUnderLock({
  bound,
  home,
  seams,
  stillHeld,
}: {
  bound: PassBound;
  home: string;
  seams: CodexPassReservationSeams;
  stillHeld: () => boolean;
}): Promise<Result<CodexPassRoute, CodexPassReservationError>> {
  const snapshot = await readFleetNow({ home, seams });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const path = stateHomePaths({ home }).live.codexPassReservationsJson;
  const read = readCodexPassReservations({ path });
  const store: CodexPassReservationStore = read.isOk()
    ? { document: read.value, kind: "healthy" }
    : { kind: "unavailable", reason: read.error.message };
  const decision = decide({ bound, seams, snapshot: snapshot.value, store });
  if (decision.kind !== "reserved") {
    return ok(routeOf({ decision, home, seams }));
  }
  const written = stillHeld()
    ? writeCodexPassReservations({ document: decision.document, path })
    : err(CodexPassReservationErrors.lockUnavailable({ reason: LEASE_TAKEN_OVER }));
  if (written.isErr()) {
    const unavailable: CodexPassReservationStore = { kind: "unavailable", reason: written.error.message };
    return ok(
      routeOf({ decision: decide({ bound, seams, snapshot: snapshot.value, store: unavailable }), home, seams }),
    );
  }
  return ok(routeOf({ decision, home, seams }));
}

/**
 * Route one pass — § The transaction.
 *
 * @param bound the pass's own bound, which dates its reservation's expiry
 * @param home the state home holding the document and the lock
 * @returns the route, or why the fleet could not be read at all
 */
async function acquirePass({
  bound,
  home,
  seams,
}: {
  bound: PassBound;
  home: string;
  seams: CodexPassReservationSeams;
}): Promise<Result<CodexPassRoute, CodexPassReservationError>> {
  const first = await readFleetNow({ home, seams });
  if (first.isErr()) {
    return err(first.error);
  }
  if (!codexFleetHasUsageLimit({ snapshot: first.value })) {
    const healthy: CodexPassReservationStore = { document: EMPTY_CODEX_PASS_RESERVATIONS, kind: "healthy" };
    return ok(routeOf({ decision: decide({ bound, seams, snapshot: first.value, store: healthy }), home, seams }));
  }
  const lock = await takeLock({ home, seams });
  if (lock.isErr()) {
    const fresh = await readFleetNow({ home, seams });
    if (fresh.isErr()) {
      return err(fresh.error);
    }
    const reason = CodexPassReservationErrors.lockUnavailable({ reason: lock.error }).message;
    const store: CodexPassReservationStore = { kind: "unavailable", reason };
    return ok(routeOf({ decision: decide({ bound, seams, snapshot: fresh.value, store }), home, seams }));
  }
  try {
    return await reserveUnderLock({ bound, home, seams, stillHeld: lock.value.stillHeld });
  } finally {
    lock.value.release();
  }
}

/**
 * The file-backed reservation port — `$SLOPWEAVER_HOME/live/codex-pass-reservations.json` under the operation lock.
 *
 * @param seams the fleet read, clock, ids and lock wait it runs over
 * @returns the port every Codex plan and review pass routes through
 */
export function fileCodexPassReservationPort({
  seams,
}: {
  seams: CodexPassReservationSeams;
}): CodexPassReservationPort {
  return { acquire: ({ bound, home }) => acquirePass({ bound, home, seams }) };
}
