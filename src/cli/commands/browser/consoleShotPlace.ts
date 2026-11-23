/**
 * Where `browser console-shot` puts its picture and its receipt, and the one `--out` it refuses before building anything.
 *
 * The picture is staged beside `--out` and moved into place only once its receipt is filed, so a receipt that cannot be
 * written leaves whatever `--out` already held, and the receipt naming it, exactly as they were. A move that then fails
 * withdraws the receipt it just filed, unless an earlier capture of these same bytes had filed it, so no receipt is left
 * naming bytes `--out` lacks. Both the staging write and the move are the atomic-write module's, so each is durable
 * as well as atomic (`#lib/writeAtomic.js`).
 */
import { existsSync, rmSync, statSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { renameStagedFile, writeFileAtomicBytes } from "#lib/writeAtomic.js";
import { type CaptureReceipt, captureRecordPath, writeCaptureRecord } from "../../../visualEvidence/captureRecord.js";
import { type ConsoleShotError, ConsoleShotErrors } from "../../../visualEvidence/consoleShotErrors.js";

/**
 * Refuse an `--out` that already exists as something other than a file, which a picture can never replace.
 *
 * @returns nothing, or the refusal
 */
export function refuseNonFileOut({ out }: { out: string }): Result<null, ConsoleShotError> {
  if (existsSync(out) && !statSync(out).isFile()) {
    return err(ConsoleShotErrors.outNotAFile({ out }));
  }
  return ok(null);
}

/**
 * Stage the picture, file its receipt, then move the picture onto `--out`.
 *
 * @param home the state home the receipt is filed under
 * @param receipt the receipt naming the picture's bytes at `out`
 * @param bytes the picture
 * @returns the receipt's path, or the failure, with `--out` and the receipts as they were
 */
export function placeConsoleShot({
  home,
  receipt,
  bytes,
  out,
}: {
  home: string;
  receipt: CaptureReceipt;
  bytes: Uint8Array;
  out: string;
}): Result<string, ConsoleShotError> {
  const staged = `${out}.${receipt.captureId}.partial`;
  const receiptStood = existsSync(captureRecordPath({ captureId: receipt.captureId, home }));
  try {
    writeFileAtomicBytes({ bytes: Buffer.from(bytes), path: staged });
  } catch (error) {
    rmSync(staged, { force: true });
    return err(ConsoleShotErrors.imageFailed({ detail: error instanceof Error ? error.message : String(error) }));
  }
  const filed = writeCaptureRecord({ home, record: receipt });
  if (filed.isErr()) {
    rmSync(staged, { force: true });
    return err(ConsoleShotErrors.imageFailed({ detail: `${filed.error.message}; --out was left as it was` }));
  }
  try {
    renameStagedFile({ flushDirectory: true, from: staged, to: out });
  } catch (error) {
    rmSync(staged, { force: true });
    if (!receiptStood) {
      rmSync(filed.value, { force: true });
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err(ConsoleShotErrors.imageFailed({ detail: `${detail}; --out was left as it was` }));
  }
  return ok(filed.value);
}
