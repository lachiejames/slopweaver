/**
 * `slopweaver knowledge redaction-scan` and `slopweaver knowledge redact` — the codebase's redaction tooling,
 * run over the knowledge register as an opt-in. The plan is `../../../knowledge/redaction.ts`'s, the locked
 * in-place rewrite `../../../knowledge/redactionStore.ts`'s; this file is the shell.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { readAllMemories, readAllRecalls } from "../../../knowledge/memoryStore.js";
import { planKnowledgeRedaction } from "../../../knowledge/redaction.js";
import { applyStoredKnowledgeRedaction, scanStoredKnowledge } from "../../../knowledge/redactionStore.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { connectStore, type StoreClient } from "../../../store/client.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";
import type { MemoryRecallRow } from "../../../store/schema/memoryRecalls.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { VERB_ARG_OFFSET } from "./core.js";
import { recallsFileFor, writeRecalls, writeRows } from "./exportMemories.js";
import {
  knowledgeRedactionArchivePath,
  parseKnowledgeRedactArgs,
  parseKnowledgeRedactionScanArgs,
  REDACT_USAGE,
  REDACTION_SCAN_USAGE,
  redactLines,
  scanLines,
} from "./redactCore.js";
import { type KnowledgeRedactionInputs, openRedactionInputs } from "./redactionContext.js";

/** The flags both verbs share, read off a parse. */
function sharedFlags({ values }: { values: Readonly<Record<string, unknown>> }): {
  home: string | undefined;
  json: boolean;
} {
  const home = values["home"];
  return { home: typeof home === "string" ? home : undefined, json: values["json"] === true };
}

/**
 * Run `knowledge redaction-scan`.
 *
 * @param argv the full process argv
 * @returns 0 when no stored row carries a forbidden identifier, 1 when any does or the read failed
 */
export async function runKnowledgeRedactionScan(argv: readonly string[]): Promise<number> {
  const verb = "knowledge redaction-scan";
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REDACTION_SCAN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeRedactionScanArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: REDACTION_SCAN_USAGE });
    return EXIT_USAGE;
  }
  const { home, json } = sharedFlags({ values: parsed.value.values });
  const inputs = openRedactionInputs({ home, verb });
  if (inputs.isErr()) {
    logger.error({ msg: inputs.error });
    return EXIT_ERROR;
  }
  const opened = await connectStore({ home: inputs.value.home });
  if (opened.isErr()) {
    logger.error({ msg: `${verb}: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const scan = await scanStoredKnowledge({ client, scanner: inputs.value.scanner });
    if (scan.isErr()) {
      logger.error({ msg: `${verb}: ${scan.error.message}` });
      return EXIT_ERROR;
    }
    if (json) {
      logger.out({ line: JSON.stringify(scan.value) });
    } else {
      scanLines({ scan: scan.value, verb }).forEach((line) => {
        logger.out({ line });
      });
    }
    return scan.value.rowsWithReferences === 0 ? EXIT_OK : EXIT_ERROR;
  } finally {
    await client.close();
  }
}

/**
 * Run `knowledge redact`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeRedact(argv: readonly string[]): Promise<number> {
  const verb = "knowledge redact";
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REDACT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeRedactArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: REDACT_USAGE });
    return EXIT_USAGE;
  }
  const { home, json } = sharedFlags({ values: parsed.value.values });
  const apply = parsed.value.values["apply"] === true;
  const inputs = openRedactionInputs({ home, verb });
  if (inputs.isErr()) {
    logger.error({ msg: inputs.error });
    return EXIT_ERROR;
  }
  // A dry run promises to write nothing, so it never catches a behind store up — it refuses instead.
  const opened = await connectStore({ catchUp: apply, home: inputs.value.home });
  if (opened.isErr()) {
    logger.error({ msg: `${verb}: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const run = { client, inputs: inputs.value, json, verb };
    return apply ? await applyRedaction(run) : await dryRunRedaction(run);
  } finally {
    await client.close();
  }
}

/** What both halves of `knowledge redact` run with once the store is open. */
interface RedactRun {
  readonly client: StoreClient;
  readonly inputs: KnowledgeRedactionInputs;
  readonly json: boolean;
  readonly verb: string;
}

/**
 * `knowledge redact` without `--apply`: plan over the whole register and print what would change, writing nothing.
 *
 * @returns 0 once the plan is printed, 1 when a read failed or the plan refused
 */
async function dryRunRedaction({ client, inputs: { map, scanner }, json, verb }: RedactRun): Promise<number> {
  const memories = await readAllMemories({ client });
  if (memories.isErr()) {
    logger.error({ msg: `${verb}: ${memories.error.message}` });
    return EXIT_ERROR;
  }
  const recalls = await readAllRecalls({ client });
  if (recalls.isErr()) {
    logger.error({ msg: `${verb}: ${recalls.error.message}` });
    return EXIT_ERROR;
  }
  const plan = planKnowledgeRedaction({ map, memories: memories.value, recalls: recalls.value, scanner });
  if (plan.isErr()) {
    logger.error({ msg: plan.error.message });
    return EXIT_ERROR;
  }
  const outcome = {
    archive: undefined,
    changedMemories: plan.value.changedMemories,
    changedRecalls: plan.value.changedRecalls,
    merges: plan.value.merges,
    movedClaims: plan.value.idMap.length,
  };
  const lines = json ? [JSON.stringify({ applied: false, ...outcome })] : redactLines({ applied: false, outcome });
  lines.forEach((line) => {
    logger.out({ line });
  });
  if (outcome.changedMemories + outcome.changedRecalls > 0) {
    logger.error({ msg: `${verb}: a dry run — re-run with --apply to rewrite in place` });
  }
  return EXIT_OK;
}

/**
 * `knowledge redact --apply`: archive the register, rewrite it in place, and print the re-scan.
 *
 * @returns 0 once the rewrite committed, 1 when it was refused or rolled back
 */
async function applyRedaction({ client, inputs: { home, map, scanner }, json, verb }: RedactRun): Promise<number> {
  const path = knowledgeRedactionArchivePath({
    archiveDir: stateHomePaths({ home }).knowledgeRedactionArchive,
    nonce: randomUUID(),
    now: new Date(),
  });
  const applied = await applyStoredKnowledgeRedaction({
    archive: {
      path,
      write: ({ memories, recalls }) => {
        writeArchive({ memories, path, recalls });
      },
    },
    client,
    map,
    scanner,
  });
  if (applied.isErr()) {
    logger.error({ msg: `${verb}: ${applied.error.message}` });
    return EXIT_ERROR;
  }
  const lines = json
    ? [JSON.stringify({ applied: true, ...applied.value })]
    : [...redactLines({ applied: true, outcome: applied.value }), ...scanLines({ scan: applied.value.after, verb })];
  lines.forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * Write the pre-redaction archive. It is two files and one unit: a failure writing either removes both, so a
 * rolled-back rewrite never leaves a half archive that reads as the whole pre-redaction register.
 */
function writeArchive({
  memories,
  path,
  recalls,
}: {
  memories: readonly MemoryRecordingRow[];
  path: string;
  recalls: readonly MemoryRecallRow[];
}): void {
  const recallsPath = recallsFileFor({ out: path });
  try {
    writeRows({ out: path, rows: memories });
    writeRecalls({ out: recallsPath, rows: recalls });
  } catch (cause) {
    rmSync(path, { force: true });
    rmSync(recallsPath, { force: true });
    throw cause;
  }
}

export const knowledgeRedactionScanCommand = defineCommand({ run: runKnowledgeRedactionScan });
export const knowledgeRedactCommand = defineCommand({ run: runKnowledgeRedact });
