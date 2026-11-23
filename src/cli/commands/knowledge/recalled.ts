/**
 * `slopweaver knowledge recalled` — account for a memory this session pulled, and regrade it on the spot.
 *
 * The investigation that just recalled a claim is the only one holding the
 * evidence about whether it still holds, so the verdict moves there. The verb writes the accounting row and
 * the regrading recording in ONE transaction (`../../../knowledge/memoryRecordStore.ts`), and the caller never
 * retypes the claim — it is carried from the latest recording byte for byte, so the claim id cannot drift.
 *
 * Nothing here deletes anything. A memory that keeps breaking accumulates recordings and recalls; what
 * changes is what the register currently believes and where the claim sits on a recall page.
 */
import { randomUUID } from "node:crypto";

import { recordRecall } from "../../../knowledge/memoryRecordStore.js";
import {
  BROKE_VERDICTS,
  type BrokeVerdict,
  parseRecallFields,
  RECALL_OUTCOMES,
  type RecallFields,
} from "../../../knowledge/recallAccounting.js";
import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { RECALLED_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { parseKnowledgeRecalledArgs } from "./flagSpecs.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * What the caller asked to record, or the refusal to print.
 *
 * @param values the parsed flags
 * @param positionals the argv positionals — the claim id is the first
 * @returns the fields, or the refusal
 */
function recallFields({
  values,
  positionals,
}: {
  values: Readonly<Record<string, unknown>>;
  positionals: readonly string[];
}): RecallFields | string {
  const memoryId = positionals[0];
  if (memoryId === undefined) {
    return "the claim id is the first argument — copy it from the recall page";
  }
  const outcome = RECALL_OUTCOMES.find((entry) => entry === flag({ name: "outcome", values }));
  if (outcome === undefined) {
    return `--outcome must be one of ${RECALL_OUTCOMES.join(", ")}`;
  }
  const evidence = flag({ name: "evidence", values });
  if (evidence === undefined) {
    return "--evidence is required — what you observed when you checked it, or what you did instead";
  }
  const rawVerdict = flag({ name: "verdict", values });
  if (rawVerdict !== undefined && !BROKE_VERDICTS.some((entry) => entry === rawVerdict)) {
    return `--verdict must be one of ${BROKE_VERDICTS.join(", ")}`;
  }
  const verdict = BROKE_VERDICTS.find((entry) => entry === rawVerdict);
  // `--run` defaults to ad-hoc, as every other knowledge verb's does and as the usage states.
  const suppliedRun = flag({ name: "run", values });
  let run = "ad-hoc";
  if (suppliedRun !== undefined) {
    run = suppliedRun;
  }
  const base: RecallFields = { evidence, memoryId, outcome, run };
  if (verdict === undefined) {
    return base;
  }
  return { ...base, verdict: verdict satisfies BrokeVerdict };
}

/**
 * Run `knowledge recalled`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeRecalled(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RECALLED_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeRecalledArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: RECALLED_USAGE });
    return EXIT_USAGE;
  }
  const asked = recallFields({ positionals: parsed.value.positionals, values: parsed.value.values });
  if (typeof asked === "string") {
    logger.error({ msg: `knowledge recalled: ${asked}` });
    logger.error({ msg: RECALLED_USAGE });
    return EXIT_USAGE;
  }
  const fields = parseRecallFields({ fields: asked });
  if (fields.isErr()) {
    logger.error({ msg: `knowledge recalled: ${fields.error.message}` });
    return EXIT_USAGE;
  }
  const opened = await connectStore();
  if (opened.isErr()) {
    logger.error({ msg: `knowledge recalled: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const written = await recordRecall({
      client,
      fields: fields.value,
      recallId: randomUUID(),
      recordedAt: new Date(),
      regradeRecordingId: randomUUID(),
    });
    if (written.isErr()) {
      logger.error({ msg: `knowledge recalled: ${written.error.message}` });
      return EXIT_ERROR;
    }
    if (parsed.value.values["json"] === true) {
      logger.out({ line: JSON.stringify(written.value) });
      return EXIT_OK;
    }
    const { recall, regraded } = written.value;
    logger.out({ line: `knowledge recalled: ${recall.memoryId} — ${recall.outcome} (recall ${recall.recallId})` });
    if (regraded === null) {
      logger.out({ line: "  the verdict did not move; the recall is counted and ranks the claim on the next page" });
      return EXIT_OK;
    }
    logger.out({ line: `  regraded to ${regraded.verdict} (recording ${regraded.recordingId}) — nothing was deleted` });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const knowledgeRecalledCommand = defineCommand({ run: runKnowledgeRecalled });
