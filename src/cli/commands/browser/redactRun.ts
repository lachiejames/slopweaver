/**
 * `slopweaver browser redact` — burn opaque rectangles into a captured picture, write the result as a NEW file, and
 * file the child capture receipt that points at its parent.
 *
 * The pixels are `../../../visualEvidence/redact.ts`; the form is `../../../visualEvidence/captureForms.ts`. This file
 * reads, refuses, writes and reports.
 *
 * ## What it refuses, with no hatch
 *
 * - A source with no version-2 capture receipt for its exact bytes: a child receipt has to inherit the parent's
 *   frame text, crop and source frame, so a picture nothing recorded cannot be redacted into one `github attach`
 *   accepts. Re-capture through a capture verb instead.
 * - A source whose digest holds any FAILED image record: a failed record is terminal for its bytes, and redacting
 *   them would mint new bytes with no record — the same laundering `browser annotate` refuses.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import { logger } from "#lib/logger.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { writeFileAtomicBytes } from "#lib/writeAtomic.js";
import { parseRedactForm, type RedactForm } from "../../../visualEvidence/captureForms.js";
import {
  type CaptureReceipt,
  captureIdFor,
  isCaptureReceipt,
  readCaptureRecord,
  writeCaptureRecord,
} from "../../../visualEvidence/captureRecord.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import { imageDigestOf } from "../../../visualEvidence/imageIo.js";
import { burnRedactions, redactionReceiptOf } from "../../../visualEvidence/redact.js";
import { readImageRecords } from "../../../visualEvidence/store.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

/**
 * Read and parse the form, or the exit code to return.
 *
 * @param form the form file's path
 * @returns the parsed form, or the exit code
 */
function loadForm({ form }: { form: string }): { readonly form: RedactForm } | { readonly code: number } {
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `redact form at ${form}`, text: readFileSync(form, "utf8") });
  } catch (error) {
    logger.error({
      msg: `could not read the form at ${form}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { code: EXIT_USAGE };
  }
  const parsed = parseRedactForm({ value: decoded });
  if (parsed.isErr()) {
    for (const line of visualEvidenceErrorLines({ error: parsed.error })) {
      logger.error({ msg: line });
    }
    return { code: EXIT_USAGE };
  }
  return { form: parsed.value };
}

/**
 * The parent's receipt, or why the source cannot be redacted into an attachable child.
 *
 * @param home the state home holding the evidence store
 * @param bytes the source picture's bytes
 * @returns the parent receipt, or the refusal to print
 */
export function redactParentOf({
  home,
  bytes,
}: {
  home: string;
  bytes: Uint8Array;
}): { readonly parent: CaptureReceipt } | { readonly problem: string } {
  const digest = imageDigestOf({ bytes });
  const recorded = readCaptureRecord({ captureId: captureIdFor({ digest }), home });
  if (recorded.isErr()) {
    return { problem: recorded.error.message };
  }
  if (recorded.value === null || !isCaptureReceipt(recorded.value) || recorded.value.final.artifact.digest !== digest) {
    return {
      problem:
        `no version-2 capture receipt names the source bytes ${digest} — redact the file a capture verb wrote, ` +
        "unedited, or re-capture it",
    };
  }
  const records = readImageRecords({ digest, home });
  if (records.isErr()) {
    return { problem: records.error.message };
  }
  const failed = records.value.find((record) => record.outcome === "failed");
  if (failed !== undefined) {
    return {
      problem:
        `the source bytes are already recorded unfit (${failed.reason}: ${failed.correction}) — a picture recorded ` +
        "unfit is retaken, never redacted around",
    };
  }
  return { parent: recorded.value };
}

/** The source picture's bytes, or `null` once the read failure is printed. */
function readSource({ source }: { source: string }): Uint8Array | null {
  try {
    return readFileSync(source);
  } catch (error) {
    logger.error({ msg: `could not read ${source}: ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
}

/** Write the redacted PNG and file its receipt; the path the receipt was filed at, or `null` once a failure is printed. */
function writeAndFile({
  bytes,
  out,
  receipt,
  home,
}: {
  bytes: Uint8Array;
  out: string;
  receipt: CaptureReceipt;
  home: string;
}): string | null {
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomicBytes({ bytes: Buffer.from(bytes), path: out });
  } catch (error) {
    logger.error({ msg: `could not write ${out}: ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
  const filed = writeCaptureRecord({ home, record: receipt });
  if (filed.isErr()) {
    rmSync(out, { force: true });
    logger.error({ msg: `${filed.error.message} — the redacted picture was removed, since nothing could attach it` });
    return null;
  }
  return filed.value;
}

/** Print what was burned, what the child receipt dropped, and the next step. */
function reportRedaction({
  parent,
  receipt,
  receiptPath,
  json,
}: {
  parent: CaptureReceipt;
  receipt: CaptureReceipt;
  receiptPath: string;
  json: boolean;
}): void {
  const out = receipt.final.path;
  const next =
    "open the redacted picture, check every rectangle is solid, then: slopweaver browser image-record --form <form>";
  if (json) {
    logger.out({ line: JSON.stringify({ next, out, receipt, receiptPath }, null, 2) });
    return;
  }
  const burned = receipt.verb === "browser redact" ? receipt.detail.burned.length : 0;
  const dropped = parent.frameText.items.length - receipt.frameText.items.length;
  logger.out({ line: `redact: burned ${String(burned)} rectangle(s) — ${out}` });
  logger.out({ line: `  ${receipt.final.artifact.digest}, child of ${parent.captureId}` });
  logger.out({
    line: `  capture receipt ${receipt.captureId}: ${String(dropped)} frame-text item(s) wholly covered and dropped`,
  });
  logger.out({ line: `  ${next}, citing capture id ${receipt.captureId}` });
}

/**
 * Run `browser redact`.
 *
 * @param form the form file's path
 * @param home the state home the receipts are read from and filed under
 * @param capturedAtIso when the redaction is made
 * @param json whether machine-readable output was asked for
 * @returns the process exit code
 */
export async function runBrowserRedact({
  form,
  home,
  capturedAtIso,
  json,
}: {
  form: string;
  home: string;
  capturedAtIso: string;
  json: boolean;
}): Promise<number> {
  const loaded = loadForm({ form });
  if (!("form" in loaded)) {
    return loaded.code;
  }
  const { source, out, rects } = loaded.form;
  const bytes = readSource({ source });
  if (bytes === null) {
    return EXIT_ERROR;
  }
  const held = redactParentOf({ bytes, home });
  if ("problem" in held) {
    logger.error({ msg: held.problem });
    return EXIT_ERROR;
  }
  const burned = await burnRedactions({ bytes, rects });
  if (burned.isErr()) {
    for (const line of visualEvidenceErrorLines({ error: burned.error })) {
      logger.error({ msg: line });
    }
    return burned.error.code === "REDACTION_REFUSED" ? EXIT_USAGE : EXIT_ERROR;
  }
  const receipt = redactionReceiptOf({
    burned: rects,
    capturedAtIso,
    out,
    parent: held.parent,
    redacted: burned.value.artifact,
  });
  const receiptPath = writeAndFile({ bytes: burned.value.bytes, home, out, receipt });
  if (receiptPath === null) {
    return EXIT_ERROR;
  }
  reportRedaction({ json, parent: held.parent, receipt, receiptPath });
  return EXIT_OK;
}
