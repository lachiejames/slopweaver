/**
 * The effectful half of `./loadLedger.ts`: append a load row, read the rows back, and read one seat's own boot
 * records for a profile hook that never ran.
 *
 * ## Every read says when it could not read
 *
 * A gate or a monitor that read "no failure" off a ledger it could not open would clear a seat that never got the owner's
 * profile, which is the silence this whole lane exists to end. So an unreadable ledger or transcript is an `err`
 * naming the path, and an undecodable ledger line is COUNTED, never skipped unseen. A transcript that is simply not
 * there is different: a Codex session, a test's fake id and a seat on another machine have none, and that is an
 * absence of evidence rather than a failure to read it.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { errorMessage } from "#lib/errorMessage.js";
import type { IngestError } from "#lib/ingestError.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { readBootHookFailure } from "../transcripts/bootHooks.js";
import { findTranscript, transcriptLines } from "../transcripts/source.js";

import {
  decodeProfileLoadRow,
  mergeObservations,
  observationOfRow,
  type ProfileLoadObservation,
  type ProfileLoadRow,
} from "./loadLedger.js";
import { observationOfBootFailure, observationOfTranscriptLoad, profileContextCalls } from "./loadTranscript.js";

/**
 * Append one load row.
 *
 * @param home the Slopweaver home
 * @param row the attempt to record
 * @returns the ledger path, or why it could not be written
 */
export function appendProfileLoad({ home, row }: { home: string; row: ProfileLoadRow }): Result<string, IngestError> {
  const path = stateHomePaths({ home }).profileLoadsJsonl;
  return safeFs({
    execute: (): string => {
      mkdirSync(dirname(path), { mode: 0o700, recursive: true });
      appendLines({ mode: 0o600, path, text: `${JSON.stringify(row)}\n` });
      return path;
    },
    operation: "profile.appendLoad",
    path,
  });
}

/** What reading the ledger found. */
export interface ProfileLoadsRead {
  readonly rows: readonly ProfileLoadRow[];
  /** Lines that were not a row — counted so a reader can say its answer is partial. */
  readonly undecodable: number;
}

/**
 * Read every load row, oldest first. A ledger nothing has written yet is empty, not an error.
 *
 * @param home the Slopweaver home
 * @returns the rows and how many lines were not one, or why the ledger could not be read
 */
export function readProfileLoads({ home }: { home: string }): Result<ProfileLoadsRead> {
  const path = stateHomePaths({ home }).profileLoadsJsonl;
  if (!existsSync(path)) {
    return ok({ rows: [], undecodable: 0 });
  }
  const rows: ProfileLoadRow[] = [];
  let undecodable = 0;
  // `readJsonlLines` always hands over the tail after the last newline, which every append leaves EMPTY. That one
  // zero-length tail is no row; counting it read every ledger as partial, and every first boot as configured
  // (`src/admit/profileFirstBoot.ts`). Any other line that is not a row, a blank one included, still counts.
  // A holder rather than a `let`: the callback's write is invisible to control-flow narrowing, which reads a closed-over
  // `let` as its initial value and the tail check below as always false.
  const tail = { empty: false };
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        tail.empty = line.length === 0;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          undecodable += 1;
          return;
        }
        const row = decodeProfileLoadRow({ value });
        if (row === undefined) {
          undecodable += 1;
          return;
        }
        rows.push(row);
      },
      path,
      // A byte that is not UTF-8 arrives as one lone U+FFFD, which no row parses from, so it is COUNTED; repaired,
      // a damaged row decoded as a whole one and a first boot read a ledger it could not read.
      strictUtf8: true,
    });
  } catch (cause) {
    return err([`the profile load ledger at ${path} could not be read: ${errorMessage({ error: cause })}`]);
  }
  return ok({ rows, undecodable: tail.empty ? undecodable - 1 : undecodable });
}

/**
 * Every run of the profile hook one transcript records, as observations: each one that never ran as a failure, and
 * each one that ran judged by what it printed (see `observationOfTranscriptLoad`).
 *
 * @param path the transcript
 * @param fileSessionId its session id, for a record that names none
 * @returns the observations, or why the transcript could not be read whole
 */
export function transcriptProfileObservations({
  path,
  fileSessionId,
}: {
  path: string;
  fileSessionId: string;
}): Result<readonly ProfileLoadObservation[]> {
  const stream = transcriptLines({ path });
  if (stream.isErr()) {
    return err([stream.error.message]);
  }
  const found: ProfileLoadObservation[] = [];
  const oversized: string[] = [];
  const contextCalls = new Set<string>();
  for (const raw of stream.value.lines) {
    if ("oversized" in raw) {
      oversized.push(
        `${path} line ${String(raw.lineNumber)} is past the walker's limit, so a boot hook on it cannot be ruled out`,
      );
      continue;
    }
    for (const id of profileContextCalls({ line: raw.line })) {
      contextCalls.add(id);
    }
    const failure = readBootHookFailure({ line: raw.line, lineNumber: raw.lineNumber });
    const observation =
      failure === undefined
        ? observationOfTranscriptLoad({ contextCalls, fileSessionId, line: raw.line })
        : observationOfBootFailure({ failure, fileSessionId });
    if (observation !== undefined) {
      found.push(observation);
    }
  }
  const problems = [...stream.value.problems, ...oversized];
  return problems.length > 0 ? err(problems) : ok(found);
}

/**
 * Everything known about whether these session ids hold the owner's profile: each one's own transcript records and every
 * ledger row naming one, merged by `mergeObservations` — ledger last, so a by-hand reload written in the same
 * instant as a failure wins the tie.
 *
 * @param home the Slopweaver home
 * @param sessionIds every id the calling session goes by
 * @param projectsDir where Claude Code keeps transcripts
 * @returns the observations, or why one source could not be read
 */
export function sessionLoadObservations({
  home,
  sessionIds,
  projectsDir,
}: {
  home: string;
  sessionIds: readonly string[];
  projectsDir: string;
}): Result<readonly ProfileLoadObservation[]> {
  const transcript: ProfileLoadObservation[] = [];
  for (const sessionId of sessionIds) {
    const path = findTranscript({ projectsDir, sessionId });
    if (path.isErr()) {
      // Not found is an absence of evidence — a Codex session or a fixture id has no Claude transcript. Any other
      // failure is a transcript that is there and unread, which a verdict may not be built over.
      if (path.error.code === "SESSION_NOT_FOUND") {
        continue;
      }
      return err([path.error.message]);
    }
    const read = transcriptProfileObservations({ fileSessionId: sessionId, path: path.value });
    if (read.isErr()) {
      return err(read.error);
    }
    transcript.push(...read.value);
  }
  const ledger = readProfileLoads({ home });
  if (ledger.isErr()) {
    return err(ledger.error);
  }
  return ok(
    mergeObservations({
      ledger: ledger.value.rows
        .filter((row) => sessionIds.includes(row.sessionId))
        .map((row) => observationOfRow({ row })),
      transcript,
    }),
  );
}
