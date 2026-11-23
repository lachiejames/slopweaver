/**
 * The half every `slopweaver transcripts` verb shares: parse the flags, resolve the window, list the corpus,
 * measure its retention floor, select the transcripts in scope, and walk them one by one.
 *
 * Effectful on purpose — it lists and reads the transcripts on disk, reads the clock and writes refusals
 * through the logger — while the parsers stay in {@link ./core} and every rendered line in {@link ./render}.
 */

import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { err, ok } from "../../../lib/result.js";
import type { LineReading } from "../../../transcripts/record.js";
import { retentionFloor, retentionVerdictFor } from "../../../transcripts/retention.js";
import type { SessionFile } from "../../../transcripts/source.js";
import { claudeProjectsDir, surveySessions, transcriptReadings } from "../../../transcripts/source.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { resolveTimeWindow, type TimeWindow, transcriptsTail } from "./core.js";
import type { RetentionView } from "./render.js";

/**
 * Why a scanning verb refuses an unscoped invocation.
 *
 * The corpus was 4.1 GB over 2,817 files when this was written (`du -sh ~/.claude/projects`), and a verb
 * that walked all of it because a flag was omitted would be a footgun rather than a default. Naming both
 * escapes in the refusal is the point — a rail that does not say how to get past it is just a wall.
 */
const UNSCOPED_REFUSAL =
  "refusing to walk every transcript on this machine — scope it with --session <id>, or with --since (e.g. --since 7d), which is cheap and states what it covered";

/** The resolved scope of an invocation: which corpus, which window, and which sessions it selected. */
export interface Scope {
  readonly projectsDir: string;
  readonly sessions: readonly SessionFile[];
  /** Project directories the listing could not read that `--project` (if given) would have kept. */
  readonly unreadableDirs: readonly string[];
  readonly retention: RetentionView;
  readonly json: boolean;
}

/** Where the transcripts are for this invocation — the explicit override, or this machine's own. */
function projectsDirOf({ parsed }: { parsed: ParsedFlags }): string {
  const given = parsed.values["projects"];
  return typeof given === "string" ? given : claudeProjectsDir();
}

/** A `--session`/`--project` value, or `undefined` when the flag was not given. */
function stringOf({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Pick the transcripts an invocation covers.
 *
 * @param all every transcript on disk
 * @param window the resolved `--since`/`--until`
 * @param sessionId an explicit `--session`, or `undefined`
 * @param project a `--project` substring filter, or `undefined`
 * @returns the selected transcripts, newest first
 */
function selectSessions({
  all,
  window,
  sessionId,
  project,
}: {
  all: readonly SessionFile[];
  window: TimeWindow;
  sessionId: string | undefined;
  project: string | undefined;
}): readonly SessionFile[] {
  return all.filter((session) => {
    if (sessionId !== undefined && session.sessionId !== sessionId) {
      return false;
    }
    if (project !== undefined && !session.projectDir.includes(project)) {
      return false;
    }
    if (window.sinceMs !== undefined && session.lastWriteMs < window.sinceMs) {
      return false;
    }
    return window.untilMs === undefined || session.lastWriteMs <= window.untilMs;
  });
}

/**
 * List the corpus, measure its retention floor, and select the transcripts in scope.
 *
 * @param parsed the verb's parsed flags
 * @param window the resolved `--since`/`--until`
 * @param nowMs the clock, injected at the one place it is read
 * @returns the resolved scope, or the accumulated rejections
 */
function scopeOf({ parsed, window, nowMs }: { parsed: ParsedFlags; window: TimeWindow; nowMs: number }): Result<Scope> {
  const projectsDir = projectsDirOf({ parsed });
  const listed = surveySessions({ projectsDir });
  if (listed.isErr()) {
    return err([listed.error.message]);
  }
  const all = listed.value.sessions;
  const floor = retentionFloor({ nowMs, oldestMs: all.at(-1)?.lastWriteMs, transcriptCount: all.length });
  const project = stringOf({ name: "project", parsed });
  const sessionId = stringOf({ name: "session", parsed });
  return ok({
    json: parsed.values["json"] === true,
    projectsDir,
    retention: { floor, verdict: retentionVerdictFor({ floor, sinceMs: window.sinceMs, untilMs: window.untilMs }) },
    sessions: selectSessions({ all, project, sessionId, window }),
    unreadableDirs: listed.value.unreadableDirs.filter((dir) => project === undefined || dir.includes(project)),
  });
}

/**
 * Print the accumulated rejections and the verb's usage line.
 *
 * @returns the usage exit code, for the verb to return
 */
export function refuse({ errors, usage }: { errors: readonly string[]; usage: string }): number {
  errors.forEach((message) => {
    logger.error({ msg: message });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/**
 * Walk one transcript, handing every line reading to a fold.
 *
 * @param session the transcript to walk
 * @param fold what to do with the readings
 * @returns whatever the fold returned, or the reason the file could not be walked
 */
function walk<T>({ session, fold }: { session: SessionFile; fold: (readings: Iterable<LineReading>) => T }): Result<T> {
  const stream = transcriptReadings({ path: session.path });
  if (stream.isErr()) {
    return err([stream.error.message]);
  }
  const value = fold(stream.value.readings);
  return stream.value.problems.length > 0 ? err(stream.value.problems) : ok(value);
}

/** Report a per-transcript failure without abandoning the rest of the sweep. */
export function reportWalkFailure({ session, errors }: { session: SessionFile; errors: readonly string[] }): void {
  errors.forEach((message) => {
    logger.error({ msg: `transcripts: ${session.sessionId} — ${message}` });
  });
}

/** Everything a verb needs before it starts reading: its flags, its window, and the transcripts in scope. */
export interface Prepared {
  readonly parsed: ParsedFlags;
  readonly window: TimeWindow;
  readonly scope: Scope;
}

/**
 * Handle `--help`, parse, resolve the window and select the transcripts — the half every verb shares.
 *
 * @param argv the full process argv
 * @param usage the verb's usage line
 * @param parse the verb's own parser, so the help-truth ratchet and this shell probe the same one
 * @param requireScope whether an unscoped invocation is refused rather than allowed to walk the whole corpus
 * @param ignoreUntilForFiles whether `--until` bounds which FILES are opened, or only what is read out of them
 * @returns what the verb needs, or the exit code it should return instead
 */
export function prepare({
  argv,
  usage,
  parse,
  requireScope,
  ignoreUntilForFiles = false,
}: {
  argv: readonly string[];
  usage: string;
  parse: (input: { rest: readonly string[] }) => Result<ParsedFlags>;
  requireScope: boolean;
  ignoreUntilForFiles?: boolean;
}): Prepared | { readonly code: number } {
  const rest = transcriptsTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: usage });
    return { code: EXIT_OK };
  }
  const parsed = parse({ rest });
  if (parsed.isErr()) {
    return { code: refuse({ errors: parsed.error, usage }) };
  }
  const values = parsed.value.values;
  const scoped = ["session", "since", "project"].some((name) => typeof values[name] === "string");
  if (requireScope && !scoped) {
    return { code: refuse({ errors: [UNSCOPED_REFUSAL], usage }) };
  }
  const window = resolveTimeWindow({
    nowIso: new Date().toISOString(),
    sinceFlag: values["since"],
    untilFlag: values["until"],
  });
  if (window.isErr()) {
    return { code: refuse({ errors: window.error, usage }) };
  }
  // A transcript is selected by its LAST WRITE, which is the file's own clock and not its contents'. For
  // the row-listing verbs that is the right question. For a verb that reads INSIDE a file it is a trap: a
  // session still being appended to right now would be excluded by any `--until` in the past, taking every
  // in-window call inside it with it. `--since` stays applied either way — a file last written before the
  // window began cannot hold a call inside it.
  const fileWindow = ignoreUntilForFiles ? { sinceMs: window.value.sinceMs, untilMs: undefined } : window.value;
  const scope = scopeOf({ nowMs: Date.now(), parsed: parsed.value, window: fileWindow });
  if (scope.isErr()) {
    return { code: refuse({ errors: scope.error, usage }) };
  }
  return { parsed: parsed.value, scope: scope.value, window: window.value };
}

/** What a sweep over the selected transcripts produced, per fold. */
export interface Swept<T> {
  readonly results: readonly T[];
  readonly walked: number;
  readonly failed: number;
  readonly bytes: number;
}

/**
 * Walk every selected transcript, keeping going past one that will not read.
 *
 * One unreadable file is one row missing, not a failed sweep — and it is REPORTED rather than absorbed, so
 * a count that is short says so instead of looking complete.
 *
 * @param sessions the transcripts in scope
 * @param fold what to do with each transcript's readings
 * @returns each fold's result, and how much was walked
 */
export function sweep<T>({
  sessions,
  fold,
}: {
  sessions: readonly SessionFile[];
  fold: (readings: Iterable<LineReading>) => T;
}): Swept<T> {
  const results: T[] = [];
  let failed = 0;
  let bytes = 0;
  for (const session of sessions) {
    const walked = walk({ fold, session });
    if (walked.isErr()) {
      reportWalkFailure({ errors: walked.error, session });
      failed += 1;
      continue;
    }
    results.push(walked.value);
    bytes += session.bytes;
  }
  return { bytes, failed, results, walked: results.length };
}
