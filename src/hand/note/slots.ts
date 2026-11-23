/**
 * Reserving a cascade slot for a note about to be raised — the effectful half of `./cascade.ts`.
 *
 * Each raise that draws writes `live/<token>.slot`, holding `<id> <slot> <level>`, before it launches; each window
 * level counts its own cascade. A slot is held
 * while its note is: the raise's panel beating inside {@link SLOT_QUIET_MS} and not closed, or no beat yet and
 * the reservation inside {@link STARTUP_WINDOW_MS}. A raise that failed before calling `open` frees its slot at once;
 * one whose launch failed holds it through that window too, since its launcher may have reported failure for a panel
 * that is still starting. So a slot frees itself when its note closes, dies or never drew, and nothing has to delete
 * it for the next raise to take it.
 *
 * ## The pick is serialised, because two raises a moment apart are the common case
 *
 * A monitor pass posting two cards, or `hand post` beside a `hand push`, would otherwise both read slot 0 free
 * and draw one note exactly on top of the other — the title of the one behind hidden, which is the thing the
 * cascade exists to prevent. `live/slot.lock` is a directory, made with `mkdir`, which
 * the filesystem creates for exactly one caller; it is held only across the read, the pick and the write.
 * A lock older than {@link LOCK_STALE_MS} belongs to a raise that died inside that window and is taken over.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sleepSync } from "../../lib/sleepSync.js";
import { isAlive } from "../../measurement/measure.js";

import { cascadeSlot } from "./cascade.js";
import { CLOSED_BEAT, STARTUP_WINDOW_MS } from "./liveness.js";
import type { NoteLevel } from "./panel.js";

/**
 * How long a note's beat may go quiet before its slot frees, in milliseconds, when its panel recorded no pid — far
 * longer than the liveness window, because the two errors are not the same size. A slot held past a dead note
 * costs a gap in the cascade; one freed under a live note draws another step's note exactly over it.
 */
export const SLOT_QUIET_MS = 10 * 60_000;

/**
 * The text of the failure tombstone a raise leaves when it failed before calling `open`, so no panel of its can
 * ever start and its slot frees at once. Any other tombstone's slot holds through the startup window.
 */
export const NEVER_LAUNCHED = "failed before launch";

/** Owner-only permissions, matching the rest of the live directory. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** The suffix every reservation file carries. */
const SLOT_SUFFIX = ".slot";

/**
 * How old the lock may be before it is taken over, in milliseconds. The critical section is three small file
 * operations, so ten seconds is far past any live holder and short enough not to stall a raise behind a crash.
 */
const LOCK_STALE_MS = 10_000;

/** How long one wait for the lock sleeps, and how many waits before the raise gives up and reports it. */
const LOCK_WAIT_MS = 20;
const LOCK_ATTEMPTS = 250;

/** One reservation as read off disk. */
interface Reservation {
  readonly id: string;
  readonly token: string;
  readonly slot: number;
  /** The window level its note floats at, which names the cascade its slot counts in (`./cascade.ts`). */
  readonly level: NoteLevel;
}

/** Every {@link NoteLevel}, so a reservation's text is checked against the closed set. */
const NOTE_LEVELS: readonly NoteLevel[] = ["ordinary", "meeting-prep"];

/**
 * The text and modification time of one file, or `undefined` when it is not there. Any other failure throws,
 * and the raise reports it: reading an unreadable reservation as absent would draw over the note it holds.
 *
 * @param path the file
 * @returns its trimmed text and mtime, or `undefined`
 */
function readStamped({ path }: { path: string }): { text: string; atMs: number } | undefined {
  try {
    return { atMs: Math.floor(statSync(path).mtimeMs), text: readFileSync(path, "utf8").trim() };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
}

/**
 * Whether a file written at `atMs` is still inside its window at `nowMs`. A stamp LATER than `nowMs` counts:
 * a raise judges at the instant it started, so a reservation a concurrent raise wrote after that instant is the
 * newest note on screen, and reading it as absent would draw a second note in its place. A clock set back costs only a skipped place in
 * the cascade, never a hidden title, which is why this differs from `./liveness.ts`'s `fresh`.
 *
 * @param atMs the instant a file was written
 * @param nowMs the instant being judged at
 * @param window how old it may be and still count
 * @returns true when `nowMs - atMs <= window`
 */
function unexpired({ atMs, nowMs, window }: { atMs: number; nowMs: number; window: number }): boolean {
  return nowMs - atMs <= window;
}

/**
 * Parse one reservation file's text.
 *
 * @param token the raise token its file name carries
 * @param text the file's trimmed text
 * @returns the reservation, or `undefined` for text this module never writes
 */
function parseReservation({ token, text }: { token: string; text: string }): Reservation | undefined {
  const [id, slotText, levelText, ...rest] = text.split(" ");
  const slot = Number(slotText);
  const level = NOTE_LEVELS.find((candidate) => candidate === levelText);
  if (id === undefined || id.length === 0 || rest.length > 0 || !Number.isInteger(slot) || slot < 0) {
    return undefined;
  }
  if (level === undefined) {
    return undefined;
  }
  return { id, level, slot, token };
}

/**
 * The file a note's panel writes its process id into as its first act, beside its beat.
 *
 * @param liveDir the live directory
 * @param reservation the reservation whose note it is
 * @returns the pid file's path
 */
function pidPath({ liveDir, reservation }: { liveDir: string; reservation: Reservation }): string {
  return join(liveDir, `${reservation.id}.${reservation.token}.beat.pid`);
}

/**
 * Whether one reservation's note still holds its slot. A note that closed holds nothing, nor does a raise that never
 * called `open`. A note that recorded its pid holds while that process lives, however long its beat has
 * been quiet: a held button or a drag blocks the panel's loop for as long as the owner holds it,
 * and only the process table tells that apart from a panel that died without a tombstone. Before that, a note
 * holds while beating inside {@link SLOT_QUIET_MS}, or with no beat yet inside the startup window.
 *
 * @param liveDir the live directory
 * @param reservation the reservation
 * @param reservedAtMs when its file was written
 * @param nowMs the instant being judged at
 * @returns true while the note holds the slot
 */
function holdsSlot({
  liveDir,
  reservation,
  reservedAtMs,
  nowMs,
}: {
  liveDir: string;
  reservation: Reservation;
  reservedAtMs: number;
  nowMs: number;
}): boolean {
  const beat = readStamped({ path: join(liveDir, `${reservation.id}.${reservation.token}.beat`) });
  if (beat?.text === CLOSED_BEAT) {
    return false;
  }
  // A pid is only ever written by a panel that is running, so it outranks everything else.
  const pid = readStamped({ path: pidPath({ liveDir, reservation }) });
  if (pid !== undefined) {
    return isAlive({ pid: Number(pid.text) });
  }
  // Only a raise that never called `open` frees its slot at once. A launcher can report failure before or after its
  // panel starts, so a failed launch with no pid holds through the startup
  // window like any other that has not drawn yet — a gap for that long, never a note drawn over a late one.
  if (readStamped({ path: join(liveDir, `${reservation.token}.failed`) })?.text === NEVER_LAUNCHED) {
    return false;
  }
  if (beat === undefined) {
    return unexpired({ atMs: reservedAtMs, nowMs, window: STARTUP_WINDOW_MS });
  }
  return unexpired({ atMs: beat.atMs, nowMs, window: SLOT_QUIET_MS });
}

/**
 * Every reservation file in the live directory, each with whether it still holds its slot. A file whose text this
 * module never writes holds nothing, and the sweep removes it.
 *
 * @param liveDir the live directory
 * @param nowMs the instant being judged at
 * @returns each reservation file's path, its reservation when it parses, and whether it holds its slot
 */
export function readReservations({
  liveDir,
  nowMs,
}: {
  liveDir: string;
  nowMs: number;
}): readonly { path: string; reservation: Reservation | undefined; holds: boolean }[] {
  return readdirSync(liveDir)
    .filter((name) => name.endsWith(SLOT_SUFFIX))
    .flatMap((name) => {
      const path = join(liveDir, name);
      const stamped = readStamped({ path });
      if (stamped === undefined) {
        return [];
      }
      const reservation = parseReservation({ text: stamped.text, token: name.slice(0, -SLOT_SUFFIX.length) });
      const holds = reservation !== undefined && holdsSlot({ liveDir, nowMs, reservation, reservedAtMs: stamped.atMs });
      return [{ holds, path, reservation }];
    });
}

/**
 * Remove every reservation file that no longer holds its slot — its note closed, died or never drew, or its text
 * is not one this module writes — with its note's pid file. A note may stand for hours, so neither is ever swept
 * by its own age.
 *
 * @param liveDir the live directory
 * @param nowMs the instant being judged at
 */
export function sweepReservations({ liveDir, nowMs }: { liveDir: string; nowMs: number }): void {
  for (const entry of readReservations({ liveDir, nowMs })) {
    if (!entry.holds) {
      rmSync(entry.path, { force: true });
      if (entry.reservation !== undefined) {
        rmSync(pidPath({ liveDir, reservation: entry.reservation }), { force: true });
      }
    }
  }
}

/**
 * One attempt at the slot lock: make its directory, or, when another raise holds it, remove a lock older than
 * {@link LOCK_STALE_MS} or wait {@link LOCK_WAIT_MS} for a fresh one, so the caller's next attempt can take it.
 *
 * @param lock the lock directory
 * @param nowMs the instant a left-behind lock's age is judged at
 * @returns whether this attempt made the directory and so holds the lock
 */
function takeLock({ lock, nowMs }: { lock: string; nowMs: number }): boolean {
  try {
    mkdirSync(lock, { mode: DIR_MODE });
    return true;
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) {
      throw cause;
    }
  }
  const held = statSync(lock, { throwIfNoEntry: false });
  if (held !== undefined && nowMs - held.mtimeMs > LOCK_STALE_MS) {
    rmSync(lock, { force: true, recursive: true });
  } else {
    sleepSync({ ms: LOCK_WAIT_MS });
  }
  return false;
}

/**
 * Hold the slot lock across `act`, taking over a lock a dead raise left behind. The lock carries its holder's
 * token, and is released only while it still does: a holder that was frozen past {@link LOCK_STALE_MS} and taken
 * over must not, on waking, remove the lock the raise that took over now holds.
 *
 * @param liveDir the live directory the lock sits in
 * @param token the raise taking the lock
 * @param nowMs the instant a left-behind lock's age is judged at
 * @param act what runs while the lock is held
 * @returns what `act` returned
 */
function withSlotLock<T>({
  liveDir,
  token,
  nowMs,
  act,
}: {
  liveDir: string;
  token: string;
  nowMs: number;
  act: () => T;
}): T {
  const lock = join(liveDir, "slot.lock");
  const owner = join(lock, "owner");
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    if (!takeLock({ lock, nowMs })) {
      continue;
    }
    writeFileSync(owner, token, { mode: FILE_MODE });
    try {
      return act();
    } finally {
      if (readStamped({ path: owner })?.text === token) {
        rmSync(lock, { force: true, recursive: true });
      }
    }
  }
  throw new Error(`the cascade slot lock ${lock} stayed held past ${String(LOCK_ATTEMPTS * LOCK_WAIT_MS)}ms`);
}

/**
 * The slot to reserve, judged against every live reservation of the same cascade but this raise's own.
 *
 * @param liveDir the live directory
 * @param id the step being raised
 * @param token this raise's token, whose own reservation is left out
 * @param level the window level the note floats at, naming its cascade
 * @param nowMs the instant liveness is judged at
 * @returns the slot to take, and the live reservations of OTHER steps in that cascade judged against
 */
function pickSlot({
  liveDir,
  id,
  token,
  level,
  nowMs,
}: {
  liveDir: string;
  id: string;
  token: string;
  level: NoteLevel;
  nowMs: number;
}): {
  slot: number;
  rivals: readonly Reservation[];
} {
  const held = readReservations({ liveDir, nowMs }).flatMap((entry) =>
    entry.holds &&
    entry.reservation !== undefined &&
    entry.reservation.token !== token &&
    entry.reservation.level === level
      ? [entry.reservation]
      : [],
  );
  const own = held.find((reservation) => reservation.id === id);
  const slot = cascadeSlot({
    occupied: held.map((reservation) => reservation.slot),
    ...(own === undefined ? {} : { preferred: own.slot }),
  });
  return { rivals: held.filter((reservation) => reservation.id !== id), slot };
}

/** How many times a reservation moves off a slot another step's raise wrote first before the raise reports it. */
const CONFLICT_ATTEMPTS = 8;

/**
 * Reserve the cascade slot for one raise and record it as `<token>.slot`, holding `<id> <slot> <level>`: the slot
 * its own step's note already holds, when that note is still up, is replaced, and has no live note past it in its
 * cascade, else the slot past the highest one a live note of that cascade holds (`cascadeSlot`, `./cascade.ts`).
 *
 * The reservation is read back after it is written, and moves when another step's live reservation holds the same
 * slot. The lock alone cannot promise that: a raise frozen past {@link LOCK_STALE_MS} between its pick and its write
 * has its lock taken over, and wakes to write a pick another raise has since made too. The
 * later writer always reads the earlier one's file, so it is the one that moves.
 *
 * What this promises is the slot RETURNED, which is the one a note is drawn at: each raise writes before it reads
 * back, so two raises cannot both read back before the other's write, and no two return one slot. The FILES can
 * hold one slot twice, from that resumed writer's write until its own read-back moves it;
 * nothing is drawn from that window, and a third raise picking inside it reads the slot as taken.
 *
 * A reservation is a lease, so the promise holds only for a raise whose note starts within
 * {@link STARTUP_WINDOW_MS} of this return. One stalled past it stops holding its slot, a later raise may return
 * that slot too, and the two notes share one place until the owner drags one aside: the price of a
 * crashed raise never pinning a slot.
 *
 * @param liveDir the live directory
 * @param id the step being raised
 * @param token this raise's token
 * @param level the window level the note floats at, naming the cascade it takes a slot in
 * @param nowMs the instant liveness is judged at
 * @param betweenPickAndWrite a seam run after each pick and before its write, where a frozen raise is frozen
 * @returns the slot reserved
 */
export function reserveSlot({
  liveDir,
  id,
  token,
  level,
  nowMs,
  betweenPickAndWrite,
}: {
  liveDir: string;
  id: string;
  token: string;
  level: NoteLevel;
  nowMs: number;
  betweenPickAndWrite?: () => void;
}): number {
  return withSlotLock({
    act: () => {
      const path = join(liveDir, `${token}${SLOT_SUFFIX}`);
      for (let attempt = 0; attempt < CONFLICT_ATTEMPTS; attempt += 1) {
        const { slot } = pickSlot({ id, level, liveDir, nowMs, token });
        betweenPickAndWrite?.();
        writeFileSync(path, `${id} ${String(slot)} ${level}\n`, { mode: FILE_MODE });
        const { rivals } = pickSlot({ id, level, liveDir, nowMs, token });
        if (!rivals.some((rival) => rival.slot === slot)) {
          return slot;
        }
      }
      throw new Error(`the cascade slot for ${id} met another step's reservation ${String(CONFLICT_ATTEMPTS)} times`);
    },
    liveDir,
    nowMs,
    token,
  });
}
