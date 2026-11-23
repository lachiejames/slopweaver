/**
 * The check that binds `write vanta upload-policy-version`'s approval to the bytes it actually attaches.
 *
 * The approved digest covers `plan.pdfSha256`, the hash of the PDF as it was rendered in memory. The browser
 * arm attaches a PATH, so the file written there is re-read inside the door and compared against that hash
 * before any browser is touched. What stays open is the gap between this read and Playwright's own read of
 * the same path: closing it means handing the relay the bytes rather than a path, which needs a binary channel
 * the relay does not have (`src/browser/relayRun.ts` emits one generated function expression).
 */
import { sha256Hex } from "#lib/hash.js";
import { err, ok, type Result } from "#lib/result.js";

import { type VantaPolicyUploadPdfChangedError, VantaVerbErrors } from "./errors.js";

/**
 * Whether the PDF bytes read back from disk are the ones the approved plan was hashed from.
 *
 * @param bytes what the staged file holds now
 * @param expectedSha256 the plan's `pdfSha256`, which the approved digest covers
 * @param path where the bytes were read from, named in the refusal
 * @returns the same bytes when they hash to the approved value, or the mismatch carrying both hashes
 */
export function verifyPolicyUploadPdf({
  bytes,
  expectedSha256,
  path,
}: {
  bytes: Uint8Array;
  expectedSha256: string;
  path: string;
}): Result<Uint8Array, VantaPolicyUploadPdfChangedError> {
  const actualSha256 = sha256Hex({ bytes });
  if (actualSha256 !== expectedSha256) {
    return err(VantaVerbErrors.policyUploadPdfChanged({ actualSha256, expectedSha256, path }));
  }
  return ok(bytes);
}
