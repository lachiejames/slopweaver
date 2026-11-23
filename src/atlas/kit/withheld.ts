/**
 * Turn what a projection removed into something a reader of coverage is actually told.
 *
 * ## The gap this closes
 *
 * A projection that reports its removals and is consulted by nothing makes three things invisible at once,
 * and each is a different failure: a reader cannot tell that a generation deliberately withholds a private
 * key from every record of a family, so the atlas looks as though the provider never returned one; a
 * depth-bound truncation — which is a defect, not a policy — reads exactly like a designed drop; and an
 * unexpected VOLUME of drops, which is precisely the drift the named-denial design exists to make visible,
 * passes unnoticed because no number was ever published.
 *
 * The same honesty rule already governs excluded endpoints: an operation an atlas refuses to call still
 * appears in its inventory rather than vanishing from it. A withheld FIELD gets the same treatment.
 *
 * ## Counts and names, never values
 *
 * A summary names the FIELD and counts the positions. It never carries the removed value, and it never
 * carries a pointer for a secret drop beyond the field name at its tail — a JSON pointer into a record can
 * itself identify the record, and there is no reason coverage needs that to say what was withheld.
 * `depth-limit` pointers ARE kept whole, because they are a defect handle rather than a disclosure: the
 * position is the only thing that makes a truncated document findable again.
 *
 * ## Kit-owned for the same reason `projection.ts` is
 *
 * Two atlases had written this file, byte-for-byte apart from their type names, and the clone ratchet
 * caught the second copy. Nothing in it is platform-specific: the two denial reasons are kit vocabulary
 * (`AtlasDenialReason`), and so is what a truncation means.
 */
import type { AtlasDroppedField } from "./projection.js";

/**
 * What one generation withheld, and whether anything went wrong while withholding it.
 * @internal
 */
export interface AtlasWithholding {
  /** Distinct field names withheld as secret material, sorted. */
  readonly secretFields: readonly string[];
  /** How many positions were withheld as secret material. */
  readonly secretPositions: number;
  /** How many ephemeral request-scoped handles were dropped. */
  readonly ephemeralPositions: number;
  /** Pointers where the walk hit its depth bound — a defect signal, not a designed removal. */
  readonly truncatedAt: readonly string[];
}

/**
 * The field name a pointer ends in — everything after the last separator, decoded. The projection escapes each
 * segment per RFC 6901 (`~` → `~0`, `/` → `~1`), so the last token is undone in the reverse order: `~1` first,
 * then `~0`, which is what keeps a field literally named `~1` from decoding to `/`.
 */
function fieldOf({ pointer }: { pointer: string }): string {
  return pointer
    .slice(pointer.lastIndexOf("/") + 1)
    .replaceAll("~1", "/")
    .replaceAll("~0", "~");
}

/**
 * Summarise every removal one projection pass made.
 *
 * @param dropped every removal, from one record or from a whole family folded together
 * @returns the counts and field names coverage publishes
 */
export function summariseWithholding({ dropped }: { dropped: readonly AtlasDroppedField[] }): AtlasWithholding {
  const secret = dropped.filter((drop) => drop.reason === "secret-material");
  return {
    ephemeralPositions: dropped.filter((drop) => drop.reason === "ephemeral-token").length,
    secretFields: [...new Set(secret.map((drop) => fieldOf({ pointer: drop.pointer })))].toSorted(),
    secretPositions: secret.length,
    truncatedAt: dropped
      .filter((drop) => drop.reason === "depth-limit")
      .map((drop) => drop.pointer)
      .toSorted(),
  };
}

/**
 * Whether this summary carries a defect rather than only designed removals.
 *
 * @param withholding the summary to judge
 * @returns `true` when the walk truncated a document, which no coverage state may report as `synced`
 */
export function withholdingIsTruncated({ withholding }: { withholding: AtlasWithholding }): boolean {
  return withholding.truncatedAt.length > 0;
}

/**
 * The English a coverage cell carries, so a reader learns what the generation does not hold.
 *
 * Written as a positive statement rather than an apology: the fields below are absent BY DECISION, and a
 * cell that says so is the difference between an atlas that withheld a private key and one that never saw
 * it.
 *
 * @param withholding the summary to describe
 * @returns one sentence, or the empty string when nothing was removed at all
 */
export function withholdingSentence({ withholding }: { withholding: AtlasWithholding }): string {
  const parts: string[] = [];
  if (withholding.secretPositions > 0) {
    parts.push(
      `withheld ${String(withholding.secretPositions)} secret-material position(s) at the boundary, across the field(s) ${withholding.secretFields.join(", ")}`,
    );
  }
  if (withholding.ephemeralPositions > 0) {
    parts.push(`dropped ${String(withholding.ephemeralPositions)} ephemeral request-scoped handle(s)`);
  }
  if (withholding.truncatedAt.length > 0) {
    parts.push(
      `TRUNCATED ${String(withholding.truncatedAt.length)} document position(s) at the depth bound — this is a defect signal, not a policy: ${withholding.truncatedAt.join(", ")}`,
    );
  }
  return parts.join("; ");
}
