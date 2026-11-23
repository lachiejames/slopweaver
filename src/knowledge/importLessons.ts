/**
 * Projecting one line of the old append-only register into one memory recording, and deciding what a
 * re-run of the import over a file that has GROWN may write. Pure: no I/O, no clock.
 *
 * Every row in `$SLOPWEAVER_HOME/knowledge/lessons.jsonl` predates the memories table, so two of that
 * table's columns have no source: `behaviourChange` and `retrievalCue`. They import as NULL, and so does
 * `learner` for every row but one the OWNER holds — see the `learner` line below for why `fleet` is not a value.
 *
 * **That is the whole design decision in this file.** Filling them in — attributing every row to the
 * importing session, deriving a learner from a run slug, or writing "unknown" as a string — would turn an
 * absence into a fabricated fact, in a register whose only value is that what it says was actually
 * observed. A NULL reads as "imported, and nobody knows", which is true, and `importKey` says exactly which
 * rows those are without a second query.
 *
 * ## The import key is the LINE, not the file — and that is what makes a second apply safe
 *
 * {@link importKeyFor} is the SHA-256 of one physical line's bytes plus its 1-based line number, ZERO-PADDED
 * so the keys sort in source order as text. In an append-only file a line's position and bytes never move,
 * so its key is stable across every later append: a file that has grown since the last apply produces the
 * SAME keys for the lines already imported and NEW keys only for the lines appended after them.
 *
 * The version this replaces keyed on the digest of the WHOLE file. That made the same file re-apply as a
 * no-op, which is the easy half — and made a file with one line appended produce a fresh key for every
 * line, so a second apply would have written the entire register a second time. The cutover to the table
 * is exactly the situation where that happens: `knowledge record` moved to the table on `main`, and
 * a worktree still on an older commit keeps appending to the file until it rebases. {@link appendPlan} is
 * how those stragglers reach the table without a duplicate: the keys already present — or retired by a
 * `knowledge prune`, whose archive keeps them — must be a PREFIX of the file, and only the lines after that
 * prefix are written. A present key AFTER an absent one is a hole —
 * a line was edited or removed, which an append-only file never does — and the apply is refused rather than
 * guessed at. Two identical lines in one file still import as two recordings, because their line numbers
 * differ, and the old register is append-only so a duplicated line IS two recordings.
 *
 * The padding is load-bearing rather than cosmetic: `../knowledge/memoryStore.ts` breaks a same-instant
 * tie between two recordings of one claim by `seq`, and within one import transaction `seq` ascends with
 * the source line, so `:0000000010` must follow `:0000000009` — an unpadded key
 * would order an older `confirmed` over a newer `refuted`.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../lib/result.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { lessonRecording } from "./lessonRecording.js";
import type { MemoryRecording } from "./memory.js";
import { parseLessonLine } from "./row.js";
import { LESSON_CLAIM_MAX, type LessonRow } from "./types.js";

/**
 * How many digits a padded line number keeps.
 *
 * Ten holds a register of 9,999,999,999 lines. The live one is in the hundreds, so this is not a bound
 * anybody will reach — it is a width chosen so the text sort never has to be re-reasoned about.
 */
const IMPORT_LINE_DIGITS = 10;

/**
 * The import key for one physical line of the source file.
 *
 * @param line the line's exact text, hashed so an edited line stops matching its old key
 * @param lineNumber the 1-based physical line number
 * @returns a key unique to that line at that position, zero-padded so keys sort in source order
 */
export function importKeyFor({ line, lineNumber }: { line: string; lineNumber: number }): string {
  const digest = createHash("sha256").update(line).digest("hex");
  return `${digest}:${String(lineNumber).padStart(IMPORT_LINE_DIGITS, "0")}`;
}

/**
 * Project one decoded lesson into the recording an insert takes.
 *
 * Validated again rather than trusted: `./row.ts`'s `parseLessonLine` checks scalar TYPES on the way in but
 * does not re-run the builder's length and emptiness checks, so a line written before those bounds existed
 * could decode and then violate a NOT NULL. A row that fails here is reported by line and aborts the apply.
 *
 * @param lesson the decoded row
 * @param line the line's exact text, for the import key
 * @param lineNumber its physical line in the source file, carried into the import key and any failure
 * @param recordingId the uuid for this physical recording, passed in so this stays pure
 * @returns the recording, or the reason this line cannot be imported
 */
export function projectLesson({
  lesson,
  line,
  lineNumber,
  recordingId,
}: {
  lesson: LessonRow;
  line: string;
  lineNumber: number;
  recordingId: string;
}): Result<ImportRow, KnowledgeError> {
  const claim = lesson.claim.trim();
  if (claim.length === 0 || claim.length > LESSON_CLAIM_MAX) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  if (lesson.evidence.trim().length === 0 || lesson.run.trim().length === 0) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  if (Number.isNaN(new Date(lesson.recordedAtIso).getTime())) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  return ok({
    ...lessonRecording({
      importKey: null,
      // Only the OWNER's rows carry an attribution worth importing. `fleet` is what an ABSENT `learner` means
      // (`./types.ts`'s `LESSON_LEARNER_DEFAULT`), so a parsed `fleet` cannot be told apart from a row written
      // before the field existed and importing it as a value would attribute hundreds of rows to a learner
      // nobody typed. `owner` is only ever explicit, so it is the one value that survives.
      learner: lesson.learner === "owner" ? "owner" : null,
      lesson,
      recordingId,
    }),
    importKey: importKeyFor({ line, lineNumber }),
  });
}

/** A projected import row, whose key is never null — the projection always derives one. */
export type ImportRow = MemoryRecording & { readonly importKey: string };

/** What a second apply over the same file may do. */
export type AppendPlan =
  /** Every accounted key sits before every absent one: write the absent rows. */
  | { readonly kind: "append"; readonly rows: readonly ImportRow[]; readonly present: number; readonly pruned: number }
  /** Every key is present or was retired by a prune. Nothing to write. */
  | { readonly kind: "already-applied"; readonly present: number; readonly pruned: number }
  /** An accounted key follows an absent one, so the file is not the append-only register that was imported. */
  | { readonly kind: "hole"; readonly firstAbsentKey: string; readonly presentAfterIt: number };

/**
 * Decide what an apply over a file some of whose lines are already in the table may write.
 *
 * A line is ACCOUNTED when the table holds its key or a `knowledge prune` archive does
 * (`./prunedImportKeys.ts`): a pruned line was imported once and then deliberately retired, so it sits in
 * the imported prefix exactly as a present one does, and it is never written back. The accounted keys must
 * still be a prefix of the file — an accounted key after an absent one is a hole.
 *
 * @param rows every projected recording, in source order, each carrying its `importKey`
 * @param present the import keys the table already holds
 * @param pruned the import keys a prune archive holds — retired, never re-imported
 * @returns the rows to append, that there are none, or the hole that refuses the apply
 */
export function appendPlan({
  rows,
  present,
  pruned,
}: {
  rows: readonly ImportRow[];
  present: ReadonlySet<string>;
  pruned: ReadonlySet<string>;
}): AppendPlan {
  const accounted = (row: ImportRow): boolean => present.has(row.importKey) || pruned.has(row.importKey);
  const firstAbsent = rows.findIndex((row) => !accounted(row));
  const prefix = firstAbsent === -1 ? rows : rows.slice(0, firstAbsent);
  // A row restored from an archive is in both; it is present, and counting it as pruned too would misreport.
  const prunedCount = prefix.filter((row) => pruned.has(row.importKey) && !present.has(row.importKey)).length;
  if (firstAbsent === -1) {
    return { kind: "already-applied", present: rows.length - prunedCount, pruned: prunedCount };
  }
  const after = rows.slice(firstAbsent);
  const presentAfterIt = after.filter(accounted).length;
  if (presentAfterIt > 0) {
    return { firstAbsentKey: after[0]!.importKey, kind: "hole", presentAfterIt };
  }
  return { kind: "append", present: firstAbsent - prunedCount, pruned: prunedCount, rows: after };
}

/**
 * One row's key, as the table holds it and as this scheme would derive it.
 *
 * @internal — the shape {@link RekeyPlan} carries. Exported so a reader can name it, not because a second
 * module builds one.
 */
export interface Rekey {
  /** The recording to update. */
  readonly recordingId: string;
  /** The key the table holds today. */
  readonly from: string;
  /** The key the per-line scheme derives for the line that key names. */
  readonly to: string;
}

/** What a rekey over the source file may do. */
export type RekeyPlan =
  /** Every stored key already matches the per-line scheme. Nothing to write. */
  | { readonly kind: "current"; readonly rows: number }
  /** These rows may be rewritten; every one was verified against the line it names. */
  | { readonly kind: "rekey"; readonly rekeys: readonly Rekey[] }
  /** One row does not match the line its key names, so the file is not the one it was imported from. */
  | { readonly kind: "mismatch"; readonly recordingId: string; readonly lineNumber: number; readonly why: string };

/**
 * Plan a rewrite of stored import keys onto the per-line scheme, verifying every row against its own line.
 *
 * The import key used to be the WHOLE file's digest plus a line number, which a single append invalidated
 * for every row — so a table imported under it can never be added to incrementally, and the next apply
 * duplicates the entire register. The line NUMBER survives in the old key, and the file is append-only, so
 * the row's own line is recoverable and its new key derivable.
 *
 * **It is verified rather than assumed.** Each row's stored claim must equal the claim on the line its key
 * names; one mismatch aborts the whole plan, because a file whose lines have moved is not the file those
 * rows came from and rekeying against it would attach a row to somebody else's line.
 *
 * @param stored every row the table holds that carries an import key, with its claim
 * @param lines every physical line of the source file, in order
 * @returns nothing to do, the verified rewrites, or the first row that does not match its line
 */
export function rekeyPlan({
  stored,
  lines,
}: {
  stored: readonly { readonly recordingId: string; readonly importKey: string; readonly claim: string }[];
  lines: readonly string[];
}): RekeyPlan {
  const rekeys: Rekey[] = [];
  for (const row of stored) {
    const lineNumber = Number(row.importKey.split(":")[1]);
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) {
      return {
        kind: "mismatch",
        lineNumber,
        recordingId: row.recordingId,
        why: "its key names a line the source file does not have",
      };
    }
    const line = lines[lineNumber - 1]!;
    const decoded = parseLessonLine({ line, lineNumber });
    if (decoded.isErr()) {
      return { kind: "mismatch", lineNumber, recordingId: row.recordingId, why: decoded.error.message };
    }
    if (decoded.value.claim.trim() !== row.claim) {
      return {
        kind: "mismatch",
        lineNumber,
        recordingId: row.recordingId,
        why: "the claim on that line is not the claim this row holds",
      };
    }
    const to = importKeyFor({ line, lineNumber });
    if (to !== row.importKey) {
      rekeys.push({ from: row.importKey, recordingId: row.recordingId, to });
    }
  }
  return rekeys.length === 0 ? { kind: "current", rows: stored.length } : { kind: "rekey", rekeys };
}
