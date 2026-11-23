/**
 * `slopweaver browser terminal-shot` — render terminal text to a PNG and file the capture receipt that records,
 * as frame text, exactly the words drawn.
 *
 * The pixels and the receipt are `../../../visualEvidence/terminalShot.ts`; the form is
 * `../../../visualEvidence/captureForms.ts`. This file reads, writes and reports. The PNG is written first and the
 * receipt second, each atomically; a picture whose receipt failed to write is removed, because a picture with no
 * receipt is one `github attach` refuses and a reader would take for done.
 *
 * Nothing is recorded as VIEWED here: the session opens the PNG and records what it saw with
 * `slopweaver browser image-record`, naming the capture id this prints.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import { logger } from "#lib/logger.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { writeFileAtomicBytes } from "#lib/writeAtomic.js";
import { parseTerminalShotForm, type TerminalShotForm } from "../../../visualEvidence/captureForms.js";
import { writeCaptureRecord } from "../../../visualEvidence/captureRecord.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import { renderTerminalShot } from "../../../visualEvidence/terminalShot.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

/**
 * Read and parse the form, or the exit code to return.
 *
 * @param form the form file's path
 * @returns the parsed form, or the exit code
 */
function loadForm({ form }: { form: string }): { readonly form: TerminalShotForm } | { readonly code: number } {
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `terminal-shot form at ${form}`, text: readFileSync(form, "utf8") });
  } catch (error) {
    logger.error({
      msg: `could not read the form at ${form}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { code: EXIT_USAGE };
  }
  const parsed = parseTerminalShotForm({ value: decoded });
  if (parsed.isErr()) {
    for (const line of visualEvidenceErrorLines({ error: parsed.error })) {
      logger.error({ msg: line });
    }
    return { code: EXIT_USAGE };
  }
  return { form: parsed.value };
}

/**
 * Run `browser terminal-shot`.
 *
 * @param form the form file's path
 * @param home the state home the capture receipt is filed under
 * @param capturedAtIso when the shot is taken
 * @param json whether machine-readable output was asked for
 * @returns the process exit code
 */
export async function runBrowserTerminalShot({
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
  const { textFile, out, label, lines } = loaded.form;
  let text: string;
  try {
    text = readFileSync(textFile, "utf8");
  } catch (error) {
    logger.error({ msg: `could not read ${textFile}: ${error instanceof Error ? error.message : String(error)}` });
    return EXIT_ERROR;
  }
  const shot = await renderTerminalShot({ capturedAtIso, label, out, range: lines, text });
  if (shot.isErr()) {
    for (const line of visualEvidenceErrorLines({ error: shot.error })) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  const { bytes, receipt } = shot.value;
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomicBytes({ bytes: Buffer.from(bytes), path: out });
  } catch (error) {
    logger.error({ msg: `could not write ${out}: ${error instanceof Error ? error.message : String(error)}` });
    return EXIT_ERROR;
  }
  const filed = writeCaptureRecord({ home, record: receipt });
  if (filed.isErr()) {
    rmSync(out, { force: true });
    logger.error({ msg: `${filed.error.message} — the picture was removed, since nothing could attach it` });
    return EXIT_ERROR;
  }
  const next = "open the picture, look at it, then record what you saw: slopweaver browser image-record --form <form>";
  if (json) {
    logger.out({ line: JSON.stringify({ next, out, receipt, receiptPath: filed.value }, null, 2) });
    return EXIT_OK;
  }
  const { artifact } = receipt.final;
  logger.out({ line: `terminal-shot: ${out}` });
  logger.out({ line: `  ${String(artifact.widthPx)}x${String(artifact.heightPx)}, ${artifact.digest}` });
  logger.out({
    line: `  capture receipt ${receipt.captureId}: ${String(receipt.frameText.items.length)} word(s) of frame text`,
  });
  logger.out({ line: `  ${next}, citing capture id ${receipt.captureId}` });
  return EXIT_OK;
}
