/**
 * The pure half of `slopweaver talk cursor-retire`: which `talk unread` failures retiring a reader's cursor answers,
 * where a retired cursor is kept, what its receipt records, and the commands the verb prints.
 *
 * A call file is append-only and `talk unread` refuses a cursor whose read bytes changed (`./unreadPrefixProof.ts`);
 * readers stay that strict. When a home was carried through a rewrite of its call files, every read is refused
 * forever, and the reset is to retire the cursor so the next chair starts on the first-read path. Only that case is
 * eligible: a healthy cursor stays, and a gone call file is `talk quarantine`'s, never this verb's. The effectful
 * half is `./cursorRetireStore.ts`.
 */
import { join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";

import { type CursorRetireError, CursorRetireErrors } from "./cursorRetireErrors.js";
import { SUPERVISOR_UNREAD_CURSOR, unreadCursorsDir } from "./unreadCursorStore.js";
import type { UnreadError } from "./unreadErrors.js";
import type { UnreadRead } from "./unreadWords.js";

/**
 * The directory under `talk/unread-cursors/` a retired cursor is moved into — never a top-level `*.json`.
 *
 * @internal
 */
export const RETIRED_CURSORS_DIR = "retired";

/**
 * The `talk unread` failures retiring the cursor answers: its read bytes changed, or it does not parse.
 *
 * @internal
 */
export type RetireCause = "CALL_PREFIX_CHANGED" | "CURSOR_MALFORMED";

/** Why a cursor may be retired: the failure code and its message. */
export interface RetireVerdict {
  readonly cause: RetireCause;
  readonly why: string;
}

/** What a preview found, and what an apply re-checks under the cursor's lock. */
export interface CursorRetireAssessment {
  /** The reader. */
  readonly name: string;
  /** The cursor file. */
  readonly path: string;
  /** The hex sha256 of the cursor file's bytes, which `--apply` must name. */
  readonly sourceSha256: string;
  readonly cause: RetireCause;
  /** The message `talk unread` refuses with. */
  readonly why: string;
  /** How many calls the cursor names, `null` when it does not parse. */
  readonly cursorCallCount: number | null;
  /** Every call the cursor names whose bytes before its frontier are not what was read, sorted. */
  readonly failingCallIds: readonly string[];
}

/** What `--apply` writes beside the retired cursor. */
export interface CursorRetireReceipt {
  readonly name: string;
  readonly reason: string;
  readonly sourceSha256: string;
  readonly retiredAtIso: string;
  readonly cause: RetireCause;
  /** Where the cursor stood before it was moved. */
  readonly from: string;
  readonly cursorCallCount: number | null;
  readonly failingCallCount: number;
  /** The visible session that retired it, `null` when none resolves. */
  readonly session: string | null;
}

/**
 * Whether one `talk unread` read of a cursor that exists makes it retirable: only a `CALL_PREFIX_CHANGED` or
 * `CURSOR_MALFORMED` refusal does. A read that succeeds is a healthy cursor; any other refusal is answered elsewhere.
 *
 * @param path the cursor file, for the healthy refusal
 * @param read the ordinary `talk unread` read over the cursor
 * @returns the cause and its message, or why the cursor is not retired
 */
export function retireVerdict({
  path,
  read,
}: {
  path: string;
  read: Result<UnreadRead, UnreadError>;
}): Result<RetireVerdict, CursorRetireError> {
  if (read.isOk()) {
    return err(CursorRetireErrors.healthy({ path }));
  }
  const { code, message } = read.error;
  if (code === "CALL_PREFIX_CHANGED" || code === "CURSOR_MALFORMED") {
    return ok({ cause: code, why: message });
  }
  return err(CursorRetireErrors.notRetirable({ unreadCode: code, why: message }));
}

/**
 * Where a retired cursor is kept: `talk/unread-cursors/retired/<compact instant>-<name>/`, a directory no cursor scan
 * reads, since every scan takes only the top-level `*.json` files.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @param nowIso the instant it is retired at
 * @returns the directory the cursor and its receipt go in
 */
export function retiredCursorDir({ home, name, nowIso }: { home: string; name: string; nowIso: string }): string {
  const stamp = nowIso.replace(/[-:.]/gu, "");
  return join(unreadCursorsDir({ home }), RETIRED_CURSORS_DIR, `${stamp}-${name}`);
}

/**
 * The receipt `--apply` writes beside the retired cursor.
 *
 * @param assessment what the check under the lock found
 * @param reason why the cursor cannot be trusted, in the caller's words
 * @param nowIso the instant it is retired at
 * @param session the visible session retiring it, `null` when none resolves
 * @returns the receipt
 */
export function cursorRetireReceipt({
  assessment,
  reason,
  nowIso,
  session,
}: {
  assessment: CursorRetireAssessment;
  reason: string;
  nowIso: string;
  session: string | null;
}): CursorRetireReceipt {
  return {
    cause: assessment.cause,
    cursorCallCount: assessment.cursorCallCount,
    failingCallCount: assessment.failingCallIds.length,
    from: assessment.path,
    name: assessment.name,
    reason,
    retiredAtIso: nowIso,
    session,
    sourceSha256: assessment.sourceSha256,
  };
}

/**
 * A flag value as a shell word: bare when it is plainly safe, else JSON-quoted.
 *
 * @param value the value
 * @returns the word
 */
function shellWord({ value }: { value: string }): string {
  return /^[\w./~-]+$/u.test(value) ? value : JSON.stringify(value);
}

/**
 * The `--cursor` and `--home` flags a printed command repeats, so it acts on the reader and home the preview read.
 *
 * @param name the reader; the supervisor's needs no flag
 * @param home the `--home` the preview was given, `undefined` for the ambient one
 * @returns the flags, each with its leading space
 */
function targetFlags({ name, home }: { name: string; home: string | undefined }): string {
  let flags = "";
  if (name !== SUPERVISOR_UNREAD_CURSOR) {
    flags += ` --cursor ${name}`;
  }
  if (home !== undefined) {
    flags += ` --home ${shellWord({ value: home })}`;
  }
  return flags;
}

/**
 * The exact command that retires the cursor a preview read.
 *
 * @param name the reader
 * @param home the `--home` the preview was given, `undefined` for the ambient one
 * @param sourceSha256 the digest the preview printed
 * @returns the command
 */
export function cursorRetireApplyCommand({
  name,
  home,
  sourceSha256,
}: {
  name: string;
  home: string | undefined;
  sourceSha256: string;
}): string {
  return (
    `slopweaver talk cursor-retire${targetFlags({ home, name })} --apply --source-sha256 ${sourceSha256} ` +
    '--reason "<what rewrote the call files>"'
  );
}

/**
 * What to run once the cursor is retired: the first read, then the first mark adopting what an earlier chair read.
 *
 * @param name the reader
 * @param home the `--home` given, `undefined` for the ambient one
 * @returns the two commands, in order
 */
export function cursorRetireNextSteps({
  name,
  home,
}: {
  name: string;
  home: string | undefined;
}): readonly [string, string] {
  const flags = targetFlags({ home, name });
  return [`slopweaver talk unread${flags}`, `slopweaver talk unread${flags} --mark --adopt`];
}
