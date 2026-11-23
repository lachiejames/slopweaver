/**
 * The shape of the generated Hex specification lock.
 *
 * Hand-written and kept beside the generator's output rather than inside it, so the TYPE is reviewable
 * independently of the row that satisfies it — a generated file nobody reads is a poor place to discover
 * that a field changed meaning.
 *
 * ## Why there is exactly ONE pin here, where the sibling Twilio lock has sixty
 *
 * Twilio serves a document per product from a subdomain per product, so its lock is a catalogue and its
 * pins carry hosts. Hex publishes one OpenAPI document describing one API on one origin, so a catalogue
 * shape here would be ceremony: the lock is an array of one because `kit/pinnedSpec.ts` compiles arrays,
 * not because Hex might grow a second document — and if it does, this file needs no change at all.
 */

/** The published Hex API definition, pinned by digest. */
export interface HexSpecPin {
  readonly byteLength: number;
  /** The origin its operations answer on, from the document's own `servers`. */
  readonly hosts: readonly string[];
  /** This atlas's own id for the document. The provider id every `api` row and every citation uses. */
  readonly id: string;
  readonly operationCount: number;
  readonly pathCount: number;
  /** Every security scheme its operations require, sorted — which credential reaches this API. */
  readonly securitySchemes: readonly string[];
  readonly sha256: string;
  /** `info.title` as Hex writes it. */
  readonly title: string;
  /** The only address ever fetched. No caller supplies one. */
  readonly url: string;
  /** `info.version` as Hex writes it. */
  readonly version: string;
}
