/**
 * The session ledger's effectful edge: append an event, read the log back. Thin on purpose, mirroring
 * `../admit/queueStore.ts` — every decision lives in `./session.ts`, which is pure and testable on its own.
 *
 * The log is `$SLOPWEAVER_HOME/sessions/sessions.jsonl`, owner-only (`0700`/`0600`) for the same reason the
 * queue is: a session's `noted` text is free-form, and can hold anything the door ledger deliberately never
 * records.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "../lib/appendSeparator.js";
import { stateHomePaths } from "../stateHome.js";
import { type SessionEvent, sessionEventLine } from "./session.js";

/** The session log's filename under `$SLOPWEAVER_HOME/sessions`. */
const SESSION_FILE = "sessions.jsonl";

/** Owner-only permissions, matching the queue log's treatment. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The session log's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `sessions.jsonl`
 */
export function sessionLogPath({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).sessions, SESSION_FILE);
}

/**
 * Append one event to the session log, creating the directory if needed.
 *
 * @param event the event to append
 * @param home the state home (defaults to the resolved home)
 */
export function appendSessionEvent({ event, home }: { event: SessionEvent; home?: string }): void {
  const dir = stateHomePaths(home === undefined ? {} : { home }).sessions;
  mkdirSync(dir, { mode: DIR_MODE, recursive: true });
  appendLines({ mode: FILE_MODE, path: join(dir, SESSION_FILE), text: `${sessionEventLine({ event })}\n` });
}

/**
 * Read the session log's raw text. An absent log — a home that has never tracked a session — is the empty
 * string, not an error.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the log contents, or `""` when there is no log yet
 */
export function readSessionLogText({ home }: { home?: string } = {}): string {
  try {
    return readFileSync(sessionLogPath(home === undefined ? {} : { home }), "utf8");
  } catch {
    return "";
  }
}

/**
 * Read the session log's raw text, telling an ABSENT log apart from an unreadable one: absent is the empty string,
 * while any other read failure throws. For a writer that must not mistake a ledger it cannot read for one that
 * tracks nothing — the session harness's recorder (`../sessionHarness/sessionLedger.ts`), which warns instead.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the log contents, or `""` when there is no log yet
 */
export function readSessionLogTextStrict({ home }: { home?: string } = {}): string {
  try {
    return readFileSync(sessionLogPath(home === undefined ? {} : { home }), "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
