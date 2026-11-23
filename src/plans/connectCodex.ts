/**
 * A Codex Connect's console half: start an attempt and background its worker, cancel one, and read where each stands.
 * The worker that holds the sign-in and registers the plan is `./connectCodexWorker.ts`.
 *
 * Every effect a decision needs arrives through {@link CodexConnectDeps}, so the shipped functions run in a test
 * over a temporary home with a fake sign-in and a fake register; the attempt records themselves are real files under
 * that home (`./connectionStore.ts`). The pure decisions are `./connectPlan.ts` and `../codex/loginExchangeParse.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  CONNECT_SIGN_IN_MS,
  type CodexConnectDeps,
  finished,
  isoAt,
  takeRecordLock,
  writeHeld,
  writeIfCurrent,
} from "./connectCodexRecord.js";
import { removeOwnStore } from "./connectCodexStore.js";
import { activeConnectionId, connectionAsOf, isActivePhase, type PlanConnection } from "./connection.js";
import { type PlanConnectionError, PlanConnectionErrors } from "./connectionErrors.js";
import { type ConnectionLock, readPlanConnection, requestConnectionCancel } from "./connectionStore.js";
import { type ConnectDestination, codexConnectDestinations } from "./connectPlan.js";
import type { PlanProvider } from "./types.js";

/** How far past the sign-in window a record stays active — the worker's launch, register write and cleanup. */
const CONNECT_MARGIN_MS = 2 * 60 * 1000;

/**
 * Reserve the first destination by creating its store exclusively, so the directory a later cleanup removes is one
 * this attempt made and nothing else — a path that appears between choosing and creating is skipped, never adopted.
 */
function reserveDestination({
  attemptId,
  deps,
  destinations,
}: {
  attemptId: string;
  deps: CodexConnectDeps;
  destinations: readonly ConnectDestination[];
}): Result<ConnectDestination, PlanConnectionError> {
  for (const destination of destinations) {
    const reserved = deps.reserveStoreDir({ attemptId, storeDir: destination.storeDir });
    if (reserved.isErr()) {
      return err(PlanConnectionErrors.launchFailed({ cause: reserved.error }));
    }
    if (reserved.value) {
      return ok(destination);
    }
  }
  return err(PlanConnectionErrors.launchFailed({ cause: "no free alias is left for another Codex plan" }));
}

/**
 * Start a Codex Connect: refuse while one is in flight, choose where it lands, write the `starting` record and
 * background the worker. Returns at once.
 *
 * @param deps the injected effects
 * @param home the Slopweaver home
 * @returns the record as written, or why no attempt started
 */
export async function startCodexConnect({
  deps,
  home,
}: {
  deps: CodexConnectDeps;
  home: string;
}): Promise<Result<PlanConnection, PlanConnectionError>> {
  const nowMs = deps.nowMs();
  const lock = takeRecordLock({ deps, home, nowMs });
  if (lock.isErr()) {
    return err(lock.error);
  }
  let recorded: Result<PlanConnection, PlanConnectionError>;
  try {
    recorded = await recordStart({ deps, home, lock: lock.value, nowMs });
  } finally {
    lock.value.release();
  }
  if (recorded.isErr()) {
    return recorded;
  }
  const connection = recorded.value;
  const launched = deps.launchWorker({ id: connection.id });
  if (launched.isErr()) {
    // No worker will ever use the store this start reserved, so it goes with the attempt.
    const removed = await removeOwnStore({
      alias: connection.alias,
      deps,
      home,
      id: connection.id,
      storeDir: connection.storeDir,
    });
    const left = removed.isErr() ? `; ${connection.storeDir} was left behind: ${removed.error.message}` : "";
    const failed = finished({ connection, detail: `${launched.error.message}${left}`, failure: "EXITED", nowMs });
    await writeIfCurrent({ connection: failed, deps, home });
    return err(launched.error);
  }
  return ok(connection);
}

/**
 * Under the start lock: refuse while an attempt is in flight, choose where this one lands and write its `starting`
 * record. Once the record is written the lock may go, since a second start now reads this one as in flight. A lock
 * taken over while the register read ran is no longer this start's, so it writes nothing.
 */
async function recordStart({
  deps,
  home,
  lock,
  nowMs,
}: {
  deps: CodexConnectDeps;
  home: string;
  lock: ConnectionLock;
  nowMs: number;
}): Promise<Result<PlanConnection, PlanConnectionError>> {
  const previous = readPlanConnection({ home, host: "codex" });
  if (previous.isErr()) {
    return err(previous.error);
  }
  const judged = previous.value === undefined ? undefined : connectionAsOf({ connection: previous.value, nowMs });
  const inFlight = activeConnectionId({ previous: judged });
  if (inFlight !== undefined) {
    return err(PlanConnectionErrors.inFlight({ id: inFlight }));
  }
  const read = await deps.readRegister();
  if (read.isErr()) {
    return err(PlanConnectionErrors.registerUnreadable({ error: read.error }));
  }
  const id = deps.mintId();
  const reserved = reserveDestination({
    attemptId: id,
    deps,
    destinations: codexConnectDestinations({ home, snapshot: read.value }),
  });
  if (reserved.isErr()) {
    return err(reserved.error);
  }
  const destination = reserved.value;
  const connection: PlanConnection = {
    alias: destination.alias,
    deadlineAtIso: isoAt({ ms: nowMs + CONNECT_SIGN_IN_MS + CONNECT_MARGIN_MS }),
    host: "codex",
    id,
    phase: "starting",
    startedAtIso: isoAt({ ms: nowMs }),
    storeDir: destination.storeDir,
    updatedAtIso: isoAt({ ms: nowMs }),
  };
  return writeStartRecord({ connection, deps, home, lock });
}

/**
 * Write a start's `starting` record under its lock; on a failed write, take back the store it reserved, since no
 * record names it and so it is nobody's.
 */
async function writeStartRecord({
  connection,
  deps,
  home,
  lock,
}: {
  connection: PlanConnection;
  deps: CodexConnectDeps;
  home: string;
  lock: ConnectionLock;
}): Promise<Result<PlanConnection, PlanConnectionError>> {
  const written = writeHeld({ connection, home, lock });
  if (written.isOk()) {
    return ok(connection);
  }
  const { alias, id, storeDir } = connection;
  const removed = await removeOwnStore({ alias, deps, home, id, storeDir });
  if (removed.isErr()) {
    return err(PlanConnectionErrors.storeLeft({ cause: written.error, removal: removed.error.message, storeDir }));
  }
  return err(written.error);
}

/**
 * Every provider's last attempt, each judged as of now. One unreadable record fails the whole read rather than
 * listing the rest without it, so a damaged record is reported rather than read as no attempt.
 *
 * @param home the Slopweaver home
 * @param nowMs the instant they are judged at
 * @returns the attempts, keyed by provider, absent where there is none
 */
export function readPlanConnections({
  home,
  nowMs,
}: {
  home: string;
  nowMs: number;
}): Result<Partial<Record<PlanProvider, PlanConnection>>, PlanConnectionError> {
  const out: Partial<Record<PlanProvider, PlanConnection>> = {};
  for (const host of ["claude", "codex"] as const) {
    const read = readPlanConnection({ home, host });
    if (read.isErr()) {
      return err(read.error);
    }
    if (read.value !== undefined) {
      out[host] = connectionAsOf({ connection: read.value, nowMs });
    }
  }
  return ok(out);
}

/**
 * Ask an attempt to stop. An attempt that already ended is answered as it stands — a Cancel pressed as it finished
 * is not an error.
 *
 * @param home the Slopweaver home
 * @param id the attempt
 * @param nowMs the instant it is judged at
 * @returns the attempt as it stands, or why the Cancel could not be recorded
 */
export function cancelPlanConnection({
  home,
  id,
  nowMs,
}: {
  home: string;
  id: string;
  nowMs: number;
}): Result<PlanConnection, PlanConnectionError> {
  const all = readPlanConnections({ home, nowMs });
  if (all.isErr()) {
    return err(all.error);
  }
  const match = Object.values(all.value).find((connection) => connection.id === id);
  if (match === undefined) {
    return err(PlanConnectionErrors.notFound({ id }));
  }
  if (!isActivePhase({ phase: match.phase })) {
    return ok(match);
  }
  return requestConnectionCancel({ home, id }).map(() => match);
}
