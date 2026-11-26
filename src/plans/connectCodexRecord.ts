/**
 * The Codex Connect record under its lock: the effects a Connect takes ({@link CodexConnectDeps}), and the few
 * moves every step makes on the one `codex.json` record — take its lock, write it only while held, act only while an
 * attempt is still the provider's record, and move a record to a failed end.
 *
 * The start (`./connectCodex.ts`) and the worker (`./connectCodexWorker.ts`) both stand on these, which is why they
 * are a module of their own rather than a copy in each.
 */
import { err, type Result } from "#lib/result.js";

import type { CodexLoginRun } from "../codex/loginExchange.js";
import type { SyncOutcome } from "../codexPlugin/plan.js";

import type { ConnectionFailure, PlanConnection } from "./connection.js";
import { type PlanConnectionError, PlanConnectionErrors } from "./connectionErrors.js";
import {
  type ConnectionLock,
  readPlanConnection,
  takeConnectionStartLock,
  writePlanConnection,
} from "./connectionStore.js";
import type { PlanRegisterError } from "./errors.js";
import type { PlanMutation, PlanRegisterSnapshot } from "./types.js";

/** How long a person has to finish signing in. */
export const CONNECT_SIGN_IN_MS = 10 * 60 * 1000;

/** Everything a Connect touches beyond its own attempt records. */
export interface CodexConnectDeps {
  readonly readRegister: () => Promise<Result<PlanRegisterSnapshot, PlanRegisterError>>;
  readonly writeRegister: (input: {
    readonly mutation: PlanMutation;
  }) => Promise<Result<PlanRegisterSnapshot, PlanRegisterError>>;
  /**
   * Create a store directory owner-only and exclusively, writing `attemptId` into its reservation file: `true` when
   * this call made it, `false` when anything already stood there — never adopting a directory it did not make — or
   * why it could not try.
   */
  readonly reserveStoreDir: (input: {
    readonly attemptId: string;
    readonly storeDir: string;
  }) => Result<boolean, string>;
  /** The attempt id a store's reservation file holds, `undefined` when it has none, or why it could not be read. */
  readonly readStoreReservation: (input: { readonly storeDir: string }) => Result<string | undefined, string>;
  /** Remove a store this Connect made, once its attempt ended without a plan; never throws. */
  readonly removeStoreDir: (input: { readonly storeDir: string }) => Result<void, string>;
  /**
   * Take a store out from under its path in one rename, into a holding directory this call creates exclusively under a
   * random name beside it — so the rename can never land on a directory something else put there. Answers the holding
   * directory; the store stands at `<holding>/store`. How a removal moves the store aside before the register's last
   * read, so a row committed after that read names a path the removal never touches.
   */
  readonly retireStoreDir: (input: { readonly storeDir: string }) => Result<string, string>;
  readonly nowMs: () => number;
  /** Pause the worker while another holder has the record's lock. */
  readonly wait: (input: { readonly ms: number }) => Promise<void>;
  /** This process's id, stamped on a lock it takes. */
  readonly processId: () => number;
  /** Whether the process that stamped a standing lock is still running. */
  readonly processAlive: (input: { readonly pid: number }) => boolean;
  readonly mintId: () => string;
  /** Background the worker for one attempt. */
  readonly launchWorker: (input: { readonly id: string }) => Result<void, PlanConnectionError>;
  /** Hold one store's sign-in until it ends. */
  readonly runSignIn: (input: {
    readonly codexHome: string;
    readonly cancelPath: string;
    readonly signInUrlPath: string;
    readonly deadlineMs: number;
  }) => CodexLoginRun;
  /**
   * Install Slopweaver into the Codex home a committed row now names — the one-home sync `plans add` runs — so a
   * seat booted on it carries Slopweaver's skills and hooks; never throws.
   */
  readonly syncCodexPluginHome: (input: { readonly codexHome: string }) => SyncOutcome;
}

/**
 * An ISO instant from epoch milliseconds.
 *
 * @returns the instant as an ISO-8601 string
 */
export function isoAt({ ms }: { ms: number }): string {
  return new Date(ms).toISOString();
}

/**
 * One take of the Codex record's lock, stamped with this process.
 *
 * @param nowMs the instant the lock is stamped with
 * @returns the lock, or why it is held elsewhere
 */
export function takeRecordLock({
  deps,
  home,
  nowMs,
}: {
  deps: CodexConnectDeps;
  home: string;
  nowMs: number;
}): Result<ConnectionLock, PlanConnectionError> {
  return takeConnectionStartLock({
    holderAlive: deps.processAlive,
    home,
    host: "codex",
    nowMs,
    pid: deps.processId(),
    token: deps.mintId(),
  });
}

/** How many times a worker tries for the record's lock, and how long it waits between tries — a minute in all. */
const WORKER_LOCK_TRIES = 600;
const WORKER_LOCK_WAIT_MS = 100;

/** Take the record's lock for a worker, waiting out a start that holds it for its one register read. */
async function takeLockPatiently({
  deps,
  home,
}: {
  deps: CodexConnectDeps;
  home: string;
}): Promise<Result<ConnectionLock, PlanConnectionError>> {
  for (let attempt = 1; ; attempt += 1) {
    const lock = takeRecordLock({ deps, home, nowMs: deps.nowMs() });
    if (lock.isOk() || lock.error.code !== "CONNECTION_STARTING" || attempt >= WORKER_LOCK_TRIES) {
      return lock;
    }
    await deps.wait({ ms: WORKER_LOCK_WAIT_MS });
  }
}

/**
 * Run `act` under the record's lock only while `id` is still the provider's record, so nothing it does — a register
 * write, a record write — can land for an attempt a later Connect already replaced. A live holder's lock is never
 * taken over (`takeConnectionStartLock`), so the check and everything `act` does stand together.
 *
 * @param act what to do while the attempt is current, handed the held lock
 * @param id the attempt that must still be the provider's record
 * @returns what `act` answered, or why it never ran
 */
export async function whileCurrent<T>({
  act,
  deps,
  home,
  id,
}: {
  act: (input: { readonly lock: ConnectionLock }) => Promise<Result<T, PlanConnectionError>>;
  deps: CodexConnectDeps;
  home: string;
  id: string;
}): Promise<Result<T, PlanConnectionError>> {
  const lock = await takeLockPatiently({ deps, home });
  if (lock.isErr()) {
    return err(lock.error);
  }
  try {
    const current = readPlanConnection({ home, host: "codex" });
    if (current.isErr()) {
      return err(current.error);
    }
    if (current.value?.id !== id) {
      return err(PlanConnectionErrors.superseded({ id }));
    }
    return await act({ lock: lock.value });
  } finally {
    lock.value.release();
  }
}

/**
 * Write a record under the lock, refusing when the lock was taken from a hung holder before the write.
 *
 * @returns nothing once written, or why it was not
 */
export function writeHeld({
  connection,
  home,
  lock,
}: {
  connection: PlanConnection;
  home: string;
  lock: ConnectionLock;
}): Result<void, PlanConnectionError> {
  if (!lock.stillHeld()) {
    return err(PlanConnectionErrors.starting());
  }
  return writePlanConnection({ connection, home });
}

/**
 * Write a worker's record only while its attempt is still the provider's record.
 *
 * @returns nothing once written, or why it was not — `CONNECTION_SUPERSEDED` when a later attempt replaced it
 */
export async function writeIfCurrent({
  connection,
  deps,
  home,
}: {
  connection: PlanConnection;
  deps: CodexConnectDeps;
  home: string;
}): Promise<Result<void, PlanConnectionError>> {
  return whileCurrent({
    act: async ({ lock }) => writeHeld({ connection, home, lock }),
    deps,
    home,
    id: connection.id,
  });
}

/**
 * A record moved to a failed end.
 *
 * @param detail the words the end carries, when there are any
 * @param nowMs the instant the end is stamped with
 * @returns the failed record
 */
export function finished({
  connection,
  detail,
  failure,
  nowMs,
}: {
  connection: PlanConnection;
  detail: string | undefined;
  failure: ConnectionFailure;
  nowMs: number;
}): PlanConnection {
  return {
    ...connection,
    failure,
    phase: "failed",
    updatedAtIso: isoAt({ ms: nowMs }),
    ...(detail === undefined ? {} : { detail }),
  };
}
