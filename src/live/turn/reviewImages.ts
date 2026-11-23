/**
 * The review packet's image inventory — the one place the packet touches the filesystem.
 *
 * Before this, the only trace of an attachment in the whole packet was its path, inside the fenced answer
 * JSON of section 3. A reviewer had a string. It could not tell which bytes that string named, so a verdict
 * about a picture could bind to nothing, and `../../admit/reviewVerdict.ts`'s `ReviewedImage` needs a digest
 * to bind to at all. The inventory is what supplies one.
 *
 * ## Every entry is READ, and an unreadable one stays in the list
 *
 * A failure is a row, not a dropped entry: a packet that silently omits an attachment it could not open
 * tells the reviewer there is nothing to look at, which is the failure mode this whole change closes. Each
 * path is read and decoded independently so one bad attachment cannot hide the others.
 *
 * There is no `existsSync` guard here, deliberately: it returns false for an unreadable path too, so a guard
 * on it reports "absent" for a file that is present and cannot be read — measured in this repository. The read
 * itself is the check.
 *
 * ## A digest in the packet is a starting point, not proof
 *
 * Printing a path beside a digest does not make a reviewer open the file, and nothing here can. What it does
 * is give the reviewer something to VERIFY against and the verdict something to bind to — the same limit
 * `../../visualEvidence/types.ts` states about `ImageRecord`: an attestation, checkable afterwards, never
 * evidence that eyes saw pixels.
 */

import { readFile } from "node:fs/promises";

import { visualEvidenceErrorLines } from "../../visualEvidence/evidenceErrors.js";
import { identifyImageBytes } from "../../visualEvidence/imageIo.js";
import type { ArtifactIdentity } from "../../visualEvidence/types.js";

/**
 * One attachment as the packet can describe it.
 *
 * A closed union rather than an optional identity: an entry either names bytes the reviewer can verify, or
 * says plainly that the file could not be read and why. There is no third state in which the packet prints
 * a digest it did not compute.
 */
export type ReviewPacketImage =
  | { readonly kind: "ready"; readonly path: string; readonly artifact: ArtifactIdentity }
  | { readonly kind: "unavailable"; readonly path: string; readonly issues: readonly string[] };

/**
 * Read and decode every image the answer names, in attach order.
 *
 * Sequential rather than `Promise.all` for `loadSlackUploads`'s reason — a parallel read reports whichever
 * rejected first, which is a race rather than an answer.
 *
 * @param paths the answer's `images`, in attach order
 * @returns one entry per path, in the same order, each either ready or unavailable
 */
export async function resolveReviewPacketImages({
  paths,
}: {
  paths: readonly string[];
}): Promise<readonly ReviewPacketImage[]> {
  const resolved: ReviewPacketImage[] = [];
  for (const path of paths) {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (error) {
      resolved.push({
        issues: [`could not be read: ${error instanceof Error ? error.message : String(error)}`],
        kind: "unavailable",
        path,
      });
      continue;
    }
    const identified = await identifyImageBytes({ bytes });
    if (identified.isErr()) {
      resolved.push({ issues: visualEvidenceErrorLines({ error: identified.error }), kind: "unavailable", path });
      continue;
    }
    resolved.push({ artifact: identified.value, kind: "ready", path });
  }
  return resolved;
}

/**
 * Whether any attachment in this inventory could not be read.
 *
 * @param images the resolved inventory
 * @returns true when at least one entry is unavailable
 */
export function hasUnavailableImage({ images }: { images: readonly ReviewPacketImage[] }): boolean {
  return images.some((image) => image.kind === "unavailable");
}
