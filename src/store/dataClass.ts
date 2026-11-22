/**
 * The data classes: one closed vocabulary saying how far a stored record may travel beyond the owner.
 *
 * The owner ruled the frame: keep and classify everything at intake and discard nothing; rules do the
 * sorting of incoming data; an AI assessment is used for personal material; the classes are Public, Internal,
 * Personal and Restricted, agreed in principle. This module is the vocabulary and the read rule a consumer goes
 * through. It names no installation, person or organisation: an installation's own sorting rules live in its state
 * home, never here.
 *
 * ## The unit of classification is ONE STORED RECORD
 *
 * A class belongs to one row: one `content` row, one `owner_capture` row, one `owner_turn` body. The owner's scheme
 * classes by passage, and the store holds no passages, so a record carries the HIGHEST class of any passage in it.
 * A source, a container, a channel, a home folder or a register is never classified and never lends its class to
 * the rows inside it. Those are facts a sorting rule may READ ("this row came from a direct message"), so two rows in
 * the same container can carry different classes. The reason is the failure the other shape has: a folder-level
 * class is either too loose for the most private record in it or too tight for the rest, and nothing about a record
 * says which.
 *
 * ## Four classes and an unknown state that fails closed
 *
 * - `public` — may be surfaced beyond the owner, by the bot or a session answering someone else, within what the
 *   record's own source access (`visibility`) already permits. It is NOT outbound clearance: what actually leaves
 *   the machine is the outbound privacy check's call, which reads the content itself.
 * - `internal` — work material and bulk automated input (newsletters, receipts, automated senders). Not surfaced
 *   beyond the owner yet: the owner's ruling is to start strict and approve narrow exceptions, so widening it is one
 *   reviewed change to {@link CLASSES_REACHING_BEYOND_OWNER}.
 * - `personal` — personal material, which an AI assessment classifies. Never surfaced beyond the owner.
 * - `restricted` — the owner's alone. The owner's own sessions may read it (the owner's ruling: the fleet may view
 *   everything, and the only boundary is what goes OUT), but nothing surfaces it to anyone else: not the bot, not a
 *   post, not a pull request.
 * - `unknown` — nobody has classified it yet. Every reader treats it EXACTLY as `restricted`, while the stored value
 *   stays distinct so a census can count what is still unclassified. A record the store holds with no class at all
 *   (every row written before classification existed) reads as `unknown` ({@link effectiveDataClass}) until
 *   `store classify` (`./resolveDataClasses.ts`) writes it an explicit class.
 *
 * `private` is deliberately not a class name: it already names the other half of `visibility`, the source's own
 * access axis, which this one only ever narrows.
 */

/** Every data class, from the widest reach to the narrowest; `unknown` is read as `restricted`. */
export const DATA_CLASSES = ["public", "internal", "personal", "restricted", "unknown"] as const;

/** One data class. */
export type DataClass = (typeof DATA_CLASSES)[number];

/**
 * The classes a record may be surfaced beyond the owner in. `public` alone, by the owner's start-strict ruling;
 * widening it to `internal` is this one line. Module-private, so no caller can add to it at run time: it is read only
 * through {@link reachesBeyondOwner}.
 */
const CLASSES_REACHING_BEYOND_OWNER: ReadonlySet<DataClass> = new Set<DataClass>(["public"]);

/**
 * The class a reader acts on, given what the store holds for a record.
 *
 * A record with no stored class is `unknown`, by an explicit branch rather than a fallback, so a row written before
 * classification existed can never read as `public`.
 *
 * @param stored the record's stored class, or null/undefined when the store holds none
 * @returns the stored class, or `unknown` when there is none
 */
export function effectiveDataClass({ stored }: { stored: DataClass | null | undefined }): DataClass {
  if (stored === null || stored === undefined) {
    return "unknown";
  }
  return stored;
}

/**
 * Whether a record of this class may be surfaced to anyone other than the owner.
 *
 * True for `public` only: `internal`, `personal`, `restricted`, `unknown` and an absent class are all refused. A
 * caller asks this rather than comparing class names itself, so a class added later is refused by every caller until
 * {@link CLASSES_REACHING_BEYOND_OWNER} says otherwise.
 *
 * @param stored the record's stored class, or null/undefined when the store holds none
 * @returns true only when the effective class is one that reaches beyond the owner
 */
export function reachesBeyondOwner({ stored }: { stored: DataClass | null | undefined }): boolean {
  return CLASSES_REACHING_BEYOND_OWNER.has(effectiveDataClass({ stored }));
}
