/**
 * `slopweaver store export` and `slopweaver store import` — the installation's owned state written to a
 * private, manifested directory, and that directory checked back without changing anything.
 *
 * The disaster-recovery path for what no provider can hand back. The import proves an export is whole and
 * decodes, then PLANS it against the live store and asks every question its rulings require, writing nothing.
 * Given `--approve` and the plan digest it printed, it STAGES the export — every row and question, in the
 * store, nothing live — so the owner can answer the questions after the directory is gone. Given `--apply` and
 * the batch id staging printed, it APPLIES that batch in one transaction (`./importApplyRun.ts`) —
 * `skills/store/reference/import-export.md`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";

import { connectStore, type StoreClient } from "../../../store/client.js";
import {
  type StoreExportWritten,
  settlePublishedExport,
  writeStoreExport,
} from "../../../store/transfer/bundlePublish.js";
import { type BundleReading, contentDigest, readExportBundle } from "../../../store/transfer/bundleRead.js";
import { ensureWitnessedRegisters, readStoreExportContents } from "../../../store/transfer/bundleWrite.js";
import { type ImportPlan, planImport } from "../../../store/transfer/compare.js";
import type { StoreTransferError } from "../../../store/transfer/errors.js";
import type { StoreImportError } from "../../../store/transfer/importErrors.js";
import { type StageImportOutcome, stageImport } from "../../../store/transfer/importStore.js";
import { liveRetained } from "../../../store/transfer/liveRetained.js";
import { approveImportPlan, importStageDraft } from "../../../store/transfer/staged.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";

import { type StoreCommandError, StoreCommandErrors, storeCommandErrorLines } from "./errors.js";
import { runStoreImportApply } from "./importApplyRun.js";
import { parseStoreExportArgs, parseStoreImportArgs, type StoreImportPlanArgs } from "./transferArgs.js";
import { type TransferReport, transferLines, transferReport } from "./transferLines.js";
import { STORE_EXPORT_USAGE, STORE_IMPORT_USAGE } from "./transferUsage.js";
import { fail, refuse, resolvedHome } from "./verbShell.js";

/** The argv after `store <verb>`. */
function verbArgs({ argv, verb }: { argv: readonly string[]; verb: string }): readonly string[] {
  return argv.slice(argv[3] === verb ? 4 : 3);
}

/** Print a report as one document or as lines. */
function print({ report, json }: { report: TransferReport; json: boolean }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: `store ${report.verb}`, value: report }) });
    return;
  }
  transferLines({ report }).forEach((line) => {
    logger.out({ line });
  });
}

/**
 * The running code's own package version, for the manifest's producer. Read from the package this module
 * ships in, the way `doctor` reads it, and never from whichever repository the invocation stands in: the
 * producer is the code that wrote the export.
 */
function producerVersion(): Result<string, StoreCommandError> {
  let parsed: unknown;
  let why = "it carries no version field";
  try {
    const path = new URL("../../../../package.json", import.meta.url);
    parsed = safeJsonParse({ label: "package.json", text: readFileSync(path, "utf8") });
  } catch (cause) {
    why = cause instanceof Error ? cause.message : String(cause);
  }
  if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
    return ok(parsed.version);
  }
  return err(StoreCommandErrors.packageVersionMissing({ why }));
}

/**
 * Read the store, publish the export, and check the witnessed journals once more now it is published: an old
 * build's journal append landing after the snapshot's own checks would be missing from the export, so a refusal
 * there takes back the directory this run created.
 *
 * @param version this checkout's version, recorded in the manifest as its producer
 * @returns what was written, or the refusal and whether the published directory was removed
 */
async function publishStoreExport({
  client,
  home,
  out,
  version,
}: {
  client: StoreClient;
  home: string;
  out: string;
  version: string;
}): Promise<Result<StoreExportWritten, { readonly cause: StoreTransferError; readonly removed: boolean }>> {
  const contents = await readStoreExportContents({ client, home });
  if (contents.isErr()) {
    return err({ cause: contents.error, removed: false });
  }
  const written = writeStoreExport({
    contents: contents.value,
    createdAtIso: new Date().toISOString(),
    out,
    producerVersion: version,
  });
  if (written.isErr()) {
    return err({ cause: written.error, removed: false });
  }
  const journalsAfter = settlePublishedExport({ out, recheck: await ensureWitnessedRegisters({ client, home }) });
  if (journalsAfter.isErr()) {
    return err({ cause: journalsAfter.error, removed: true });
  }
  return ok(written.value);
}

/**
 * Run `store export`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreExport(argv: readonly string[]): Promise<number> {
  const rest = verbArgs({ argv, verb: "export" });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STORE_EXPORT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreExportArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: parsed.error }), usage: STORE_EXPORT_USAGE });
  }
  const args = parsed.value;
  const home = resolvedHome({ home: args.home });
  const out = resolve(args.out);
  const version = producerVersion();
  if (version.isErr()) {
    return fail({ lines: storeCommandErrorLines({ error: version.error }).map((line) => `store export: ${line}`) });
  }
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return fail({ lines: [`store export: ${opened.error.message}`] });
  }
  const client = opened.value;
  try {
    const written = await publishStoreExport({ client, home, out, version: version.value });
    if (written.isErr()) {
      const removed = `store export: removed ${out}, which was written before that change and may lack it`;
      const lines = [`store export: ${written.error.cause.message}`];
      return fail({ lines: written.error.removed ? [...lines, removed] : lines });
    }
    print({
      json: args.json,
      report: transferReport({
        dir: out,
        manifested: true,
        parts: written.value.parts,
        plan: null,
        stage: null,
        verb: "export",
      }),
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

/**
 * Stage an approved plan, or do nothing when none was approved.
 *
 * @returns the staging's outcome, `null` for an unapproved plan, or why the approval or staging was refused
 */
async function stageApproved({
  client,
  approve,
  plan,
  reading,
}: {
  client: StoreClient;
  approve: string | undefined;
  plan: ImportPlan;
  reading: BundleReading;
}): Promise<Result<StageImportOutcome | null, StoreImportError>> {
  if (approve === undefined) {
    return ok(null);
  }
  const draft = approveImportPlan({ approved: approve, plan }).andThen((approved) =>
    importStageDraft({ plan: approved, reading }),
  );
  if (draft.isErr()) {
    return err(draft.error);
  }
  return stageImport({ client, draft: draft.value });
}

/**
 * Run `store import` — check the export, then plan it against the live store: every part compared key by
 * key, and every question the owner must answer before anything restored takes effect. Without `--approve`
 * nothing is written; with the plan's own digest, the export is staged and nothing staged is live. With
 * `--apply <batch-id>` it applies a staged batch instead, and reads no export.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreImport(argv: readonly string[]): Promise<number> {
  const rest = verbArgs({ argv, verb: "import" });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STORE_IMPORT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreImportArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: parsed.error }), usage: STORE_IMPORT_USAGE });
  }
  if (parsed.value.mode === "apply") {
    return runStoreImportApply({ args: parsed.value });
  }
  return runStoreImportPlan({ args: parsed.value });
}

/**
 * Check an export, plan it, and stage it when its plan was approved.
 *
 * @param args the parsed arguments of a `store import` that names an export
 * @returns the process exit code
 */
async function runStoreImportPlan({ args }: { args: StoreImportPlanArgs }): Promise<number> {
  const dir = resolve(args.from);
  const read = readExportBundle({ dir, unmanifested: args.unmanifested });
  if (read.isErr()) {
    return fail({ lines: [`store import: ${read.error.message}`] });
  }
  const home = resolvedHome({ home: args.home });
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return fail({ lines: [`store import: ${opened.error.message}`] });
  }
  const client = opened.value;
  try {
    const contents = await readStoreExportContents({ client, home });
    if (contents.isErr()) {
      return fail({ lines: [`store import: ${contents.error.message}`] });
    }
    const plan = liveRetained({ contents: contents.value }).andThen((live) =>
      planImport({ contentDigest: contentDigest({ parts: read.value.parts }), imported: read.value.retained, live }),
    );
    if (plan.isErr()) {
      return fail({ lines: [`store import: ${plan.error.message}`] });
    }
    const stage = await stageApproved({ approve: args.approve, client, plan: plan.value, reading: read.value });
    if (stage.isErr()) {
      return fail({ lines: [`store import: ${stage.error.message}`] });
    }
    const report = transferReport({
      dir,
      manifested: read.value.manifest !== null,
      parts: read.value.parts,
      plan: plan.value,
      stage: stage.value,
      verb: "import",
    });
    print({ json: args.json, report });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const storeExportCommand = defineCommand({ run: runStoreExport });
export const storeImportCommand = defineCommand({ run: runStoreImport });
