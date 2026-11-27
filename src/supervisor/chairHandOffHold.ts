/**
 * The owner's standing hold on automatic chair hand-off: `$SLOPWEAVER_HOME/supervisor/hand-offs/holds.jsonl`, one
 * line per `supervisor hand-off hold` or `release`, each carrying the owner's reason and its instant.
 *
 * Append-only JSONL rather than one rewritten document, so a hold and a release racing each other both land and the
 * file says which came last; the LATEST line decides. Growth is bounded by how often the owner changes their mind.
 *
 * A malformed line is a typed error, never skipped: skipping it could drop the one `hold` line in the file and
 * read the chair as unheld, which is the direction that hands off against the owner's word. The control plane's
 * watch (`./chairWatch.ts`) reads it through {@link readChairHandOffHold}; the hold and release verbs write it
 * through {@link recordChairHandOffHold} (`../cli/commands/supervisor/chairHandOffHoldRun.ts`).
 *
 * Messages name the journal, never its absolute path: a watch report is printed and journalled, and names no store
 * path (`./chairWatch.ts`). The path rides on the error's own `path` field for a caller that needs it.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import { appendLines } from "#lib/appendSeparator.js";
import { parseIsoMs } from "#lib/date.js";
import type { IngestError } from "#lib/ingestError.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { type ChairWatchHold, withoutAddresses } from "./chairWatch.js";

/** Owner-only permissions, matching the rest of `$SLOPWEAVER_HOME/supervisor`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Which way one line moved the hold. */
export type ChairHandOffHoldKind = "hold" | "release";

/** One journal line. */
export interface ChairHandOffHoldLine {
  readonly kind: ChairHandOffHoldKind;
  readonly reason: string;
  readonly atIso: string;
}

/** A line in the journal that is not a hold or release line. */
export interface HoldLineMalformedError {
  readonly code: "HOLD_LINE_MALFORMED";
  readonly message: string;
  readonly path: string;
  /** 1-based, as an editor counts it. */
  readonly lineNumber: number;
}

/** The journal exists and could not be read. */
export interface HoldUnreadableError {
  readonly code: "HOLD_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A line could not be appended. */
export interface HoldWriteFailedError {
  readonly code: "HOLD_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** A hold or release named no reason. */
export interface HoldReasonEmptyError {
  readonly code: "HOLD_REASON_EMPTY";
  readonly message: string;
}

/** Every failure of the hold journal. */
export type ChairHandOffHoldError =
  HoldLineMalformedError | HoldUnreadableError | HoldWriteFailedError | HoldReasonEmptyError;

/** The factories every {@link ChairHandOffHoldError} is built through. */
export const ChairHandOffHoldErrors = {
  lineMalformed: ({
    lineNumber,
    path,
    why,
  }: {
    lineNumber: number;
    path: string;
    why: string;
  }): HoldLineMalformedError => ({
    code: "HOLD_LINE_MALFORMED",
    lineNumber,
    message: `the hand-off hold journal's line ${String(lineNumber)} is not a hold or release line: ${why}`,
    path,
  }),
  reasonEmpty: (): HoldReasonEmptyError => ({
    code: "HOLD_REASON_EMPTY",
    message: 'a hold or release carries the owner\'s reason: pass --reason "<why>"',
  }),
  unreadable: ({ path, why }: { path: string; why: string }): HoldUnreadableError => ({
    code: "HOLD_UNREADABLE",
    message: `the hand-off hold journal could not be read: ${why}`,
    path,
  }),
  writeFailed: ({ path, why }: { path: string; why: string }): HoldWriteFailedError => ({
    code: "HOLD_WRITE_FAILED",
    message: `the hand-off hold journal was not written: ${why}`,
    path,
  }),
} as const;

/** One line, as the journal spells it. */
const HOLD_LINE = z.strictObject({
  atIso: z.string().refine((value) => parseIsoMs({ tsIso: value }) !== undefined, "atIso is not an ISO instant"),
  kind: z.enum(["hold", "release"]),
  reason: z.string().refine((value) => value.trim().length > 0, "reason is blank"),
});

/**
 * A filesystem failure as its errno, never its message, which names the absolute path.
 *
 * @param error the boundary's typed error
 * @returns the errno when the failure carried one, else the boundary's own kind
 */
function failureCode({ error }: { error: IngestError }): string {
  if (error.code === undefined) {
    return error.kind;
  }
  return error.code;
}

/**
 * Where the hold journal lives.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the journal's absolute path
 */
export function chairHandOffHoldPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).supervisorHandOffHoldsJsonl;
}

/**
 * Decode one journal line.
 *
 * @param line the raw text
 * @param lineNumber its 1-based position, named in a refusal
 * @param path the journal, carried on the error
 * @returns the line, or why it is not one
 */
function parseChairHandOffHoldLine({
  line,
  lineNumber,
  path,
}: {
  line: string;
  lineNumber: number;
  path: string;
}): Result<ChairHandOffHoldLine, ChairHandOffHoldError> {
  let document: unknown;
  try {
    document = JSON.parse(line);
  } catch {
    return err(ChairHandOffHoldErrors.lineMalformed({ lineNumber, path, why: "it is not JSON" }));
  }
  const parsed = HOLD_LINE.safeParse(document);
  if (!parsed.success) {
    return err(ChairHandOffHoldErrors.lineMalformed({ lineNumber, path, why: parsed.error.issues[0]!.message }));
  }
  return ok(parsed.data);
}

/**
 * The hold the journal's lines leave in force: the latest line decides, a release clears it.
 *
 * @param lines every line, in file order
 * @returns the hold in force, or `undefined` when none is
 */
function holdInForce({ lines }: { lines: readonly ChairHandOffHoldLine[] }): ChairWatchHold | undefined {
  const latest = lines.at(-1);
  if (latest === undefined || latest.kind === "release") {
    return undefined;
  }
  return { reason: latest.reason, sinceIso: latest.atIso };
}

/**
 * Every line on record. A journal that is not there yet holds none: nothing was ever held on this install.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the lines in file order, or the first malformed line, or why the file could not be read
 */
function readChairHandOffHoldLines({
  home,
}: {
  home: string;
}): Result<readonly ChairHandOffHoldLine[], ChairHandOffHoldError> {
  const path = chairHandOffHoldPath({ home });
  if (!existsSync(path)) {
    return ok([]);
  }
  const raw: { line: string; lineNumber: number }[] = [];
  const read = safeFs({
    execute: () => {
      readJsonlLines({
        noFollow: true,
        onLine: ({ line, index }) => {
          if (line.trim().length > 0) {
            raw.push({ line, lineNumber: index + 1 });
          }
        },
        path,
      });
    },
    operation: "readChairHandOffHoldLines",
    path,
  });
  if (read.isErr()) {
    return err(ChairHandOffHoldErrors.unreadable({ path, why: failureCode({ error: read.error }) }));
  }
  const lines: ChairHandOffHoldLine[] = [];
  for (const one of raw) {
    const parsed = parseChairHandOffHoldLine({ line: one.line, lineNumber: one.lineNumber, path });
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    lines.push(parsed.value);
  }
  return ok(lines);
}

/**
 * The owner's hold in force, read off the journal.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the hold, `undefined` when none is in force, or why the journal could not say
 */
export function readChairHandOffHold({
  home,
}: {
  home: string;
}): Result<ChairWatchHold | undefined, ChairHandOffHoldError> {
  return readChairHandOffHoldLines({ home }).map((lines) => holdInForce({ lines }));
}

/**
 * Append one hold or release line.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param kind whether this holds automatic hand-off or releases it
 * @param reason the owner's reason, required and never blank
 * @param nowIso the instant it was recorded
 * @returns the line written, or why it was not
 */
export function recordChairHandOffHold({
  home,
  kind,
  nowIso,
  reason,
}: {
  home: string;
  kind: ChairHandOffHoldKind;
  nowIso: string;
  reason: string;
}): Result<ChairHandOffHoldLine, ChairHandOffHoldError> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return err(ChairHandOffHoldErrors.reasonEmpty());
  }
  const path = chairHandOffHoldPath({ home });
  // The owner's own words, but scrubbed all the same: this journal is a hand-off journal and names no address.
  const line: ChairHandOffHoldLine = { atIso: nowIso, kind, reason: withoutAddresses({ text: trimmed }) };
  const written = safeFs({
    execute: () => {
      mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
      appendLines({ mode: FILE_MODE, noFollow: true, path, text: `${JSON.stringify(line)}\n` });
    },
    operation: "recordChairHandOffHold",
    path,
  });
  if (written.isErr()) {
    return err(ChairHandOffHoldErrors.writeFailed({ path, why: failureCode({ error: written.error }) }));
  }
  return ok(line);
}
