/**
 * The two tracks a fresh-cut finding may be accepted on, as one closed definition every reader shares: the
 * reviewed-residue entries, the verification report, its printed lines and the `fresh-cut accept` grammar.
 *
 * An `owner-address` finding is accepted by a visible session that READ the line and judged it a placeholder or no
 * address at all. Every other class is a word whose privacy only the owner can rule on, so it is accepted only on a
 * pointer to the owner's own turn: an owner anchor. The classes are derived from the private-term class list rather
 * than restated, so a class added there is an anchored class here without a second edit.
 *
 * A leaf on purpose: `./core.ts` and `./reviewedResidue.ts` both read it, and neither may import the other's half.
 */
import { z } from "zod";
import { PRIVATE_TERM_CLASSES, type PrivateTermClass } from "../hygiene/privateTerms.js";

/** The one class a reading session may accept on its own judgement. */
export const REVIEWED_RESIDUE_CLASS = "owner-address";

/** A class only the owner's anchor can accept. */
export type OwnerAnchoredClass = Exclude<PrivateTermClass, typeof REVIEWED_RESIDUE_CLASS>;

/**
 * Pure: whether a private-term class is accepted on an owner anchor rather than a reader's judgement.
 *
 * @returns true for every class but owner-address
 */
export function isOwnerAnchoredClass(className: PrivateTermClass): className is OwnerAnchoredClass {
  return className !== REVIEWED_RESIDUE_CLASS;
}

/** One anchored class, as an entry stores it: the private-term classes less the one a reader judges. */
export const ownerAnchoredClassSchema = z.enum(PRIVATE_TERM_CLASSES).exclude([REVIEWED_RESIDUE_CLASS]);

/** Every class accepted on an owner anchor, in the private-term list's order. */
export const OWNER_ANCHORED_CLASSES: readonly OwnerAnchoredClass[] = ownerAnchoredClassSchema.options;

/** How many findings of each anchored class one verification took out on an owner anchor. */
export type AcceptedOnAnchor = Readonly<Record<OwnerAnchoredClass, number>>;

/**
 * Every anchored class's count. A record keyed by an enum requires every key and refuses any other, so a report
 * cannot omit the class it accepted.
 */
export const acceptedOnAnchorSchema = z.record(ownerAnchoredClassSchema, z.number().int().nonnegative());

/**
 * Pure: a count of zero for every anchored class, built from the class list and read back through the schema.
 *
 * @returns the zeroed counts, one per class
 */
export function emptyAcceptedOnAnchor(): AcceptedOnAnchor {
  return acceptedOnAnchorSchema.parse(Object.fromEntries(OWNER_ANCHORED_CLASSES.map((className) => [className, 0])));
}
