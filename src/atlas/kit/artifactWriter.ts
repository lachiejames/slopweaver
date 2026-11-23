/**
 * The verified artifact writer every browser-walking atlas is given.
 *
 * ## Why the verification is here rather than in a walk
 *
 * A walk is pure over a transport seam and performs no I/O, so it cannot itself prove a PNG landed. It asks
 * for a writer and records what the writer says. What makes that honest is that this implementation READS
 * BACK what it wrote and compares the byte length and the SHA-256 before answering `ok` — the whole value of
 * a proof screenshot is that a reader can trust the bytes are the ones that were seen, and a write call that
 * returned without throwing is not that.
 *
 * A Codex pass named the alternative as a blocker, and it is the shape the earliest walks shipped: a missing
 * or unwritten PNG produced no artifact reference, no failure, and a coverage cell still stamped a success —
 * so a run that photographed nothing read exactly like one that photographed everything.
 *
 * ## Kit-owned because nothing in it is a platform's
 *
 * The Notion and Trelica walks had written these forty lines each, differing only in which atlas's `paths`
 * type they named — and the type was the only difference, since both resolve the same `directory` field.
 * What a platform still owns is the artifact's own relative PATH, which its store computes; this takes the
 * path already computed and only proves the bytes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import { writeAtomicBytes } from "../atlasFile.js";

import { type AtlasCaptureError, AtlasCaptureErrors, atlasCaptureErrorLines } from "./captureErrors.js";

/**
 * How one page screenshot is stored, and proved.
 *
 * An implementation must verify what it wrote rather than reporting success from the write call alone.
 *
 * @internal
 */
export type AtlasArtifactWriter = (input: { relativePath: string; bytes: Uint8Array; sha256: string }) => Result<null>;

/**
 * Build a writer that stores one page screenshot under an atlas's own directory and proves it landed.
 *
 * @param directory the atlas's generation directory, which every relative artifact path hangs off
 * @returns the writer a walk is given
 */
export function verifiedArtifactWriter({ directory }: { directory: string }): AtlasArtifactWriter {
  return ({ relativePath, bytes, sha256 }) => {
    const path = join(directory, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    const written = writeAtomicBytes({ bytes, path });
    if (written.isErr()) {
      return err(written.error);
    }
    return verifyReadBack({ bytes, path, relativePath, sha256 }).mapErr((error) => atlasCaptureErrorLines({ error }));
  };
}

/**
 * Read back what was just written and prove it is the capture: the same byte length, then the same SHA-256.
 *
 * @param path where the bytes were written
 * @param relativePath the artifact address a refusal names
 * @param bytes what was captured
 * @param sha256 the digest the artifact is addressed by
 * @returns nothing when the bytes on disk are the capture, or which check they failed
 */
function verifyReadBack({
  path,
  relativePath,
  bytes,
  sha256,
}: {
  path: string;
  relativePath: string;
  bytes: Uint8Array;
  sha256: string;
}): Result<null, AtlasCaptureError> {
  let readBack: Uint8Array;
  try {
    readBack = new Uint8Array(readFileSync(path));
  } catch (error: unknown) {
    return err(AtlasCaptureErrors.screenshotNotReadBack({ cause: error, relativePath }));
  }
  if (readBack.byteLength !== bytes.byteLength) {
    return err(
      AtlasCaptureErrors.screenshotSizeMismatch({
        captured: bytes.byteLength,
        onDisk: readBack.byteLength,
        relativePath,
      }),
    );
  }
  const stored = createHash("sha256").update(readBack).digest("hex");
  if (stored !== sha256) {
    return err(AtlasCaptureErrors.screenshotDigestMismatch({ expected: sha256, relativePath, stored }));
  }
  return ok(null);
}
