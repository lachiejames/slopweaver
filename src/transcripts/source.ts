/**
 * The effectful edge: finding Claude Code's transcripts and streaming one through the pure folds.
 *
 * ## Located by SEARCH, never by reconstructing the directory name
 *
 * A transcript lives at `~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl`, where the directory name is
 * the working directory with its separators and dots replaced. Reconstructing that mangling is guesswork
 * that fails SILENTLY — a wrong guess yields "no transcript", which reads as a session nobody recorded
 * rather than as a bug. `sessions/liveSessionStore.ts` already solved this by scanning the project directories for
 * the file named after the session, and this module reuses that function rather than growing a second
 * answer to the same question.
 *
 * ## Bounded resident cost, complete answers
 *
 * Transcripts reach tens of megabytes (41.9 MB measured; `du -sh ~/.claude/projects` reported
 * 4.1 GB over 2,817 files). None of them is ever loaded whole. {@link transcriptReadings}
 * walks the file in {@link CHUNK_BYTES} slices and yields one decoded line at a time, so what is resident is
 * one chunk plus one line, whatever the file's size — and the ANSWER is still complete, which a tail read
 * could not be. A single line longer than {@link MAX_LINE_BYTES} is refused rather than accumulated, so the
 * bound holds even against a pathological record.
 */

import { closeSync, fstatSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { openFileNonBlocking } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { isBareSessionId, transcriptPathFor } from "../sessions/liveSessionStore.js";
import { type TranscriptSourceError, TranscriptSourceErrors } from "./errors.js";
import { type LineReading, readTranscriptLine } from "./record.js";

/** How much of a transcript is held in memory at once while it is walked. */
export const CHUNK_BYTES = 1_048_576;

/**
 * The longest single line that will be accumulated.
 *
 * One line CAN be enormous — two screenshot tool results were measured at ~190k characters in a single live
 * loop session — so the cap is set far above anything real and exists only so that resident cost is bounded
 * by construction rather than by luck. A line past it is reported as `oversized`, never silently dropped.
 *
 * @internal
 */
export const MAX_LINE_BYTES = 33_554_432;

/** One session's transcript, as the directory listing describes it. */
export interface SessionFile {
  /** The session id — the file's basename without `.jsonl`. */
  readonly sessionId: string;
  /** The absolute path to the transcript. */
  readonly path: string;
  /** The mangled project directory name it was found under. */
  readonly projectDir: string;
  /** Last write, in epoch milliseconds — the session's pulse. */
  readonly lastWriteMs: number;
  /** The transcript's size in bytes. */
  readonly bytes: number;
}

/**
 * Where Claude Code keeps every transcript on this machine.
 *
 * @returns the absolute path to `~/.claude/projects`
 */
export function claudeProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * Stat one candidate transcript, or say why it is not one.
 *
 * A file that vanished between the listing and the stat is ordinary — sessions end while this runs — and is
 * dropped rather than reported, because unlike the session registry the NAME here is the session id, so a
 * vanished file misleads nobody. Any OTHER stat failure (a directory listable but not searchable) is a
 * transcript that is there and unread, so it is reported, never dropped.
 *
 * @param path the candidate transcript
 * @param projectDir the mangled directory it was listed under
 * @param name the file's basename
 * @returns the listing entry, `"vanished"` for a file already gone, or `"unreadable"` for any other failure
 */
function statSession({
  path,
  projectDir,
  name,
}: {
  path: string;
  projectDir: string;
  name: string;
}): SessionFile | "vanished" | "unreadable" {
  try {
    const stats = statSync(path);
    return {
      bytes: stats.size,
      lastWriteMs: stats.mtimeMs,
      path,
      projectDir,
      sessionId: name.slice(0, -".jsonl".length),
    };
  } catch (error: unknown) {
    return errnoIs({ codes: ["ENOENT"], error }) ? "vanished" : "unreadable";
  }
}

/** Whether a thrown filesystem error carries one of the given errno codes. */
function errnoIs({ error, codes }: { error: unknown; codes: readonly string[] }): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

/** Every transcript a listing found, and every project directory it could not read. */
export interface SessionSurvey {
  /** Every transcript, newest first. */
  readonly sessions: readonly SessionFile[];
  /** Project directories (mangled names) not listed, or holding a transcript not stat'd, so one went unseen. */
  readonly unreadableDirs: readonly string[];
}

/**
 * Every session transcript on this machine, newest first, and the project directories it could not read.
 *
 * Only the top level of each project directory is listed. A session's SUBAGENT transcripts live one level
 * deeper, under `<sessionId>/subagents/`, and they are deliberately not sessions — folding them in would
 * make the fleet look several times larger than the number of windows the owner is actually running.
 *
 * @param projectsDir `~/.claude/projects`
 * @returns the survey, or the reason the corpus could not be listed at all
 */
export function surveySessions({ projectsDir }: { projectsDir: string }): Result<SessionSurvey, TranscriptSourceError> {
  let dirs: readonly string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch (error: unknown) {
    return err(TranscriptSourceErrors.projectsDirUnreadable({ cause: error, dir: projectsDir }));
  }
  const found: SessionFile[] = [];
  const unreadableDirs: string[] = [];
  for (const projectDir of dirs) {
    const listed = projectSessions({ projectDir, projectsDir });
    if (listed === "not-a-project") {
      continue;
    }
    for (const session of listed.sessions) {
      found.push(session);
    }
    if (!listed.complete) {
      unreadableDirs.push(projectDir);
    }
  }
  return ok({ sessions: found.toSorted((left, right) => right.lastWriteMs - left.lastWriteMs), unreadableDirs });
}

/*
 * One top-level entry's transcripts, and whether every one of them was read — or `"not-a-project"` for a
 * file, or an entry gone since the listing.
 */
function projectSessions({
  projectsDir,
  projectDir,
}: {
  projectsDir: string;
  projectDir: string;
}): { readonly sessions: readonly SessionFile[]; readonly complete: boolean } | "not-a-project" {
  let names: readonly string[];
  try {
    // Every entry is listed rather than filtered by its dirent type first, which a symlink or a filesystem
    // reporting no type would silently fail: the listing itself is the test.
    names = readdirSync(join(projectsDir, projectDir)).filter((name) => name.endsWith(".jsonl"));
  } catch (error: unknown) {
    // Anything but those two is one directory unreadable, not the corpus: skipped and NAMED, so a caller
    // claiming a complete answer can refuse to.
    return errnoIs({ codes: ["ENOTDIR", "ENOENT"], error }) ? "not-a-project" : { complete: false, sessions: [] };
  }
  const sessions: SessionFile[] = [];
  let complete = true;
  for (const name of names) {
    const session = statSession({ name, path: join(projectsDir, projectDir, name), projectDir });
    if (session === "unreadable") {
      complete = false;
    } else if (session !== "vanished") {
      sessions.push(session);
    }
  }
  return { complete, sessions };
}

/**
 * Every session transcript on this machine, newest first — {@link surveySessions} without the directories it
 * could not read, for a caller whose answer is a listing rather than a completeness claim.
 *
 * @param projectsDir `~/.claude/projects`
 * @returns every transcript, newest first, or the reason the corpus could not be listed at all
 */
export function listSessions({
  projectsDir,
}: {
  projectsDir: string;
}): Result<readonly SessionFile[], TranscriptSourceError> {
  return surveySessions({ projectsDir }).map((survey) => survey.sessions);
}

/**
 * Locate one session's transcript.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sessionId the session to find
 * @returns the transcript path, or why there is none
 */
export function findTranscript({
  projectsDir,
  sessionId,
}: {
  projectsDir: string;
  sessionId: string;
}): Result<string, TranscriptSourceError> {
  const path = transcriptPathFor({ projectsDir, sessionId });
  return path === undefined ? err(TranscriptSourceErrors.sessionNotFound({ sessionId })) : ok(path);
}

/**
 * Locate one session's transcript, refusing when two project directories both hold one under its name. The first
 * copy `findTranscript` takes is directory order, not identity: a stale copy would hide a turn the other holds, and
 * one uuid carrying different text in each would be quoted off whichever came first. So the reader of
 * the owner's words asks every directory, at the cost of a miss's scan on every hit.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sessionId the session to find
 * @returns the one transcript path, or why there is not exactly one
 */
export function findOnlyTranscript({
  projectsDir,
  sessionId,
}: {
  projectsDir: string;
  sessionId: string;
}): Result<string, TranscriptSourceError> {
  if (!isBareSessionId({ sessionId })) {
    return err(TranscriptSourceErrors.sessionNotFound({ sessionId }));
  }
  let dirs: readonly string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch (cause) {
    return err(TranscriptSourceErrors.projectsDirUnreadable({ cause, dir: projectsDir }));
  }
  const paths: string[] = [];
  for (const dir of dirs) {
    const candidate = join(projectsDir, dir, `${sessionId}.jsonl`);
    try {
      if (statSync(candidate, { throwIfNoEntry: false }) !== undefined) {
        paths.push(candidate);
      }
    } catch (cause) {
      // The flag answers a miss (ENOENT, ENOTDIR) without throwing, so a throw is a directory that would not say
      // whether it holds a copy — and uniqueness is not established past one.
      return err(TranscriptSourceErrors.transcriptUnreadable({ cause, path: candidate }));
    }
  }
  const [only] = paths;
  if (only === undefined) {
    return err(TranscriptSourceErrors.sessionNotFound({ sessionId }));
  }
  if (paths.length > 1) {
    return err(TranscriptSourceErrors.sessionAmbiguous({ paths, sessionId }));
  }
  return ok(only);
}

/**
 * A transcript opened for a single streaming pass.
 *
 * @internal
 */
export interface TranscriptStream {
  /** One decoded reading per line, in file order. Consumable ONCE — it holds the file descriptor. */
  readonly readings: Iterable<LineReading>;
  /**
   * Reasons a chunk could not be read, appended DURING iteration and empty until then. Read it after the
   * stream has been consumed: a partial walk that reported a complete answer is the failure to avoid.
   */
  readonly problems: readonly string[];
  /** The transcript's size in bytes, as it was when the stream opened. */
  readonly bytes: number;
}

/** The mutable half of a stream — the fd, the byte cursor and the line buffer. */
interface WalkState {
  readonly fd: number;
  readonly size: number;
  readonly buffer: Buffer;
  /*
   * Carries a multibyte character split across two chunks into the next one. Decoding each chunk on its own
   * turned an em dash straddling the 1 MiB boundary into three U+FFFD, so a line matched on it silently
   * stopped matching.
   */
  readonly decoder: TextDecoder;
  readonly problems: string[];
  offset: number;
  pending: string;
  lineNumber: number;
}

/**
 * Read one chunk into the pending buffer.
 *
 * @param state the walk in progress
 * @returns the newly read text, or `undefined` when the walk is over or the read failed
 */
function nextChunk({ state }: { state: WalkState }): string | undefined {
  if (state.offset >= state.size) {
    return undefined;
  }
  const length = Math.min(state.buffer.length, state.size - state.offset);
  let read: number;
  try {
    read = readSync(state.fd, state.buffer, 0, length, state.offset);
  } catch (error: unknown) {
    state.problems.push(`read failed at byte ${state.offset}: ${String(error)} — this pass is INCOMPLETE`);
    state.offset = state.size;
    return undefined;
  }
  // A read may legally return fewer bytes than asked. Only what it returned is decoded and stepped over, so
  // a short read neither decodes the buffer's stale tail nor skips real bytes.
  if (read === 0) {
    state.problems.push(
      `read returned nothing at byte ${state.offset} of ${state.size}: the file shrank while it was walked — this pass is INCOMPLETE`,
    );
    state.offset = state.size;
    return undefined;
  }
  try {
    const text = state.decoder.decode(state.buffer.subarray(0, read), { stream: true });
    state.offset += read;
    return text;
  } catch {
    // Strict, so a damaged byte is never repaired into U+FFFD and read as words nobody wrote.
    state.problems.push(`invalid UTF-8 within bytes ${state.offset}–${state.offset + read} — this pass is INCOMPLETE`);
    state.offset = state.size;
    return undefined;
  }
}

/**
 * What the decoder still holds once the file is read. A sequence cut off at the end is the torn last line a live
 * transcript routinely carries, so it becomes one U+FFFD — which no JSON line can parse around — rather than a
 * failure of the whole pass.
 *
 * @param state the finished walk
 * @returns the decoder's tail
 */
function decoderTail({ state }: { state: WalkState }): string {
  try {
    return state.decoder.decode();
  } catch {
    return "�";
  }
}

/**
 * One non-blank line of a transcript, before any decoding — or the position of a line past
 * {@link MAX_LINE_BYTES}, which is never accumulated and so has no text to hand over.
 */
export type RawTranscriptLine =
  { readonly lineNumber: number; readonly line: string } | { readonly lineNumber: number; readonly oversized: true };

/** A transcript opened for one streaming pass over its raw lines. */
export interface RawTranscriptStream {
  /** One entry per non-blank line, in file order. Consumable ONCE — it holds the file descriptor. */
  readonly lines: Iterable<RawTranscriptLine>;
  /** As {@link TranscriptStream.problems}: appended during iteration, read after it. */
  readonly problems: readonly string[];
  /** The transcript's size in bytes, as it was when the stream opened. */
  readonly bytes: number;
}

/**
 * Yield every completed line in the pending buffer, leaving the trailing fragment behind.
 *
 * A BLANK line yields nothing at all — it is neither a record nor a defect, and counting one as undecoded
 * would put a permanent off-by-one into every transcript that ends with a newline, which is all of them.
 * The line counter still advances over it, so every reported line number is the real one.
 *
 * @param state the walk in progress
 * @param final whether this is the last flush, when the trailing fragment IS a whole line
 * @returns every line completed by this flush
 */
function* drainLines({ state, final }: { state: WalkState; final: boolean }): Generator<RawTranscriptLine> {
  const parts = state.pending.split("\n");
  // `split` always yields at least one element, so the `pop` on the non-final path cannot be undefined; the
  // assertion states that rather than coalescing a real absence into an empty line nobody would notice.
  state.pending = final ? "" : parts.pop()!;
  for (const line of parts) {
    state.lineNumber += 1;
    if (line.trim() !== "") {
      yield { line, lineNumber: state.lineNumber };
    }
  }
  if (!final && state.pending.length > MAX_LINE_BYTES) {
    state.lineNumber += 1;
    state.pending = "";
    yield { lineNumber: state.lineNumber, oversized: true };
  }
}

/**
 * Open a transcript for one streaming pass over its RAW lines.
 *
 * For a reader that needs more of a line than `./record.ts` decodes — `./peerTraffic.ts` reads `attachment`
 * lines, which a {@link LineReading} reports only as `not-a-message-role` — in the same single pass, rather
 * than walking a tens-of-megabytes file twice.
 *
 * @param path the transcript to walk
 * @returns the stream, or why the file could not be opened
 */
export function transcriptLines({ path }: { path: string }): Result<RawTranscriptStream, TranscriptSourceError> {
  let size: number;
  let fd: number;
  try {
    // A FIFO blocks a plain open forever with no writer, so the path is opened ONCE, non-blocking, and judged on that
    // descriptor — a stat before the open would let the path become a pipe in between. Nothing
    // that is not a regular file is a transcript.
    fd = openFileNonBlocking({ path });
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      closeSync(fd);
      return err(TranscriptSourceErrors.transcriptUnreadable({ cause: new Error("not a regular file"), path }));
    }
    size = stats.size;
  } catch (error: unknown) {
    return err(TranscriptSourceErrors.transcriptUnreadable({ cause: error, path }));
  }
  const state: WalkState = {
    buffer: Buffer.alloc(CHUNK_BYTES),
    decoder: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }),
    fd,
    lineNumber: 0,
    offset: 0,
    pending: "",
    problems: [],
    size,
  };
  function* walk(): Generator<RawTranscriptLine> {
    try {
      for (;;) {
        const chunk = nextChunk({ state });
        if (chunk === undefined) {
          break;
        }
        state.pending += chunk;
        yield* drainLines({ final: false, state });
      }
      state.pending += decoderTail({ state });
      yield* drainLines({ final: true, state });
    } finally {
      closeSync(state.fd);
    }
  }
  return ok({ bytes: size, lines: walk(), problems: state.problems });
}

/**
 * Decode one raw line, or report the oversized one that carried no text.
 *
 * @param raw the line as {@link transcriptLines} yielded it
 * @returns the reading
 */
export function readRawTranscriptLine({ raw }: { raw: RawTranscriptLine }): LineReading {
  if ("oversized" in raw) {
    return { undecoded: { lineNumber: raw.lineNumber, why: "oversized" } };
  }
  return readTranscriptLine({ line: raw.line, lineNumber: raw.lineNumber });
}

/**
 * Open a transcript for one streaming pass.
 *
 * @param path the transcript to walk
 * @returns the stream, or why the file could not be opened
 */
export function transcriptReadings({ path }: { path: string }): Result<TranscriptStream, TranscriptSourceError> {
  return transcriptLines({ path }).map((stream) => ({
    bytes: stream.bytes,
    problems: stream.problems,
    readings: (function* decode(): Generator<LineReading> {
      for (const raw of stream.lines) {
        yield readRawTranscriptLine({ raw });
      }
    })(),
  }));
}
