/**
 * Decoding image bytes and naming them — the one place this domain touches an image library.
 *
 * ## `jimp`, and why not `sharp`
 *
 * `package.json` resolves `sharp` to `portal:./stubs/sharp`, whose export THROWS on invocation: the real
 * package is a native binary and this repo runs with `enableScripts: false`, so its platform binary never
 * gets wired up. That portal is repo-wide, so any module importing `"sharp"` gets the stub. `jimp` is pure
 * JavaScript with no native dependency and is already a direct dependency here — `src/proof/yarnWhy/`
 * uses it for the golden-proof compositor. Reproduce: `grep -n '"sharp"' package.json`, then
 * `sed -n 18,25p stubs/sharp/index.js`.
 *
 * ## No Jimp type crosses a boundary in this file, deliberately
 *
 * `src/proof/yarnWhy/compose.ts`'s header carries the finding this follows: Jimp's generic mixin types
 * make any NAME for an instance (`JimpInstance`, or a hand-rolled structural interface) compare as two
 * different types under this repo's `exactOptionalPropertyTypes` — even against itself. So every Jimp value
 * here stays inside the function that created it, and what leaves is plain data.
 *
 * ## The decode is what decides whether something IS an image
 *
 * Never the filename and never a caller's MIME claim: a PNG renamed `.txt` is still an image that would
 * render in Slack, and a `.png` holding a truncated header is not one. Both answers come from trying to
 * decode the bytes, which is also what produces the dimensions a record is checked against.
 *
 * A failure here is therefore "not an image THIS build can read", which is not the same as "not an image" —
 * the five codecs above leave a WebP, an AVIF, a HEIC and an SVG undecodable, and Slack renders all four.
 * So what an attachment that fails this decode IS gets decided next door, by `./attachmentKind.ts`, against
 * an allowlist of things that are positively not pictures. Nothing there overturns a successful decode:
 * `./prepareUploads.ts` calls this function first, precisely so it stays the thing that decides.
 */

import { createHash } from "node:crypto";
import { Jimp } from "jimp";

import { err, ok, type Result } from "#lib/result.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";
import type { ArtifactIdentity } from "./types.js";

/**
 * The `sha256:<hex>` name for some bytes.
 *
 * Its own function so the producer, admission and the upload boundary cannot drift into two spellings of
 * "the digest of this image" — the drift `answerDigestOf`'s header warns about for the answer's own digest.
 *
 * @param bytes the exact bytes about to be recorded or uploaded
 * @returns the digest, `sha256:` prefixed
 */
export function imageDigestOf({ bytes }: { bytes: Uint8Array }): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Decode bytes and report what they are, or why they are not an image.
 *
 * @param bytes the candidate image
 * @returns the artifact's identity, or why the bytes could not be decoded
 */
export async function identifyImageBytes({
  bytes,
}: {
  bytes: Uint8Array;
}): Promise<Result<ArtifactIdentity, VisualEvidenceError>> {
  const digest = imageDigestOf({ bytes });
  let width = 0;
  let height = 0;
  try {
    const image = await Jimp.fromBuffer(Buffer.from(bytes));
    width = image.width;
    height = image.height;
  } catch (error) {
    return err(VisualEvidenceErrors.bytesUndecodable({ byteLength: bytes.byteLength, cause: error }));
  }
  if (width <= 0 || height <= 0) {
    return err(VisualEvidenceErrors.emptyImage({ height, width }));
  }
  return ok({ digest, heightPx: height, widthPx: width });
}
