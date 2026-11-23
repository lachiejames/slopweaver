/**
 * One live run per relay turn — the lease `talk relay` holds for as long as it touches a turn.
 *
 * The turn file says what a turn IS, not who is working on it, so a retry reading an unfinished one resumes it
 * — and a retry sent while the first run is still alive (the page lost its answer, not the process) would then
 * race that run through the board's check-then-write and the chat's one line. So every
 * run first holds the turn's lease for as long as it touches the turn ({@link holdTurnRun}). A live holder turns
 * a second run away with `RELAY_IN_FLIGHT` before it reads anything; a dead one — a run killed on the console's
 * timeout — is taken over, because a crash is exactly what `resume` is for.
 *
 * The lease is a directory of GENERATIONS, `<turn>.run/0`, `1`, `2`, each naming the pid that placed it, and the
 * highest one is the lease. A generation is placed by `link`, which fails where the name exists, and nothing is
 * ever renamed or removed from under another run: taking over a dead generation `n` means linking `n + 1`, so
 * of any number of runs that found the same dead holder exactly one wins, and a run that finds `n + 1` taken
 * reads the new holder instead. An earlier shape set a dead lease aside by rename, and a review
 * showed a third run filling the gap that rename opened, leaving two runs each holding it.
 *
 * A holder is its pid AND that process's start time, and it is live only while both still match. A pid alone
 * outlives the run that wrote it: once a killed relay's pid is handed to an unrelated long-lived process, a
 * pid-only check reads that process as the holder and turns every later run away for as long as it lives.
 * A zombie — exited, unreaped — is no holder either ({@link processStartOf}). Every
 * doubt errs toward turning a run away, never toward two holders: whether the
 * pid is running at all is the kernel's and `ps`'s answer, a start time that could not be read — when the lease was placed
 * or now — leaves the pid alone to decide, and a generation that cannot be read, or names no holder, refuses the
 * run with `PATH_UNREADABLE` rather than being taken over. Nothing this module
 * writes is ever half there, so that last case is only ever something outside it.
 */
import { execFileSync } from "node:child_process";
import { linkSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { ensureDirectory, writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import { type TalkError, TalkErrors } from "./errors.js";

/** How many generations one run tries before standing down — each miss means another run won that one. */
const TAKEOVER_ATTEMPTS = 3;

/** A lease's holder: a pid, and when that process started where `ps` could say. */
export interface LeaseHolder {
  readonly pid: number;
  readonly start: string | undefined;
}

/** What a generation file says: a run's pid and start time, or a run that finished. */
type Holder = LeaseHolder | "released";

/** Whether a pid is running, and when that process started where `ps` could say. */
export interface ProcessStart {
  readonly running: boolean;
  readonly start: string | undefined;
}

/** A pid's process as it stands now — how a holder is told from its pid's next owner. */
export type StartOf = (candidate: number) => ProcessStart;

/**
 * Whether the process with this pid is running, and when it started, as `ps` prints it — THE one process probe
 * every holder-liveness check in this tree reads: the relay lease here, the file locks of `./callLock.ts`, the
 * operation lock through `../admit/lockHolder.ts`, and the snapshot-pool lease of `../codex/snapshotLease.ts`.
 *
 * A ZOMBIE is not running. An exited process its parent has not reaped keeps its pid and its start stamp, and
 * signal 0 still reaches it, so a probe that stopped at the kernel would read it as a live holder and wedge a lock
 * that never ages for as long as its parent withholds `wait`. MEASURED on
 * darwin: `sh -c "sleep 0 & echo $!; exec sleep 3"` leaves the echoed pid printing `ZN` for `ps -o stat=`, and
 * `process.kill(pid, 0)` succeeds on it. The state and the start come from ONE `ps` row, so no second fork.
 *
 * @returns `running` from a signal-0 probe (a process of another user's counts) and a `ps` state that is not a
 *   zombie's, and a start stamp stable for one process's whole life — `undefined` when it is not running or `ps`
 *   failed, never a guess
 */
export function processStartOf({ pid }: { pid: number }): ProcessStart {
  if (!signalReaches({ pid })) {
    return { running: false, start: undefined };
  }
  return processStartFromPs({ text: psRow({ pid }) });
}

/**
 * What one `ps -o stat=,lstart=` row says of a process signal 0 already reached: a zombie is not running, any
 * other state is, and the start stamp is the row after the state, byte for byte what `ps -o lstart=` alone prints
 * — so a record stamped before the state joined the row still matches. A row that cannot be read leaves the
 * process running and unstamped: every doubt errs toward a live holder, never toward two.
 *
 * @param text the row as `ps` printed it, or empty when `ps` printed nothing or failed
 * @returns whether the process is running, and its start stamp where the row carried one
 */
export function processStartFromPs({ text }: { text: string }): ProcessStart {
  // Split at the first gap by index rather than one regex: `\s*(\S+)\s+(\S.*?)\s*$` backtracks polynomially.
  const row = text.trim();
  const gap = row.search(/\s/u);
  if (gap === -1) {
    return { running: true, start: undefined };
  }
  const state = row.slice(0, gap);
  const start = row.slice(gap).trim();
  // A line terminator — `.` crosses none of them — means the row was not one row, so it names no stamp.
  if (/[\n\r\p{Zl}\p{Zp}]/u.test(start)) {
    return { running: true, start: undefined };
  }
  if (state.startsWith("Z")) {
    return { running: false, start: undefined };
  }
  // Only a stamp shaped as `lstart` prints one is a stamp: anything else, compared, would read a live holder recycled.
  if (!LSTART_STAMP.test(start)) {
    return { running: true, start: undefined };
  }
  return { running: true, start };
}

/** `lstart` in the C locale: weekday, month, a space-padded day, the time to the second, the year. */
const LSTART_STAMP = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/u;

/** Whether a signal-0 probe finds this pid — `EPERM` means it exists and belongs to someone else. */
function signalReaches({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM";
  }
}

/**
 * The state and start stamp `ps` prints for a pid, as one row, or empty when it printed none.
 *
 * `lstart` is rendered in the caller's timezone and locale, so two relays run under different `TZ` would read one
 * live process as two start times and take a live holder for a recycled pid. It is
 * always asked for from `/bin/ps` by its path, in UTC and the C locale and inheriting nothing else, so the same
 * instant is the same text whoever asks and whatever their `PATH`. It resolves to the
 * second, and a pid comes round again only after the whole pid space has been handed out, never within one.
 * Reproduce the row: `env LANG=C LC_ALL=C TZ=UTC /bin/ps -o stat=,lstart= -p 1` prints a state and a start stamp in the shape `Ss   <weekday> <month> <day> <time> <year>`.
 */
function psRow({ pid }: { pid: number }): string {
  try {
    return execFileSync("/bin/ps", ["-o", "stat=,lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      // SIGKILL, which a stopped or signal-handling `ps` cannot outlast; one in uninterruptible kernel sleep outlasts any.
      killSignal: "SIGKILL",
    });
  } catch {
    return "";
  }
}

/** Whether a thrown filesystem error carries this errno code. */
function errnoIs({ cause, code }: { cause: unknown; code: "EEXIST" | "ENOENT" }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === code;
}

/**
 * Hold a turn's run lease for this process, or say which live process already holds it.
 *
 * @param home the Slopweaver home this relay's state lives under
 * @param pid this process's pid, written with its start time into the generation it places
 * @param startOf a pid's current start time — injected so a dead or recycled holder is a fixture, not a process
 * @returns a release marking this run's generation finished, `RELAY_IN_FLIGHT`, or `PATH_UNREADABLE`
 */
export function holdTurnRun({
  home,
  turnId,
  pid,
  startOf,
}: {
  home: string;
  turnId: string;
  pid: number;
  startOf: StartOf;
}): Result<{ release: () => void }, TalkError> {
  const turns = stateHomePaths({ home }).talkTurns;
  const dir = join(turns, `${turnId}.run`);
  ensureDirectory({ directory: dir });
  const line = holderLine({ pid, start: startOf(pid).start });
  for (let attempt = 0; attempt < TAKEOVER_ATTEMPTS; attempt += 1) {
    const next = freeGeneration({ dir, startOf, turnId });
    if (next.isErr()) {
      return err(next.error);
    }
    const path = join(dir, String(next.value));
    const placed = placeGeneration({ line, path, staged: join(turns, `${turnId}.run.${String(pid)}.tmp`) });
    if (placed.isErr()) {
      return err(placed.error);
    }
    if (placed.value) {
      return ok({
        release: () => {
          markReleased({ path });
        },
      });
    }
  }
  return err(TalkErrors.relayInFlight({ pid: null, turnId }));
}

/**
 * The generation this run may try to place next — the one above the highest, whose holder is gone.
 *
 * @returns the generation number, `RELAY_IN_FLIGHT` naming a live holder, or `PATH_UNREADABLE`
 */
function freeGeneration({
  dir,
  startOf,
  turnId,
}: {
  dir: string;
  startOf: StartOf;
  turnId: string;
}): Result<number, TalkError> {
  return highestGeneration({ dir }).andThen((current) =>
    liveHolder({ dir, generation: current, startOf }).andThen((live): Result<number, TalkError> => {
      if (live !== undefined) {
        return err(TalkErrors.relayInFlight({ pid: live, turnId }));
      }
      return ok(current === undefined ? 0 : current + 1);
    }),
  );
}

/**
 * The line a lease carries: the pid, then its start time, or `-` where that could not be read.
 *
 * @returns the holder as one line, without its newline
 */
export function holderLine({ pid, start }: LeaseHolder): string {
  if (start === undefined) {
    return `${String(pid)} -`;
  }
  return `${String(pid)} ${start}`;
}

/**
 * The pid holding a generation while it is alive, or `undefined` for no generation, a released one, or a dead one.
 *
 * @param generation the highest generation placed so far, if any
 * @returns the live holder's pid, `undefined` when the next generation is free to place, or `PATH_UNREADABLE`
 */
function liveHolder({
  dir,
  generation,
  startOf,
}: {
  dir: string;
  generation: number | undefined;
  startOf: StartOf;
}): Result<number | undefined, TalkError> {
  if (generation === undefined) {
    return ok(undefined);
  }
  return readGeneration({ path: join(dir, String(generation)) }).map((holder) => {
    if (holder === "released") {
      return undefined;
    }
    return holderRunning({ holder, startOf }) ? holder.pid : undefined;
  });
}

/**
 * Whether a lease's holder is still the process that placed it: its pid running, and not since handed to another
 * process — a start time that could not be read, then or now, leaves the pid alone to decide.
 *
 * @param startOf a pid's current start time — injected so a dead or recycled holder is a fixture, not a process
 * @returns true while the holder may still be mid-work, so its lease must not be taken over
 */
export function holderRunning({ holder, startOf }: { holder: LeaseHolder; startOf: StartOf }): boolean {
  const now = startOf(holder.pid);
  const recycled = now.start !== undefined && holder.start !== undefined && now.start !== holder.start;
  return now.running && !recycled;
}

/**
 * The holder a lease line names, or `undefined` for a line that names none.
 *
 * @param text the line, trimmed
 * @returns the pid and start time it carries
 */
export function holderOf({ text }: { text: string }): LeaseHolder | undefined {
  const match = /^([1-9]\d{0,9}) (.+)$/u.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, digits = "", stamp = ""] = match;
  return { pid: Number(digits), start: stamp === "-" ? undefined : stamp };
}

/**
 * The highest generation in a lease directory, or `undefined` for a lease never placed.
 *
 * @returns the generation number, or `PATH_UNREADABLE` when the directory cannot be listed
 */
function highestGeneration({ dir }: { dir: string }): Result<number | undefined, TalkError> {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    return err(TalkErrors.pathUnreadable({ cause, path: dir }));
  }
  const generations = names.filter((name) => /^(?:0|[1-9]\d*)$/u.test(name)).map(Number);
  return ok(generations.length === 0 ? undefined : Math.max(...generations));
}

/**
 * Place one generation if it is not already there: written in full beside the directory, then linked into it.
 *
 * @param line the holder this generation names — a pid, then its start time or `-`
 * @param staged where the generation is written in full before the link
 * @returns whether this run placed it — `false` when another run already holds that generation
 */
function placeGeneration({
  line,
  path,
  staged,
}: {
  line: string;
  path: string;
  staged: string;
}): Result<boolean, TalkError> {
  try {
    writeFileSync(staged, `${line}\n`, { mode: 0o600 });
    linkSync(staged, path);
    return ok(true);
  } catch (cause) {
    if (errnoIs({ cause, code: "EEXIST" })) {
      return ok(false);
    }
    return err(TalkErrors.pathUnreadable({ cause, path }));
  } finally {
    rmSync(staged, { force: true });
  }
}

/** Mark this run's own generation finished, so a later run never waits on a pid the system handed on. */
function markReleased({ path }: { path: string }): void {
  writeFileAtomic({ contents: "released\n", fileMode: 0o600, path });
}

/**
 * What one generation names: a pid and start time, or `released`.
 *
 * @returns the holder, or `PATH_UNREADABLE` when the generation cannot be read or names no holder
 */
function readGeneration({ path }: { path: string }): Result<Holder, TalkError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8").trim();
  } catch (cause) {
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
  if (text === "released") {
    return ok("released");
  }
  const holder = holderOf({ text });
  if (holder === undefined) {
    return err(TalkErrors.pathUnreadable({ cause: new Error("the run lease names no holder"), path }));
  }
  return ok(holder);
}
