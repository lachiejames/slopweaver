/**
 * `slopweaver knowledge prune` — apply a hygiene pass they approved: retire claims, write their rewrites.
 *
 * The register is append-only for every OTHER verb, and that stays true: a repeated claim id is the
 * consolidation signal, and `record`, `remember` and `recalled` never touch a row already written. This verb
 * is the one exception, and it exists because a pass they approved named claims that must leave recall
 * altogether — a row canon now carries, a mechanism that is gone, a duplicate folded into its keeper
 * (option A on the memory-hygiene page, the whole pass as proposed).
 *
 * Three properties make it safe to run:
 *
 * - **A dry run by default.** Without `--apply` it prints what would leave and what would be written, and
 *   touches nothing.
 * - **Archive before delete.** Every recording and recall of a retired claim is written, in `knowledge
 *   export` format, under `$SLOPWEAVER_HOME/knowledge/pruned/` BEFORE the transaction runs, with the plan
 *   beside it — so nothing retired is lost, and the lines a later ruling wants back are there verbatim.
 * - **One transaction.** Replacements and deletions land together or not at all.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { MemoryRecording } from "../../../knowledge/memory.js";
import { type PrunePlan, parsePrunePlan } from "../../../knowledge/prune.js";
import { prunedArchiveDir } from "../../../knowledge/prunedImportKeys.js";
import { applyPrune, readClaimsForArchive } from "../../../knowledge/pruneStore.js";
import { logger } from "../../../lib/logger.js";
import { connectStore, type StoreClient } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { VERB_ARG_OFFSET } from "./core.js";
import { recallsFileFor, writeRecalls, writeRows } from "./exportMemories.js";
import { installDomainsOrExit, type KnowledgeDomainDeps, productionKnowledgeDomainDeps } from "./installDomainsEdge.js";
import { PRUNE_USAGE, parseKnowledgePruneArgs } from "./pruneCore.js";

/**
 * Where this prune's archive goes: one file per run, named for the instant, never overwritten.
 *
 * @param home the state home, when the caller named one
 * @param stamp the instant, already filename-safe
 * @returns the archive's path
 */
function archivePathFor({ home, stamp }: { home: string | undefined; stamp: string }): string {
  return join(prunedArchiveDir({ home }), `${stamp}.jsonl`);
}

/**
 * The replacement recordings, each with the identities a write mints now.
 *
 * @param plan the validated plan
 * @param recordedAt the instant every replacement carries
 * @returns one recording per replace step
 */
function replacementsOf({ plan, recordedAt }: { plan: PrunePlan; recordedAt: Date }): readonly MemoryRecording[] {
  return plan.steps.flatMap((step) =>
    step.op === "replace" ? [{ ...step.draft, recordedAt, recordingId: randomUUID() }] : [],
  );
}

/**
 * Print what the plan would do against the table as it stands.
 *
 * @param plan the validated plan
 * @param recordings how many recordings the retired claims hold now
 * @param recalls how many recalls they hold now
 * @param absent how many claim ids the plan retires that the table does not hold
 */
function printSummary({
  plan,
  recordings,
  recalls,
  absent,
}: {
  plan: PrunePlan;
  recordings: number;
  recalls: number;
  absent: readonly string[];
}): void {
  const replaces = plan.steps.filter((step) => step.op === "replace").length;
  logger.out({
    line:
      `knowledge prune: ${String(plan.retiredIds.length)} claim(s) retired (${String(recordings)} recording(s), ` +
      `${String(recalls)} recall(s)), ${String(replaces)} replacement(s) written`,
  });
  if (absent.length > 0) {
    logger.out({
      line: `knowledge prune: ${String(absent.length)} retired id(s) are not in the table (already gone): ${absent.slice(0, 5).join(", ")}`,
    });
  }
}

/**
 * Archive, then apply.
 *
 * @param client an open connection
 * @param plan the validated plan
 * @param planFile the plan's path, copied beside the archive
 * @param home the state home, when named
 * @returns the exit code
 */
async function applyWithArchive({
  client,
  plan,
  planFile,
  home,
}: {
  client: StoreClient;
  plan: PrunePlan;
  planFile: string;
  home: string | undefined;
}): Promise<number> {
  const archived = await readClaimsForArchive({ client, ids: plan.retiredIds });
  if (archived.isErr()) {
    logger.error({ msg: `knowledge prune: ${archived.error.message} — nothing was written` });
    return EXIT_ERROR;
  }
  const held = new Set(archived.value.recordings.map((row) => row.id));
  const absent = plan.retiredIds.filter((id) => !held.has(id));
  printSummary({ absent, plan, recalls: archived.value.recalls.length, recordings: archived.value.recordings.length });
  const now = new Date();
  const archive = archivePathFor({ home, stamp: now.toISOString().replaceAll(":", "-") });
  writeRows({ out: archive, rows: archived.value.recordings });
  writeRecalls({ out: recallsFileFor({ out: archive }), rows: archived.value.recalls });
  copyFileSync(planFile, `${archive}.plan.jsonl`);
  logger.out({ line: `knowledge prune: archived to ${archive} (knowledge export format), plan beside it` });
  const applied = await applyPrune({
    client,
    inserts: replacementsOf({ plan, recordedAt: now }),
    recallIds: archived.value.recalls.map((row) => row.recallId),
    recordingIds: archived.value.recordings.map((row) => row.recordingId),
  });
  if (applied.isErr()) {
    logger.error({
      msg: `knowledge prune: ${applied.error.message} — the transaction rolled back; the archive stands`,
    });
    return EXIT_ERROR;
  }
  logger.out({
    line:
      `knowledge prune: applied — ${String(applied.value.recordingsRemoved)} recording(s) and ` +
      `${String(applied.value.recallsRemoved)} recall(s) removed, ${String(applied.value.recordingsWritten)} written`,
  });
  return EXIT_OK;
}

/**
 * Print what the plan would do against the table as it stands, writing nothing.
 *
 * @param client an open connection
 * @param plan the validated plan
 * @returns the exit code
 */
async function dryRun({ client, plan }: { client: StoreClient; plan: PrunePlan }): Promise<number> {
  const current = await readClaimsForArchive({ client, ids: plan.retiredIds });
  if (current.isErr()) {
    logger.error({ msg: `knowledge prune: ${current.error.message}` });
    return EXIT_ERROR;
  }
  const held = new Set(current.value.recordings.map((row) => row.id));
  printSummary({
    absent: plan.retiredIds.filter((id) => !held.has(id)),
    plan,
    recalls: current.value.recalls.length,
    recordings: current.value.recordings.length,
  });
  logger.out({ line: "knowledge prune: dry run — nothing written. Re-run with --apply" });
  return EXIT_OK;
}

/** The plan file's text, or `EXIT_ERROR` once an unreadable file has been reported. */
function readPlanText({ planFile }: { planFile: string }): string | number {
  try {
    return readFileSync(planFile, "utf8");
  } catch {
    logger.error({ msg: `knowledge prune: cannot read the plan file ${planFile}` });
    return EXIT_ERROR;
  }
}

/**
 * Run `knowledge prune` over the production store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgePrune(argv: readonly string[]): Promise<number> {
  return runKnowledgePruneWithDeps({ argv, deps: productionKnowledgeDomainDeps() });
}

/**
 * Run `knowledge prune` over the dependencies it is handed.
 *
 * @param argv the full process argv
 * @param deps where the install's own domains are read
 * @returns the process exit code
 */
export async function runKnowledgePruneWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: KnowledgeDomainDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PRUNE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgePruneArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: PRUNE_USAGE });
    return EXIT_USAGE;
  }
  const planFile = parsed.value.values["plan"];
  if (typeof planFile !== "string" || planFile.length === 0) {
    logger.error({ msg: "knowledge prune: --plan <path> is required" });
    logger.error({ msg: PRUNE_USAGE });
    return EXIT_USAGE;
  }
  const planText = readPlanText({ planFile });
  if (typeof planText === "number") {
    return planText;
  }
  const homeValue = parsed.value.values["home"];
  const home = typeof homeValue === "string" ? homeValue : undefined;
  const installDomains = await installDomainsOrExit({ domains: deps.domains, home, verb: "knowledge prune" });
  if (typeof installDomains === "number") {
    return installDomains;
  }
  const plan = parsePrunePlan({ installDomains, lines: planText.split("\n") });
  if (plan.isErr()) {
    plan.error.forEach((problem) => {
      logger.error({ msg: `knowledge prune: ${problem.message}` });
    });
    logger.error({ msg: "knowledge prune: the plan was refused whole — nothing was read or written" });
    return EXIT_USAGE;
  }
  // The plan's own home, never another install's store; a dry run writes nothing, so it never catches a store up.
  const apply = parsed.value.values["apply"] === true;
  const opened = await connectStore({ catchUp: apply, ...(home === undefined ? {} : { home }) });
  if (opened.isErr()) {
    logger.error({ msg: `knowledge prune: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  try {
    if (apply) {
      return await applyWithArchive({ client: opened.value, home, plan: plan.value, planFile });
    }
    return await dryRun({ client: opened.value, plan: plan.value });
  } finally {
    await opened.value.close();
  }
}

export const knowledgePruneCommand = defineCommand({ run: runKnowledgePrune });
