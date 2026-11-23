/**
 * `slopweaver knowledge import-lessons` — bring the append-only register into the memories table.
 *
 * Explicitly migration TOOLING, not a runtime compatibility reader: it takes the source path as an
 * argument rather than resolving it from the state home, so nothing in the shipped read or write paths
 * keeps a reference to a file that has stopped being authoritative. `knowledge record` writes the table,
 * so that file is HISTORY — and this verb is the one way back out of it,
 * which is what "keep the old register recoverable" means in practice.
 *
 * ## Four properties, and each is a refusal rather than a hope
 *
 * **The source is read once and hashed once.** The digest is recomputed after the rows are projected and
 * before anything is written; a digest that moved aborts, because a file that grew mid-import would
 * produce a report for rows this process never saw. Hashing alone cannot stop a writer appending — freeze
 * the writers for the real cut — but it can stop the import claiming completeness it does not have.
 *
 * **A file that has GROWN since the last apply imports only what is new.** The import key is per LINE
 * (`../../../knowledge/importLessons.ts`), so the lines already applied keep their keys and `appendPlan`
 * writes only the ones after them. That is the cutover case rather than a hypothetical: a worktree on an
 * older commit keeps appending to the file until it rebases onto the verb that stopped. A line a `knowledge
 * prune` retired is in its archive rather than the table, and counts as applied: re-importing it would
 * resurrect a claim the owner retired (`../../../knowledge/prunedImportKeys.ts`).
 *
 * **A malformed line aborts the apply and is named.** It is never counted as migrated and never skipped
 * quietly: every source line is a paid-for observation, and a silently dropped one is unrecoverable.
 *
 * **`--dry-run` writes nothing at all.** Not a row, not a journal entry. It is the preview a human reads
 * before the only cut that matters.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";

import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { appendPlan, type ImportRow, projectLesson, rekeyPlan } from "../../../knowledge/importLessons.js";
import { readImportedKeys, rekeyImports } from "../../../knowledge/memoryRewriteStore.js";
import { existingImportKeys, importMemories } from "../../../knowledge/memoryStore.js";
import { readPrunedImportKeys } from "../../../knowledge/prunedImportKeys.js";
import { parseLessonLine } from "../../../knowledge/row.js";
import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { VERB_ARG_OFFSET } from "./core.js";
import { IMPORT_USAGE, parseKnowledgeImportArgs } from "./registerArgs.js";

/** The source file's SHA-256, streamed rather than read whole — its size is a property of the data. */
async function digestOf({ path }: { path: string }): Promise<string> {
  const hash = createHash("sha256");
  // No `encoding` option at all, which is what keeps the stream in binary mode: the digest is then over the
  // file's BYTES, where a text-mode read would hash a decoded string. `hash.update` takes the chunk as the
  // `BinaryLike` it already is, so nothing is asserted about its type.
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/**
 * Every projected row, or the line number of the first one that could not be projected.
 *
 * A whitespace-only physical line carries no lesson, so it becomes no recording — but the count of them is
 * REPORTED rather than dropped quietly. A reader who compares the projected count against `wc -l` would
 * otherwise see a gap with no explanation, and a blank line in the middle of an append-only register is
 * itself worth knowing about. The import key is the line NUMBER, so skipping one shifts no other key.
 */
function projectFile({
  path,
}: {
  path: string;
}):
  | { readonly rows: readonly ImportRow[]; readonly blank: readonly number[]; readonly failure?: undefined }
  | { readonly rows?: undefined; readonly blank?: undefined; readonly failure: string } {
  const rows: ImportRow[] = [];
  const blank: number[] = [];
  let failure: string | undefined;
  readJsonlLines({
    onLine: ({ line, index }) => {
      if (failure !== undefined) {
        return;
      }
      if (line.trim().length === 0) {
        blank.push(index + 1);
        return;
      }
      const lineNumber = index + 1;
      const decoded = parseLessonLine({ line, lineNumber });
      if (decoded.isErr()) {
        failure = decoded.error.message;
        return;
      }
      const projected = projectLesson({ lesson: decoded.value, line, lineNumber, recordingId: randomUUID() });
      if (projected.isErr()) {
        failure = projected.error.message;
        return;
      }
      rows.push(projected.value);
    },
    path,
  });
  return failure === undefined ? { blank, rows } : { failure };
}

/**
 * The clause naming the lines a prune retired, or nothing when there were none.
 *
 * @param pruned how many of the file's lines a prune archive holds
 * @returns the clause, with its leading separator, or the empty string
 */
function prunedClause({ pruned }: { pruned: number }): string {
  if (pruned === 0) {
    return "";
  }
  return `, ${String(pruned)} retired by a knowledge prune (archived under knowledge/pruned, never re-imported)`;
}

/** The three ways this verb may be asked to run, exactly one of which a caller picks. */
const IMPORT_MODES: readonly string[] = ["apply", "dry-run", "rekey"];

/** How many blank-line numbers to name before summarising the rest. */
const BLANK_LINES_NAMED = 10;

/**
 * Run `knowledge import-lessons`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeImportLessons(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: IMPORT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeImportArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: IMPORT_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const file = values["file"];
  const home = typeof values["home"] === "string" ? values["home"] : undefined;
  const modes = IMPORT_MODES.filter((mode) => values[mode] === true);
  const mode = modes[0];
  if (typeof file !== "string" || file.length === 0 || mode === undefined || modes.length !== 1) {
    logger.error({
      msg: "knowledge import-lessons: --file and exactly one of --dry-run, --apply or --rekey are required",
    });
    logger.error({ msg: IMPORT_USAGE });
    return EXIT_USAGE;
  }
  if (mode === "rekey") {
    return rekeyRows({ file, home });
  }
  const dryRun = mode === "dry-run";
  const sourceDigest = await digestOf({ path: file });
  const projected = projectFile({ path: file });
  if (projected.rows === undefined) {
    logger.error({ msg: `knowledge import-lessons: ${projected.failure} — nothing was written` });
    return EXIT_ERROR;
  }
  const rows = projected.rows;
  const after = await digestOf({ path: file });
  if (after !== sourceDigest) {
    logger.error({
      msg: `knowledge import-lessons: ${file} changed while it was being read (${sourceDigest} → ${after}) — nothing was written`,
    });
    return EXIT_ERROR;
  }
  logger.out({ line: `knowledge import-lessons: ${String(rows.length)} row(s) projected from ${file}` });
  logger.out({ line: `  source sha256: ${sourceDigest}` });
  logger.out({ line: `  distinct claims: ${String(new Set(rows.map((row) => row.id)).size)}` });
  reportBlankLines({ blank: projected.blank });
  if (dryRun) {
    logger.out({ line: "  --dry-run: nothing was written, and no connection was opened" });
    return EXIT_OK;
  }
  return applyRows({ home, rows });
}

/**
 * Say which physical lines carried nothing, so the projected count is never an unexplained number.
 *
 * @param blank the 1-based line numbers that were whitespace-only
 */
function reportBlankLines({ blank }: { blank: readonly number[] }): void {
  if (blank.length === 0) {
    return;
  }
  const named = blank.slice(0, BLANK_LINES_NAMED).join(", ");
  const rest = blank.length > BLANK_LINES_NAMED ? ` and ${String(blank.length - BLANK_LINES_NAMED)} more` : "";
  logger.out({
    line:
      `  blank lines carrying no lesson, imported as nothing: ${String(blank.length)} — line(s) ${named}${rest}. ` +
      "Import keys are line NUMBERS, so no other key shifted",
  });
}

/**
 * Open a connection and write whatever the plan says is new, once every pure check has passed.
 *
 * Split from the runner so the preview path never touches a connection at all, and so the three ways an
 * apply can end read as one list rather than as branches inside a long procedure.
 *
 * @param rows every projected recording, in source order
 * @param home the state home whose remembered store selection is used
 * @returns the process exit code
 */
async function applyRows({ rows, home }: { rows: readonly ImportRow[]; home: string | undefined }): Promise<number> {
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    logger.error({ msg: `knowledge import-lessons: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const present = await existingImportKeys({ client, keys: rows.map((row) => row.importKey) });
    if (present.isErr()) {
      logger.error({ msg: `knowledge import-lessons: ${present.error.message}` });
      return EXIT_ERROR;
    }
    const pruned = readPrunedImportKeys({ home });
    if (pruned.isErr()) {
      logger.error({ msg: `knowledge import-lessons: ${pruned.error.message} — nothing was written` });
      return EXIT_ERROR;
    }
    const plan = appendPlan({ present: present.value, pruned: pruned.value, rows });
    if (plan.kind === "already-applied") {
      logger.out({
        line: `  already applied: ${String(plan.present)} row(s) present${prunedClause({ pruned: plan.pruned })}. No-op.`,
      });
      return EXIT_OK;
    }
    if (plan.kind === "hole") {
      logger.error({
        msg:
          `knowledge import-lessons: the table or a prune archive holds ${String(plan.presentAfterIt)} row(s) ` +
          `from AFTER ${plan.firstAbsentKey}, which neither holds — so this file is not the append-only register ` +
          "that was imported, and a line has been edited or removed. Reconcile before applying again; nothing was written",
      });
      return EXIT_ERROR;
    }
    const written = await importMemories({ client, rows: plan.rows });
    if (written.isErr()) {
      logger.error({ msg: `knowledge import-lessons: ${written.error.message}` });
      return EXIT_ERROR;
    }
    const alreadyThere =
      plan.present + plan.pruned > 0
        ? `, after ${String(plan.present)} already present${prunedClause({ pruned: plan.pruned })}`
        : "";
    logger.out({ line: `  applied: ${String(written.value)} recording(s) in one transaction${alreadyThere}` });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const knowledgeImportLessonsCommand = defineCommand({ run: runKnowledgeImportLessons });

/**
 * Rewrite the table's stored import keys onto the per-line scheme, verified line by line.
 *
 * The table this is for was imported under the older key — the WHOLE file's digest plus a line number —
 * which one appended line invalidated for every row. Left alone, the next `--apply` matches nothing and
 * writes the entire register a second time, and a duplicated claim id is the owner's consolidation signal,
 * so the damage is a register that lies about what two runs learned independently rather than wasted rows.
 *
 * Nothing is written unless every row matched the line its own key names. `rekeyPlan` carries why.
 *
 * @param file the source file the stored rows were imported from
 * @param home the state home whose remembered store selection is used
 * @returns the process exit code
 */
async function rekeyRows({ file, home }: { file: string; home: string | undefined }): Promise<number> {
  const lines = readFileSync(file, "utf8").split("\n");
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    logger.error({ msg: `knowledge import-lessons: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const stored = await readImportedKeys({ client });
    if (stored.isErr()) {
      logger.error({ msg: `knowledge import-lessons: ${stored.error.message}` });
      return EXIT_ERROR;
    }
    const plan = rekeyPlan({ lines, stored: stored.value });
    if (plan.kind === "current") {
      logger.out({ line: `  already on the per-line scheme: all ${String(plan.rows)} imported row(s). No-op.` });
      return EXIT_OK;
    }
    if (plan.kind === "mismatch") {
      logger.error({
        msg:
          `knowledge import-lessons: recording ${plan.recordingId} claims line ${String(plan.lineNumber)} of ` +
          `${file}, but ${plan.why} — so this is not the file those rows came from. Nothing was written`,
      });
      return EXIT_ERROR;
    }
    const written = await rekeyImports({ client, rekeys: plan.rekeys });
    if (written.isErr()) {
      logger.error({ msg: `knowledge import-lessons: ${written.error.message}` });
      return EXIT_ERROR;
    }
    logger.out({ line: `  rekeyed ${String(written.value)} recording(s), each verified against its own line` });
    logger.out({ line: "  a later --apply over this file now writes only the lines appended since" });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}
