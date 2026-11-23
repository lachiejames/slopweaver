/**
 * `slopweaver transcripts boot-hooks` — every `SessionStart` hook in scope that a transcript RECORDS as never
 * having run, read off the records Claude Code wrote, exiting 1 on any. It reads failure records, not a roll
 * call of registered hooks: a hook that left no record at all is invisible here, so exit 0 means no recorded
 * failure, never that every hook delivered.
 *
 * A thin effectful shell over the pure fold in `src/transcripts/bootHooks.ts`, which carries the incident
 * and the record shapes. It reuses `./scope.ts`'s scope, window and retention machinery whole, and walks RAW
 * lines rather than decoded readings because a hook record is an `attachment`, which the decoded reading
 * reports only as `not-a-message-role`.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";
import { err, ok } from "#lib/result.js";
import {
  type BootHookFailure,
  type BootHookReading,
  bootHookReading,
  inWindow,
  readBootHookFailure,
} from "../../../transcripts/bootHooks.js";
import { type SessionFile, transcriptLines } from "../../../transcripts/source.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { parseTranscriptsBootHooksArgs, resolveLimit, type TimeWindow } from "./core.js";
import { bootHookRow, jsonEnvelope, retentionReport } from "./render.js";
import { prepare, refuse, reportWalkFailure, type Scope } from "./scope.js";

const BOOT_HOOKS_USAGE =
  "usage: slopweaver transcripts boot-hooks [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--limit <value>] [--json]";

/*
 * Walk one transcript's raw lines for SessionStart hooks recorded as never run inside the window.
 *
 * The window is applied to each RECORD as well as to the file, because a long-lived seat's transcript is
 * re-selected by every probe that follows its boot: judged by the file alone, one old 127 would fail every
 * `--since 1h` run for the rest of that seat's life. A line that names no session takes the file's own.
 *
 * A line past the walker's limit carries no text, so a boot hook on it cannot be ruled out: it makes the
 * transcript UNREADABLE rather than clean.
 */
function bootHookFailuresOf({
  session,
  window,
}: {
  session: SessionFile;
  window: TimeWindow;
}): Result<readonly BootHookFailure[]> {
  const stream = transcriptLines({ path: session.path });
  if (stream.isErr()) {
    return err([stream.error.message]);
  }
  const failures: BootHookFailure[] = [];
  const oversized: string[] = [];
  for (const raw of stream.value.lines) {
    if ("oversized" in raw) {
      oversized.push(`line ${raw.lineNumber} is past the walker's limit, so a boot hook on it cannot be ruled out`);
      continue;
    }
    const failure = readBootHookFailure({ line: raw.line, lineNumber: raw.lineNumber });
    if (failure === undefined || !inWindow({ failure, sinceMs: window.sinceMs, untilMs: window.untilMs })) {
      continue;
    }
    failures.push(failure.sessionId.length > 0 ? failure : { ...failure, sessionId: session.sessionId });
  }
  const problems = [...stream.value.problems, ...oversized];
  return problems.length > 0 ? err(problems) : ok(failures);
}

/**
 * The probe's exit code: any failure or unreadable transcript is 1, nothing read is 3, a clean read is 0.
 *
 * Zero failures over zero transcripts is NOT a pass — a probe run against a window that held no new seat
 * proved nothing, and `|| alert` should still hear that. Nor is zero failures over a walk that skipped a
 * transcript it could not read: the 127 may be in the one it skipped.
 *
 * @param reading the folded verdict
 * @param unreadable how many transcripts in scope, or project directories holding them, could not be read whole
 * @returns the exit code
 */
export function bootHooksExitCode({ reading, unreadable }: { reading: BootHookReading; unreadable: number }): number {
  if (reading.failures > 0 || unreadable > 0) {
    return EXIT_ERROR;
  }
  return reading.sessionsWalked === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/*
 * Every transcript in scope walked for boot-hook failures, and how many transcripts or project directories
 * could not be read whole — each named on stderr as it is skipped.
 */
function walkScope({ scope, window }: { scope: Scope; window: TimeWindow }): {
  readonly perSession: readonly (readonly BootHookFailure[])[];
  readonly unreadable: number;
} {
  const perSession: (readonly BootHookFailure[])[] = [];
  // A project directory the listing could not read hides every transcript in it, so it counts exactly as an
  // unreadable transcript does: the 127 may be in there.
  scope.unreadableDirs.forEach((dir) => {
    logger.error({ msg: `transcripts: project directory ${dir} could not be listed — its transcripts were not read` });
  });
  let unreadable = scope.unreadableDirs.length;
  for (const session of scope.sessions) {
    const walked = bootHookFailuresOf({ session, window });
    if (walked.isErr()) {
      reportWalkFailure({ errors: walked.error, session });
      unreadable += 1;
      continue;
    }
    perSession.push(walked.value);
  }
  return { perSession, unreadable };
}

/**
 * Every SessionStart hook in scope that a transcript records as never having run.
 *
 * @param argv the full process argv
 * @returns the process exit code — see {@link bootHooksExitCode}
 */
export function runTranscriptsBootHooks(argv: readonly string[]): number {
  // `--until` bounds the RECORDS only: a seat that booted inside the window and kept writing after it is
  // exactly the transcript whose 127 a file-level cut would hide.
  const prepared = prepare({
    argv,
    ignoreUntilForFiles: true,
    parse: parseTranscriptsBootHooksArgs,
    requireScope: true,
    usage: BOOT_HOOKS_USAGE,
  });
  if ("code" in prepared) {
    return prepared.code;
  }
  const { scope, window } = prepared;
  const limit = resolveLimit({ fallback: 50, raw: prepared.parsed.values["limit"] });
  if (limit.isErr()) {
    return refuse({ errors: limit.error, usage: BOOT_HOOKS_USAGE });
  }
  const { perSession, unreadable } = walkScope({ scope, window });
  const reading = bootHookReading({ perSession });
  const shown = reading.seats.flatMap((seat) => seat.failures).slice(0, limit.value);
  if (scope.json) {
    logger.out({
      line: jsonEnvelope({
        payload: {
          failingSessions: reading.seats.length,
          failures: reading.failures,
          sessionsWalked: reading.sessionsWalked,
          shown,
          unreadable,
          unreadableDirs: scope.unreadableDirs,
        },
        retention: scope.retention,
      }),
    });
    return bootHooksExitCode({ reading, unreadable });
  }
  logger.out({ line: retentionReport({ retention: scope.retention }) });
  shown.forEach((failure) => {
    logger.out({ line: bootHookRow({ failure }) });
  });
  logger.out({
    line: `${reading.failures} SessionStart hooks recorded as never run, in ${reading.seats.length} of ${reading.sessionsWalked} transcripts (${unreadable} unreadable), ${shown.length} shown`,
  });
  return bootHooksExitCode({ reading, unreadable });
}

export const transcriptsBootHooksCommand = defineCommand({ run: runTranscriptsBootHooks });
