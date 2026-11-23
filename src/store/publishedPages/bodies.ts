/**
 * Folding the bodies a write claims into one row per digest, shared by the two things that plan a write: the folder
 * import (`./project.ts`) and a publish or freeze written straight to the store (`./writePlan.ts`). A body is keyed by
 * its bytes alone while its media type comes from a file's extension, so the same bytes claimed under two types are
 * refused rather than stored as whichever came first.
 */
import { type PublishedPagesImportError, PublishedPagesImportErrors } from "./errors.js";
import { publishedPageMediaType, UNSERVED_MEDIA_TYPE } from "./mediaType.js";
import type { PlannedBlob } from "./project.js";

/** One body as a file carries it, before bodies are folded. */
export interface BodyClaim {
  readonly sha256: string;
  readonly bytes: Buffer;
  readonly mediaType: string;
  /** Where the claim came from, for a conflict's refusal. */
  readonly path: string;
}

/**
 * The type a page file's body is stored as: what a reader serves it as, or opaque bytes when none does.
 *
 * @param relativePath the path under the page
 * @returns a MIME essence
 */
export function storedMediaType({ relativePath }: { relativePath: string }): string {
  const served = publishedPageMediaType({ relativePath });
  if (served === undefined) {
    return UNSERVED_MEDIA_TYPE;
  }
  return served;
}

/**
 * One body per digest, gathering a refusal for every claim of a digest under a second type.
 *
 * @param claims every file's claim, pages and versions
 * @param refusals where each conflict is gathered
 * @returns the distinct bodies in digest order, each as its first claim typed it
 */
export function foldBodies({
  claims,
  refusals,
}: {
  claims: readonly BodyClaim[];
  refusals: PublishedPagesImportError[];
}): readonly PlannedBlob[] {
  const first = new Map<string, BodyClaim>();
  for (const claim of claims) {
    const held = first.get(claim.sha256);
    if (held === undefined) {
      first.set(claim.sha256, claim);
    } else if (held.mediaType !== claim.mediaType) {
      refusals.push(
        PublishedPagesImportErrors.bodyMediaConflict({
          paths: [`${held.path} (${held.mediaType})`, `${claim.path} (${claim.mediaType})`],
          sha256: claim.sha256,
        }),
      );
    }
  }
  return [...first.values()]
    .map(({ bytes, mediaType, sha256 }) => ({ byteLength: bytes.length, bytes, mediaType, sha256 }))
    .toSorted((a, b) => a.sha256.localeCompare(b.sha256));
}
