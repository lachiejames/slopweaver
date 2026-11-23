/**
 * `slopweaver knowledge export` — write every recording back out as one `.jsonl`.
 *
 * ## Why this verb exists at all, stated plainly
 *
 * Every other table in this store holds content a provider can be asked for again. A memory cannot: it is
 * a paid-for observation, and the investigation that produced it is not repeatable at will. The backup leg
 * (`slopweaver store backup`, `docs/store/backup.md`) carries the `memories` table inside its encrypted store
 * dump, into directories the install names — a folder on this machine, a pinned external drive — and a cloud address
 * is refused as not built.
 *
 * This is not the backup leg. It is the readable recovery copy beside it: one command, one file, and nothing
 * else needed to read it back, where restoring the dump needs the backup key and a running store.
 *
 * Written a row at a time through `writeFileAtomicStream`, never assembled into one string:
 * `.claude/rules/typescript-patterns.md` refuses a whole-payload JSON write whose size comes from data, and
 * this register grows for as long as the installation runs.
 */
import { exportedMemoryLine, exportedRecallLine } from "../../../knowledge/exportLines.js";
import { readAllMemories, readAllRecalls } from "../../../knowledge/memoryStore.js";
import { logger } from "../../../lib/logger.js";
import { writeFileAtomicStream } from "../../../lib/writeAtomic.js";
import { connectStore } from "../../../store/client.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";
import type { MemoryRecallRow } from "../../../store/schema/memoryRecalls.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { VERB_ARG_OFFSET } from "./core.js";
import { EXPORT_USAGE, parseKnowledgeExportArgs } from "./registerArgs.js";

/** Owner-only, matching the register file this replaces — a memory's evidence can quote a private channel. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Write every recording, a row at a time.
 *
 * @param out where to write
 * @param rows every recording the table holds, or the subset a prune archives
 */
export function writeRows({ out, rows }: { out: string; rows: readonly MemoryRecordingRow[] }): void {
  writeFileAtomicStream({
    dirMode: DIR_MODE,
    // Exact, not umask-masked: a restrictive umask would otherwise leave an export or redaction archive at 0000.
    exactMode: true,
    fileMode: FILE_MODE,
    path: out,
    produce: ({ write }) => {
      rows.forEach((row) => {
        write({ text: `${exportedMemoryLine({ row })}\n` });
      });
    },
  });
}

/**
 * Where the recall ledger is written, given where the register went.
 *
 * A SIBLING file rather than extra lines in the same one: the register's format is one recording per line
 * and a reader that had to discriminate two row shapes would be a new parser for every existing consumer.
 * The name is derived rather than asked for, so the pair cannot be separated by a caller's typo.
 *
 * @param out where the register was written
 * @returns the path beside it
 */
export function recallsFileFor({ out }: { out: string }): string {
  return `${out}.recalls.jsonl`;
}

/**
 * Write the recall ledger beside the register, a row at a time.
 *
 * @param out where to write
 * @param rows the recalls to write
 */
export function writeRecalls({ out, rows }: { out: string; rows: readonly MemoryRecallRow[] }): void {
  writeFileAtomicStream({
    dirMode: DIR_MODE,
    exactMode: true,
    fileMode: FILE_MODE,
    path: out,
    produce: ({ write }) => {
      rows.forEach((row) => {
        write({ text: `${exportedRecallLine({ row })}\n` });
      });
    },
  });
}

/**
 * Run `knowledge export`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeExport(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: EXPORT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeExportArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: EXPORT_USAGE });
    return EXIT_USAGE;
  }
  const out = parsed.value.values["out"];
  if (typeof out !== "string" || out.length === 0) {
    logger.error({ msg: "knowledge export: --out <path> is required" });
    logger.error({ msg: EXPORT_USAGE });
    return EXIT_USAGE;
  }
  const opened = await connectStore();
  if (opened.isErr()) {
    logger.error({ msg: `knowledge export: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const rows = await readAllMemories({ client });
    if (rows.isErr()) {
      logger.error({ msg: `knowledge export: ${rows.error.message}` });
      return EXIT_ERROR;
    }
    writeRows({ out, rows: rows.value });
    logger.out({ line: `knowledge export: ${String(rows.value.length)} recording(s) → ${out}` });
    const recalls = await readAllRecalls({ client });
    if (recalls.isErr()) {
      logger.error({ msg: `knowledge export: ${recalls.error.message}` });
      return EXIT_ERROR;
    }
    const recallsOut = recallsFileFor({ out });
    writeRecalls({ out: recallsOut, rows: recalls.value });
    logger.out({ line: `knowledge export: ${String(recalls.value.length)} recall(s) → ${recallsOut}` });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const knowledgeExportCommand = defineCommand({ run: runKnowledgeExport });
