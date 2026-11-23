/**
 * Durable I/O for the fleet-wide spawn backoff (`./spawnBackoff.ts` decides, this only moves bytes): one JSON
 * document under `$SLOPWEAVER_HOME/live/machine/`, read and replaced under one operation lock so two spawns can
 * never both read a clear window and both go.
 *
 * Three read outcomes, not two: missing (a fresh install, the initial state), unreadable and malformed. The last
 * two are errors and never the initial state, because a broken file read as "nothing held" would license a
 * spawn on exactly the machine that was mid-incident when it was written — `../listen/recoverScheduleStore.ts`
 * keeps the same three apart for the same reason.
 *
 * The lock is the operation lock's never-stale-while-alive lease: a LIVE holder is never taken over, however
 * slow its gauge reads, and a DEAD one is taken over at once, so a crashed spawn stops no other. An age bound
 * breaks twice over: a live holder past the bound was taken over unfenced,
 * and two holders judging one state each admitted a spawn in the same recovery gap. What a live holder can
 * spend inside is bounded anyway — every gauge child carries `./read.ts`'s timeout.
 */
import { readFileSync } from "node:fs";

import { acquireOperationLock } from "../../admit/operationLock.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { INITIAL_SPAWN_BACKOFF_STATE, parseSpawnBackoffState, type SpawnBackoffState } from "./spawnBackoff.js";

/** The one operation-lock key every spawn's admission takes. */
const SPAWN_ADMISSION_LOCK_KEY = "machine-spawn-admission";

/** Owner-only, matching the dispatch register beside it. */
const DIR_MODE = 0o700;

/**
 * Another spawn holds the admission lock — the one failure a waiting spawn simply waits past.
 *
 * @internal
 */
export interface SpawnAdmissionLockHeldError {
  readonly code: "LOCK_HELD";
  readonly message: string;
}

/**
 * The state file exists but could not be read, or did not parse as the state.
 *
 * @internal
 */
export interface SpawnBackoffStateUnreadableError {
  readonly code: "STATE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/**
 * The state file could not be written.
 *
 * @internal
 */
export interface SpawnBackoffStateUnwritableError {
  readonly code: "STATE_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** Why the shared backoff could not be consulted. */
export type SpawnBackoffStoreError =
  SpawnAdmissionLockHeldError | SpawnBackoffStateUnreadableError | SpawnBackoffStateUnwritableError;

/**
 * The {@link SpawnBackoffStoreError} factory.
 *
 * @internal
 */
export const SpawnBackoffStoreErrors = {
  lockHeld: ({ reason }: { reason: string }): SpawnAdmissionLockHeldError => ({
    code: "LOCK_HELD",
    message: `another spawn is being admitted — ${reason}`,
  }),
  unreadable: ({ path, why }: { path: string; why: string }): SpawnBackoffStateUnreadableError => ({
    code: "STATE_UNREADABLE",
    message: `the spawn backoff at ${path} could not be read: ${why}`,
    path,
  }),
  unwritable: ({ path, cause }: { path: string; cause: unknown }): SpawnBackoffStateUnwritableError => ({
    code: "STATE_UNWRITABLE",
    message: `the spawn backoff at ${path} could not be written: ${String(cause)}`,
    path,
  }),
} as const;

/**
 * Read the shared backoff. A missing file is a fresh install's initial state; anything else that is not the
 * state is an error.
 *
 * @param home the state home the file lives under
 * @returns the state, or why it could not be trusted
 */
export function readSpawnBackoffState({ home }: { home: string }): Result<SpawnBackoffState, SpawnBackoffStoreError> {
  const path = stateHomePaths({ home }).live.machine.spawnBackoffJson;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok(INITIAL_SPAWN_BACKOFF_STATE);
    }
    return err(SpawnBackoffStoreErrors.unreadable({ path, why: String(error) }));
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "the spawn backoff", text: raw });
  } catch (error: unknown) {
    return err(SpawnBackoffStoreErrors.unreadable({ path, why: `not JSON (${String(error)})` }));
  }
  const parsed = parseSpawnBackoffState({ value });
  if (parsed.isErr()) {
    return err(SpawnBackoffStoreErrors.unreadable({ path, why: parsed.error.join("; ") }));
  }
  return ok(parsed.value);
}

/**
 * Replace the shared backoff atomically. Call it only from inside {@link withSpawnAdmissionLock}.
 *
 * @param home the state home the file lives under
 * @param state the state to write
 * @returns ok, or why the write failed
 */
export function writeSpawnBackoffState({
  home,
  state,
}: {
  home: string;
  state: SpawnBackoffState;
}): Result<void, SpawnBackoffStoreError> {
  const path = stateHomePaths({ home }).live.machine.spawnBackoffJson;
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "the spawn backoff", space: 2, value: state })}\n`,
      dirMode: DIR_MODE,
      path,
    });
  } catch (error: unknown) {
    return err(SpawnBackoffStoreErrors.unwritable({ cause: error, path }));
  }
  return ok(undefined);
}

/**
 * Whether the file still holds the state an admission judged — the second line behind the lock. The lock ages out
 * one holder: a record carrying no process start stamp falls back to the operation lock's ordinary window
 * (`../../admit/operationLockHeld.ts` `heldReason`). No build writes one under this key, since an unstamped process
 * is refused the never-stale lease (`../../admit/lockHolder.ts`) and the key is no older than that refusal, so
 * only a hand edit reaches it. A holder taken over that way after its own write is NOT fenced here — the stated
 * residue. What this check does fence: writing over a state a rival wrote meanwhile would admit
 * two spawns in one recovery gap, so a moved file is contention and the caller re-judges the fresh state rather
 * than failing.
 *
 * @param state the state the admission read before it judged
 * @returns ok while the file is unchanged, else lock contention or why it could not be re-read
 */
function stateStillReads({
  home,
  state,
}: {
  home: string;
  state: SpawnBackoffState;
}): Result<void, SpawnBackoffStoreError> {
  const now = readSpawnBackoffState({ home });
  if (now.isErr()) {
    return err(now.error);
  }
  const judged = safeJsonStringify({ label: "the judged spawn backoff", value: state });
  const current = safeJsonStringify({ label: "the current spawn backoff", value: now.value });
  if (judged !== current) {
    return err(
      SpawnBackoffStoreErrors.lockHeld({ reason: "another admission wrote the backoff while this one read the gauge" }),
    );
  }
  return ok(undefined);
}

/**
 * Run one admission under the fleet's one spawn lock: read the state, let `act` judge it, write what `act`
 * returns, release. The lock is held across the whole of it and is never taken from a live holder, so no two
 * spawns judge the same state; the write also lands only over the state `act` judged.
 *
 * @param home the state home the lock and the file live under
 * @param nowIso the instant the lock records
 * @param act judges the state and returns its answer and the state to write — `undefined` writes nothing
 * @returns `act`'s answer, or why the lock, the read or the write failed
 */
export function withSpawnAdmissionLock<T>({
  home,
  nowIso,
  act,
}: {
  home: string;
  nowIso: string;
  act: (options: { readonly state: SpawnBackoffState }) => {
    readonly value: T;
    readonly nextState: SpawnBackoffState | undefined;
  };
}): Result<T, SpawnBackoffStoreError> {
  const lock = acquireOperationLock({
    home,
    key: SPAWN_ADMISSION_LOCK_KEY,
    nowIso,
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    return err(SpawnBackoffStoreErrors.lockHeld({ reason: lock.error }));
  }
  try {
    const state = readSpawnBackoffState({ home });
    if (state.isErr()) {
      return err(state.error);
    }
    const { value, nextState } = act({ state: state.value });
    if (nextState !== undefined) {
      const unchanged = stateStillReads({ home, state: state.value });
      if (unchanged.isErr()) {
        return err(unchanged.error);
      }
      const written = writeSpawnBackoffState({ home, state: nextState });
      if (written.isErr()) {
        return err(written.error);
      }
    }
    return ok(value);
  } finally {
    lock.value.release();
  }
}
