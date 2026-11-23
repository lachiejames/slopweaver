/**
 * `slopweaver knowledge restore` — put a `knowledge export` file back into the memories tables.
 *
 * The other half of the recovery leg. An export nobody can replay is a file rather than a backup, and a
 * restore path that is never exercised is the classic backup that turns out not to work on the day it is
 * needed — so the round trip is proven rather than assumed.
 *
 * **Both files are decoded before anything is written** (`./restoreFiles.ts`), **and both tables go in ONE
 * transaction** (`knowledge/memoryRestoreStore.ts`), so a corrupt ledger line or a refused row leaves the
 * database exactly as it was rather than holding a register with none of the accounting that ranks it.
 *
 * **By default it refuses a non-empty table**: recovery into a fresh database keeps every `seq` verbatim.
 * **`--merge` adds an export to a live database** instead, refused whole on any clash
 * (`knowledge/restoreMerge.ts` carries the rules), because "add these rows" must never mean "replace what
 * is there". **`--redact`** runs `knowledge redact`'s plan over the decoded batch before the store is opened,
 * so a refusal writes nothing and the file itself is never touched.
 *
 * The restore locks both tables against writers for its one transaction, so another session's recording
 * or recall cannot land on a sequence value the plan also hands out. It asks for those locks without waiting
 * and retries while a writer holds one, so it can never deadlock with a two-table writer.
 */
import { type RestoreOutcome, restoreKnowledge } from "../../../knowledge/memoryRestoreStore.js";
import { planKnowledgeRedaction } from "../../../knowledge/redaction.js";
import type { RestoreInput, RestoreMode } from "../../../knowledge/restoreMerge.js";
import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { VERB_ARG_OFFSET } from "./core.js";
import { openRedactionInputs } from "./redactionContext.js";
import { parseKnowledgeRestoreArgs, RESTORE_USAGE } from "./registerArgs.js";
import { decodeRestoreFiles } from "./restoreFiles.js";

/**
 * `--redact`: plan one redaction over the register and its ledger together, so a claim id the redaction moves
 * is moved in the recalls naming it as well. Done before the store is opened, so a refusal writes nothing.
 *
 * @param incoming both decoded files
 * @returns both batches redacted, or `undefined` once a refusal is printed
 */
function redactRestoreBatch({ incoming }: { incoming: RestoreInput }): RestoreInput | undefined {
  const inputs = openRedactionInputs({ home: undefined, verb: "knowledge restore" });
  if (inputs.isErr()) {
    logger.error({ msg: inputs.error });
    return undefined;
  }
  const plan = planKnowledgeRedaction({
    map: inputs.value.map,
    memories: incoming.memories,
    recalls: incoming.recalls,
    scanner: inputs.value.scanner,
  });
  if (plan.isErr()) {
    logger.error({ msg: `${plan.error.message} — nothing was written` });
    return undefined;
  }
  logger.error({
    msg:
      `knowledge restore: --redact rewrote ${String(plan.value.changedMemories)} recording(s) and ` +
      `${String(plan.value.changedRecalls)} recall(s) before writing, moving ${String(plan.value.idMap.length)} claim id(s)`,
  });
  return { memories: plan.value.memories, recalls: plan.value.recalls };
}

/**
 * Run `knowledge restore`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeRestore(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RESTORE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeRestoreArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: RESTORE_USAGE });
    return EXIT_USAGE;
  }
  const file = parsed.value.values["file"];
  if (typeof file !== "string" || file.length === 0) {
    logger.error({ msg: "knowledge restore: --file <path> is required" });
    logger.error({ msg: RESTORE_USAGE });
    return EXIT_USAGE;
  }
  const json = parsed.value.values["json"] === true;
  const mode: RestoreMode = parsed.value.values["merge"] === true ? "merge" : "empty";
  const decoded = decodeRestoreFiles({ file });
  if (decoded.isErr()) {
    logger.error({ msg: `knowledge restore: ${decoded.error.message} — nothing was written` });
    return EXIT_ERROR;
  }
  const { ledgerPath, ledgerPresent } = decoded.value;
  if (!ledgerPresent) {
    logger.error({
      msg: `knowledge restore: no recall ledger beside it (${ledgerPath}) — an export written before the ledger existed carries none`,
    });
  }
  let incoming = decoded.value.incoming;
  if (parsed.value.values["redact"] === true) {
    const redacted = redactRestoreBatch({ incoming });
    if (redacted === undefined) {
      return EXIT_ERROR;
    }
    incoming = redacted;
  }
  const opened = await connectStore();
  if (opened.isErr()) {
    logger.error({ msg: `knowledge restore: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const restored = await restoreKnowledge({ client, incoming, mode });
    if (restored.isErr()) {
      logger.error({ msg: `knowledge restore: ${restored.error.message}` });
      return EXIT_ERROR;
    }
    reportRestore({ file, json, ledgerPresent, mode, outcome: restored.value });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

/** Print one restore's outcome, as a JSON document or a counted line. */
function reportRestore({
  file,
  json,
  ledgerPresent,
  mode,
  outcome,
}: {
  file: string;
  json: boolean;
  ledgerPresent: boolean;
  mode: RestoreMode;
  outcome: RestoreOutcome;
}): void {
  if (json) {
    logger.out({ line: JSON.stringify({ file, ledgerPresent, mode, ...outcome }) });
    return;
  }
  logger.out({
    line:
      `knowledge restore (${mode}): ${String(outcome.insertedMemories)} recording(s) and ` +
      `${String(outcome.insertedRecalls)} recall(s) written from ${file}; ` +
      `${String(outcome.skippedMemories)} recording(s) and ${String(outcome.skippedRecalls)} recall(s) ` +
      "already held identically and skipped",
  });
}

export const knowledgeRestoreCommand = defineCommand({ run: runKnowledgeRestore });
