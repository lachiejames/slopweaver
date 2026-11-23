/**
 * The file edge of plan Connect attempts: one `<host>.json` record per host under
 * `$home/live/plan-connections`, the `<id>.cancel` marker a Cancel drops, and the `<id>.url` file the sign-in
 * program writes the provider's sign-in page into once it has one.
 *
 * Owner-only throughout (`0700` directory, `0600` files): nothing here is a credential, but a sign-in page's address
 * carries the attempt's own one-time state and is nobody else's to open. One record per provider, replaced whole, so
 * the console reads one file and a finished attempt is simply the last one.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";

import { type PlanConnection, parsePlanConnection } from "./connection.js";
import { type PlanConnectionError, PlanConnectionErrors } from "./connectionErrors.js";
import type { PlanProvider } from "./types.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Where one home keeps its attempts. */
function connectionsDir({ home }: { home: string }): string {
  return stateHomePaths({ home }).live.planConnectionsDir;
}

/**
 * The paths one attempt's files live at.
 *
 * @param home the Slopweaver home
 * @param id the attempt's id, already checked well-formed
 * @returns the cancel marker and the sign-in page file
 */
export function connectionMarkerPaths({ home, id }: { home: string; id: string }): {
  readonly cancel: string;
  readonly signInUrl: string;
} {
  const dir = connectionsDir({ home });
  return { cancel: join(dir, `${id}.cancel`), signInUrl: join(dir, `${id}.url`) };
}

/** The record file for one provider. */
function recordPath({ home, host }: { home: string; host: PlanProvider }): string {
  return join(connectionsDir({ home }), `${host}.json`);
}

/** A caught throw's words. */
function causeOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read one provider's last attempt, folding in the sign-in page the program wrote beside it.
 *
 * @param home the Slopweaver home
 * @param host whose attempt
 * @returns the record, `undefined` when there is none or it is not a record this version reads, or why it could not
 *   be read
 */
export function readPlanConnection({
  home,
  host,
}: {
  home: string;
  host: PlanProvider;
}): Result<PlanConnection | undefined, PlanConnectionError> {
  const path = recordPath({ home, host });
  if (!existsSync(path)) {
    return ok(undefined);
  }
  try {
    const connection = parsePlanConnection({
      value: safeJsonParse({ label: path, text: readFileSync(path, "utf8") }),
    });
    if (connection === undefined) {
      return ok(undefined);
    }
    return ok(withSignInUrl({ connection, home }));
  } catch (error: unknown) {
    return err(PlanConnectionErrors.unreadable({ cause: causeOf({ error }), path }));
  }
}

/** The record, carrying the sign-in page once the program has written one and the record does not hold it yet. */
function withSignInUrl({ connection, home }: { connection: PlanConnection; home: string }): PlanConnection {
  if (connection.signInUrl !== undefined || connection.phase !== "browser") {
    return connection;
  }
  const path = connectionMarkerPaths({ home, id: connection.id }).signInUrl;
  if (!existsSync(path)) {
    return connection;
  }
  const url = readFileSync(path, "utf8").trim();
  if (url === "") {
    return connection;
  }
  return { ...connection, signInUrl: url };
}

/**
 * Replace one provider's record whole.
 *
 * @param home the Slopweaver home
 * @param connection the record to store
 * @returns nothing on success, or why it could not be written
 */
export function writePlanConnection({
  connection,
  home,
}: {
  connection: PlanConnection;
  home: string;
}): Result<void, PlanConnectionError> {
  const path = recordPath({ home, host: connection.host });
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: path, value: connection })}\n`,
      dirMode: DIR_MODE,
      exactMode: true,
      fileMode: FILE_MODE,
      path,
    });
    return ok(undefined);
  } catch (error: unknown) {
    return err(PlanConnectionErrors.unwritable({ cause: causeOf({ error }), path }));
  }
}

/**
 * Drop the cancel marker the sign-in program polls for.
 *
 * @param home the Slopweaver home
 * @param id the attempt to cancel
 * @returns nothing on success, or why the marker could not be written
 */
export function requestConnectionCancel({ home, id }: { home: string; id: string }): Result<void, PlanConnectionError> {
  const path = connectionMarkerPaths({ home, id }).cancel;
  try {
    writeFileAtomic({ contents: "cancel\n", dirMode: DIR_MODE, exactMode: true, fileMode: FILE_MODE, path });
    return ok(undefined);
  } catch (error: unknown) {
    return err(PlanConnectionErrors.unwritable({ cause: causeOf({ error }), path }));
  }
}

/**
 * How long a lock whose holder is still alive stands before that holder is read as hung. A start holds the lock for one
 * register read and one record write, a worker for one register read and write and one record write, so a live holder
 * past this is stuck rather than slow. A holder that has died is taken over at once, whatever the lock's age.
 */
export const START_LOCK_STALE_MS = 30 * 60 * 1000;

/** Whether a caught throw carries one filesystem error code. */
function hasCode({ code, error }: { code: string; error: unknown }): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Create the lock file exclusively with one holder's stamp; `false` when one already stands. */
function createLock({ path, stamp }: { path: string; stamp: string }): boolean {
  try {
    const fd = openSync(path, "wx", FILE_MODE);
    writeSync(fd, stamp);
    closeSync(fd);
    return true;
  } catch (error: unknown) {
    if (hasCode({ code: "EEXIST", error })) {
      return false;
    }
    throw error;
  }
}

/**
 * Whether a lock's stamp was left by a holder that is gone: its process has exited, or it has held the lock past
 * {@link START_LOCK_STALE_MS} on the caller's clock. A stamp that does not parse is stale too.
 */
function stampIsStale({
  contents,
  holderAlive,
  nowMs,
}: {
  contents: string;
  holderAlive: (input: { readonly pid: number }) => boolean;
  nowMs: number;
}): boolean {
  const [takenAt, pid] = contents.trim().split(/\s+/u);
  const takenAtMs = Number(takenAt);
  const holderPid = Number(pid);
  if (!Number.isFinite(takenAtMs) || !Number.isInteger(holderPid)) {
    return true;
  }
  return !holderAlive({ pid: holderPid }) || nowMs - takenAtMs >= START_LOCK_STALE_MS;
}

/** A lock file's contents, or `undefined` when it is gone. */
function lockContents({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (hasCode({ code: "ENOENT", error })) {
      return undefined;
    }
    throw error;
  }
}

/** The process id a lock's stamp names, or `undefined` when the stamp does not parse. */
function stampPid({ contents }: { contents: string }): number | undefined {
  const pid = Number(contents.trim().split(/\s+/u)[1]);
  if (!Number.isInteger(pid)) {
    return undefined;
  }
  return pid;
}

/** The lock generations standing for one provider, lowest first. */
function lockGenerations({ dir, host }: { dir: string; host: PlanProvider }): readonly number[] {
  const pattern = new RegExp(`^${host}\\.lock\\.(\\d+)$`, "u");
  return readdirSync(dir)
    .map((name) => pattern.exec(name)?.[1])
    .filter((digits): digits is string => digits !== undefined)
    .map(Number)
    .toSorted((left, right) => left - right);
}

/** One holder's grip on a start lock. */
export interface ConnectionLock {
  /** Whether this holder's generation is still the highest and still its own — false once a takeover passed it. */
  readonly stillHeld: () => boolean;
  /** Remove this holder's own generation file, and nothing else; never throws. */
  readonly release: () => void;
}

/**
 * Take the one lock that serialises every write to a provider's record — a start's checks and first record, and a
 * worker's check, register write and final record — so two starts pressed at once cannot both see no attempt, and a
 * worker cannot register or write over an attempt that replaced its own.
 *
 * The lock is a numbered GENERATION of files, `<host>.lock.<n>`, and the highest one standing is the lock. Taking
 * it is one exclusive create of the next number, stamped with the caller's clock, its process id and an unguessable
 * token, and only when the highest is absent or stale. So two takers of one number cannot both win, and a taker never
 * moves, renames or removes a file it judged: a live holder's lock stays exactly where it was, and a hung or dead one
 * is passed by a higher number rather than withdrawn. A holder passed that way reads `stillHeld` false and writes
 * nothing. A file is removed only by its own holder's release, or once its process has exited and a higher generation
 * stands, when nothing can still be acting on it.
 *
 * @param home the Slopweaver home
 * @param host whose record it guards
 * @param nowMs the instant the lock is stamped with and a standing one judged against
 * @param token this holder's own mark, distinct per take
 * @param pid this holder's process, which a later taker checks is still alive
 * @param holderAlive whether a standing lock's process is still running
 * @returns the held lock, or why it could not be taken
 */
export function takeConnectionStartLock({
  holderAlive,
  home,
  host,
  nowMs,
  pid,
  token,
}: {
  holderAlive: (input: { readonly pid: number }) => boolean;
  home: string;
  host: PlanProvider;
  nowMs: number;
  pid: number;
  token: string;
}): Result<ConnectionLock, PlanConnectionError> {
  const dir = connectionsDir({ home });
  const pathOf = ({ generation }: { generation: number }): string => join(dir, `${host}.lock.${String(generation)}`);
  const stamp = `${String(nowMs)} ${String(pid)} ${token}\n`;
  try {
    mkdirSync(dir, { mode: DIR_MODE, recursive: true });
    const standing = lockGenerations({ dir, host });
    const top = standing.at(-1);
    if (top !== undefined) {
      const contents = lockContents({ path: pathOf({ generation: top }) });
      if (contents !== undefined && !stampIsStale({ contents, holderAlive, nowMs })) {
        return err(PlanConnectionErrors.starting());
      }
    }
    const generation = top === undefined ? 1 : top + 1;
    const path = pathOf({ generation });
    if (!createLock({ path, stamp })) {
      return err(PlanConnectionErrors.starting());
    }
    const stillHeld = (): boolean => {
      try {
        return lockContents({ path }) === stamp && lockGenerations({ dir, host }).every((n) => n <= generation);
      } catch {
        return false;
      }
    };
    const release = (): void => {
      try {
        if (lockContents({ path }) === stamp) {
          rmSync(path, { force: true });
        }
      } catch {
        // A release that cannot reach its file leaves it to be passed as stale; it never throws.
      }
    };
    if (!stillHeld()) {
      // A higher generation appeared between the listing and this create, so this one is not the lock.
      release();
      return err(PlanConnectionErrors.starting());
    }
    sweepDeadGenerations({ below: generation, holderAlive, pathOf, standing });
    return ok({ release, stillHeld });
  } catch (error: unknown) {
    return err(PlanConnectionErrors.unwritable({ cause: causeOf({ error }), path: dir }));
  }
}

/** Remove generations below the held one whose process has exited — nothing can still be acting on them. */
function sweepDeadGenerations({
  below,
  holderAlive,
  pathOf,
  standing,
}: {
  below: number;
  holderAlive: (input: { readonly pid: number }) => boolean;
  pathOf: (input: { readonly generation: number }) => string;
  standing: readonly number[];
}): void {
  for (const generation of standing.filter((n) => n < below)) {
    const path = pathOf({ generation });
    const contents = lockContents({ path });
    const holder = contents === undefined ? undefined : stampPid({ contents });
    if (holder === undefined || !holderAlive({ pid: holder })) {
      rmSync(path, { force: true });
    }
  }
}

/**
 * Remove one attempt's marker files once it has ended — the record keeps everything a reader needs. A marker that
 * cannot be removed is harmless, since the next attempt has its own id, so this never throws: a worker ending on an
 * error that names a leftover store must reach that error.
 *
 * @param home the Slopweaver home
 * @param id the attempt that ended
 */
export function clearConnectionMarkers({ home, id }: { home: string; id: string }): void {
  const paths = connectionMarkerPaths({ home, id });
  for (const path of [paths.cancel, paths.signInUrl]) {
    try {
      rmSync(path, { force: true });
    } catch {
      // Left for the next sweep of the directory; see above.
    }
  }
}
