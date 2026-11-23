/**
 * Reading the session registry and each session's transcript off disk. The effectful half of
 * {@link ./liveSessions}.
 *
 * ## Why the transcript is located by search rather than by construction
 *
 * A transcript lives at `~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl`, where the directory name is the
 * working directory with its separators and dots replaced. Reconstructing that mangling is guesswork that
 * fails silently — a wrong guess yields "no transcript", which this section would then report as an
 * unmeasurable activity rather than as a bug. Scanning the project directories for the file named after the
 * session is exact, and it is bounded by the number of project directories, which is small.
 *
 * ## Only the tail is read
 *
 * Transcripts reach tens of megabytes — the author's own was over 10 MB while this was written. The title is
 * the last `ai-title` record, so a bounded tail read finds it without loading the file. A session that has
 * not titled itself within that tail reports no title, which the row states rather than inventing one.
 */

import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../lib/parsers.js";
import { newestAiTitle, parseSessionFile, type SessionActivity, type SessionRecord } from "./liveSessions.js";

/** How much of a transcript's tail is read looking for a title. Enough for many records, bounded for a 10 MB file. */
export const TITLE_TAIL_BYTES = 262_144;

/**
 * The `code` a whole read throws when the file is past its cap. A registry file is far below the cap: MEASURED
 * the largest of 12 was 756 bytes (`wc -c ~/.claude/sessions/*.json`).
 */
const FILE_EXCEEDS_WHOLE_READ = "ERR_FILE_EXCEEDS_WHOLE_READ";

/** What a registry scan found, including the files it could not decode. */
export interface SessionScan {
  readonly records: readonly SessionRecord[];
  /** One sentence per registry file that would not parse. Never dropped — a session missing is a row missing. */
  readonly refused: readonly string[];
  /** Why the directory itself could not be read, when it could not. */
  readonly unreadable: string | undefined;
}

/** The names a caller injected, else every `.json` the directory lists — a listing that throws when it cannot be read. */
function sessionFileNames({
  given,
  sessionsDir,
}: {
  given: readonly string[] | undefined;
  sessionsDir: string;
}): readonly string[] {
  if (given !== undefined) {
    return given;
  }
  return readdirSync(sessionsDir).filter((name) => name.endsWith(".json"));
}

/**
 * Read every session registry file.
 *
 * @param sessionsDir `~/.claude/sessions`
 * @param names the file names to read, injected so the listing-then-read RACE is testable; the directory is
 *   listed when it is omitted
 * @returns the decoded sessions, the refusals, and the reason the directory could not be read
 */
export function scanSessions({
  sessionsDir,
  names: given,
}: {
  sessionsDir: string;
  names?: readonly string[] | undefined;
}): SessionScan {
  let names: readonly string[];
  try {
    names = sessionFileNames({ given, sessionsDir });
  } catch (error: unknown) {
    return { records: [], refused: [], unreadable: `${sessionsDir} could not be read: ${String(error)}` };
  }
  const records: SessionRecord[] = [];
  const refused: string[] = [];
  for (const name of names) {
    const read = readTextOr({ path: join(sessionsDir, name) });
    if (read.text === undefined) {
      // EVERY enumerated file lands in `records` or in `refused`, including one that vanished between the
      // listing and the read. It is tempting to skip a vanished file as "that session just exited" — but the
      // name is a PID, not a session id, so nothing here can say WHOSE it was, and a caller that then answers
      // "not running" about some other session is guessing on a fact other code acts on, which is why the safe
      // direction is chosen over the tidy one.
      //
      // It costs little: a watcher-triggered rescan does not list an already-deleted file at all, so this is
      // a microsecond race rather than the common case.
      refused.push(`${name}: ${read.why}`);
      continue;
    }
    const text = read.text;
    const parsed = parseSessionFile({ text });
    if (typeof parsed === "string") {
      refused.push(`${name}: ${parsed}`);
      continue;
    }
    records.push(parsed);
  }
  return { records, refused, unreadable: undefined };
}

/**
 * Read a file, or say why it could not be read.
 *
 * The reason is kept rather than collapsed to `undefined`, because the caller records it as a refusal and a
 * refusal a reader cannot act on is barely better than a silent skip.
 *
 * @param path the file to read
 * @returns the text, or the reason there is none
 */
function readTextOr({ path }: { path: string }): { readonly text: string | undefined; readonly why: string } {
  try {
    return { text: readTail({ maxBytes: TITLE_TAIL_BYTES, path, whole: true }), why: "" };
  } catch (error: unknown) {
    if (error instanceof TypeError && isRecord(error) && error["code"] === "ERR_ENCODING_INVALID_ENCODED_DATA") {
      return { text: undefined, why: "holds bytes that are not UTF-8" };
    }
    if (isRecord(error) && error["code"] === FILE_EXCEEDS_WHOLE_READ) {
      return {
        text: undefined,
        why: `is larger than the ${String(TITLE_TAIL_BYTES)} bytes a registry file is read whole in`,
      };
    }
    // The error's `code` when it carries a non-null one, else the error itself.
    const shown = isRecord(error) && error["code"] != null ? error["code"] : error;
    return { text: undefined, why: `could not be opened (${String(shown)})` };
  }
}

/**
 * Read at most the last `maxBytes` of a file. Only a regular file: opening a FIFO blocks until a writer appears,
 * and `talk offer` reads the chair's transcript tail while a call connects.
 *
 * @param path the file to read
 * @param maxBytes how much of the tail to take
 * @param whole read the whole file or throw: one larger than `maxBytes` throws `ERR_FILE_EXCEEDS_WHOLE_READ` rather
 *   than yield a tail, and a byte that is not UTF-8 throws rather than reading as U+FFFD. For a registry file, where
 *   a silently replaced byte inside a session id would name a session that does not exist and a tail
 *   would leave the rest of the file unchecked. A transcript tail stays lenient: it can start mid-character
 *   by construction.
 * @returns the tail as text
 */
export function readTail({
  path,
  maxBytes,
  whole = false,
}: {
  path: string;
  maxBytes: number;
  whole?: boolean;
}): string {
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error(`${path} is not a regular file — refusing to read a tail that could hang`);
  }
  const size = stat.size;
  if (whole && size > maxBytes) {
    throw Object.assign(new Error(`${path} is ${String(size)} bytes, past the ${String(maxBytes)} read whole`), {
      code: FILE_EXCEEDS_WHOLE_READ,
    });
  }
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  if (whole) {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  }
  return buffer.toString("utf8");
}

/**
 * The shape a Claude Code session id has: a UUID's letters, digits and dashes, so nothing a path reads as a separator
 * or a parent segment.
 */
const BARE_SESSION_ID = /^[A-Za-z0-9-]+$/;

/**
 * Whether a session id can name a transcript file at all: a UUID's alphabet only. An id is joined into
 * `<projectsDir>/<dir>/<id>.jsonl`, so `../../elsewhere/x` would resolve OUTSIDE the projects tree and read an
 * unrelated file as that session, and `..` names a stray `...jsonl`.
 *
 * @param sessionId the id a caller wants a transcript for
 * @returns true when the id is letters, digits and dashes, and non-empty
 */
export function isBareSessionId({ sessionId }: { sessionId: string }): boolean {
  return BARE_SESSION_ID.test(sessionId);
}

/**
 * Locate a session's transcript by searching the project directories for a file named after it.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sessionId the session to find; one carrying a path separator names no transcript
 * @returns the transcript path, or `undefined` when no project directory holds one
 */
export function transcriptPathFor({
  projectsDir,
  sessionId,
}: {
  projectsDir: string;
  sessionId: string;
}): string | undefined {
  if (!isBareSessionId({ sessionId })) {
    return undefined;
  }
  let dirs: readonly string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return undefined;
  }
  // A miss is the ordinary case — there are thousands of project directories and a session is normally in
  // one — so it is asked without an exception. MEASURED by timing both loops over the chain
  // journal's 299 sessions and 3,795 project directories: 8.4 s with a THROWING stat per miss, 2.9 s without.
  // The verb it slowed: `time slopweaver talk history --phrase x --json`.
  for (const dir of dirs) {
    const candidate = join(projectsDir, dir, `${sessionId}.jsonl`);
    try {
      if (statSync(candidate, { throwIfNoEntry: false }) !== undefined) {
        return candidate;
      }
    } catch {
      // Still a miss: the flag covers ENOENT and ENOTDIR, while a directory that will not open still throws.
    }
  }
  return undefined;
}

/**
 * What a session's transcript says about its pulse and its subject.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sessionId the session to look up
 * @returns the last-write instant and the newest title, or the reason neither could be established
 */
export function activityFor({ projectsDir, sessionId }: { projectsDir: string; sessionId: string }): SessionActivity {
  const path = transcriptPathFor({ projectsDir, sessionId });
  if (path === undefined) {
    return {
      lastWriteMs: undefined,
      title: undefined,
      why:
        sessionId === ""
          ? "the registry recorded no session id, so no transcript can be located"
          : "no transcript file exists for this session id yet",
    };
  }
  try {
    const lastWriteMs = statSync(path).mtimeMs;
    return {
      lastWriteMs,
      title: newestAiTitle({ text: readTail({ maxBytes: TITLE_TAIL_BYTES, path }) }),
      why: undefined,
    };
  } catch (error: unknown) {
    return { lastWriteMs: undefined, title: undefined, why: `the transcript could not be read: ${String(error)}` };
  }
}
