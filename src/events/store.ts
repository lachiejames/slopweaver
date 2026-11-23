/**
 * Durable I/O for the supervisor stream — one append-only JSONL file, and offset-resumable reads of it.
 *
 * Every decision a caller makes about an event is made by a pure function in `./event.ts`; this module only
 * appends bytes and hands back what it read, plus the offset to resume from.
 *
 * ## Only whole lines are ever consumed
 *
 * A reader stops at the last newline it can see and reports THAT offset, never the end of file. The tail of
 * a file can be a record another process is still writing, and a cursor advanced past a half-written line
 * resumes inside a record — the one way an append-only stream can lose an event permanently. Leaving the
 * partial line unconsumed costs one extra poll and cannot lose anything.
 */
import { closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { slopweaverHome } from "../config.js";
import { appendLines } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { parseSupervisorEvent, type SupervisorEvent, supervisorEventLine } from "./event.js";

/** Owner-only, matching the rest of `live/` — this stream names pids and carries a dying process's output. */
const DIR_MODE = 0o700;

/**
 * Where the stream lives.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute path to the stream file
 */
export function supervisorStreamPath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).live.events.streamJsonl;
}

/**
 * Append one event, fsync'd.
 *
 * fsync'd for the same reason the arm journal is: the events worth having are the ones written moments
 * before something takes the whole process tree down, and a buffered last line is the line that never
 * survives.
 *
 * @param event the event to publish
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns ok, or the one-line reason the append failed
 */
export function appendSupervisorEvent({
  event,
  home = slopweaverHome(),
}: {
  event: SupervisorEvent;
  home?: string;
}): Result<void> {
  const path = supervisorStreamPath({ home });
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ durable: true, path, text: `${supervisorEventLine({ event })}\n` });
  } catch (error: unknown) {
    return err([`could not append to the supervisor stream at ${path}: ${String(error)}`]);
  }
  return ok(undefined);
}

/**
 * Publish an event WITHOUT letting a failure sink the caller.
 *
 * The stream is an observability surface bolted beside real work: a listener death-watch tick that refused to
 * journal a death because a notification file was unwritable would be strictly worse than one that carried
 * on. So a failure is narrated to the caller as a string and the caller decides — and every caller in this
 * repository decides to keep going.
 *
 * @param event the event to publish
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the failure sentence, or `undefined` when the append succeeded
 */
export function publishSupervisorEvent({
  event,
  home = slopweaverHome(),
}: {
  event: SupervisorEvent;
  home?: string;
}): string | undefined {
  const appended = appendSupervisorEvent({ event, home });
  return appended.isErr() ? appended.error.join("; ") : undefined;
}

/** One decoded event, and where a reader that has consumed it resumes. */
export interface SupervisorStreamEntry {
  readonly event: SupervisorEvent;
  /**
   * The byte offset just past this event's own line.
   *
   * Carried from the read rather than recomputed by a caller, because it CANNOT be recomputed: parsing
   * rebuilds an event from the fields this repository knows about, so re-encoding it need not reproduce the
   * bytes it came from. A `--limit` drain that measured its own re-encoding would drift its cursor by
   * exactly the fields it dropped.
   */
  readonly endOffset: number;
}

/** What one offset-resumable read found. */
export interface SupervisorStreamRead {
  /** Every decodable event between the requested offset and the last complete line, in file order. */
  readonly entries: readonly SupervisorStreamEntry[];
  /** The byte offset to resume from — the end of the last COMPLETE line, never the end of file. */
  readonly offset: number;
  /**
   * True when the file was SHORTER than the requested offset, so it was truncated or replaced and events
   * between the reader's last position and the new start were missed. The read restarts from zero and says
   * so, rather than resuming at a byte that now means something else.
   */
  readonly gap: boolean;
  /** How many lines in the consumed range would not decode. Dropped, per `./event.ts`, but counted. */
  readonly unreadable: number;
}

/** Read a byte range out of an already-opened file descriptor. */
function readRange({ fd, from, to }: { fd: number; from: number; to: number }): string {
  const buffer = Buffer.allocUnsafe(to - from);
  let filled = 0;
  while (filled < buffer.length) {
    const read = readSync(fd, buffer, filled, buffer.length - filled, from + filled);
    if (read === 0) {
      break;
    }
    filled += read;
  }
  return buffer.subarray(0, filled).toString("utf8");
}

/**
 * Read every complete event after a byte offset.
 *
 * @param fromOffset the byte offset to resume from; 0 (or omitted) reads the whole stream
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns what was read and the offset to resume from, or the one-line reason the file could not be read
 */
export function readSupervisorEventsFrom({
  fromOffset = 0,
  home = slopweaverHome(),
}: {
  fromOffset?: number;
  home?: string;
} = {}): Result<SupervisorStreamRead> {
  const path = supervisorStreamPath({ home });
  let size: number;
  try {
    size = statSync(path).size;
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error["code"] : undefined;
    if (code === "ENOENT") {
      // A home whose surfaces have never published is not a fault — it is the ordinary starting state, and
      // an offset of 0 is exactly where the first publisher will begin.
      return ok({ entries: [], gap: false, offset: 0, unreadable: 0 });
    }
    return err([`could not read the supervisor stream at ${path}: ${String(error)}`]);
  }
  const gap = fromOffset > size;
  const start = gap ? 0 : fromOffset;
  if (start === size) {
    return ok({ entries: [], gap, offset: size, unreadable: 0 });
  }
  let text: string;
  try {
    const fd = openSync(path, "r");
    try {
      text = readRange({ fd, from: start, to: size });
    } finally {
      closeSync(fd);
    }
  } catch (error: unknown) {
    return err([`could not read the supervisor stream at ${path}: ${String(error)}`]);
  }
  return ok(decodeRange({ gap, start, text }));
}

/** Decode a byte range's complete lines, discarding any trailing partial one. */
function decodeRange({ gap, start, text }: { gap: boolean; start: number; text: string }): SupervisorStreamRead {
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) {
    return { entries: [], gap, offset: start, unreadable: 0 };
  }
  const complete = text.slice(0, lastNewline + 1);
  const entries: SupervisorStreamEntry[] = [];
  let unreadable = 0;
  let cursor = start;
  for (const line of complete.split("\n").slice(0, -1)) {
    cursor += Buffer.byteLength(`${line}\n`, "utf8");
    if (line.trim().length === 0) {
      continue;
    }
    const event = parseSupervisorEvent({ line });
    if (event === undefined) {
      unreadable += 1;
    } else {
      entries.push({ endOffset: cursor, event });
    }
  }
  return { entries, gap, offset: cursor, unreadable };
}

/**
 * How much of the stream's tail {@link readSupervisorEventsTail} reads — enough to hold the last handful of
 * events, bounded so a tick's cost does not grow with the stream's length.
 */
const TAIL_BYTES = 16_000;

/**
 * The newest events on the stream, for a caller that only needs to know what it just said.
 *
 * Bounded on purpose: the listener's death-watch tick runs every fifteen seconds and only wants the newest
 * listener event, so reading the whole file would make a per-tick cost grow forever with a file that only
 * ever grows. Reads from a byte boundary that is probably mid-line and discards that first partial line
 * rather than parsing it — dropping one event off the far end of a tail is harmless, and mis-decoding one is
 * not.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param maxBytes how far back to read (defaults to {@link TAIL_BYTES})
 * @returns the events in that range, or the one-line reason the file could not be read
 */
export function readSupervisorEventsTail({
  home = slopweaverHome(),
  maxBytes = TAIL_BYTES,
}: {
  home?: string;
  maxBytes?: number;
} = {}): Result<readonly SupervisorEvent[]> {
  const path = supervisorStreamPath({ home });
  let size: number;
  try {
    size = statSync(path).size;
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error["code"] : undefined;
    if (code === "ENOENT") {
      return ok([]);
    }
    return err([`could not read the supervisor stream at ${path}: ${String(error)}`]);
  }
  const start = Math.max(0, size - maxBytes);
  return readSupervisorEventsFrom({ fromOffset: start, home }).map((read) =>
    // A non-zero start lands mid-line, and `readSupervisorEventsFrom` will have parsed that fragment as one
    // unreadable line and dropped it already — which is exactly the wanted behaviour, so nothing else to do.
    read.entries.map((entry) => entry.event),
  );
}
