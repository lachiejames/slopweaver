/**
 * Which live standing asks an imported one meets, and so whether it can be restored without a conflict. Pure.
 *
 * A standing ask is identified by its id AND by the cards it covers: the store holds at most one active ask per
 * card. So an imported ask meets a live one under its own id, and also every live ask under ANOTHER id that covers
 * a card it covers. Taking the imported ask would have to stop all of those, so that is a conflict question, never an
 * activation one, and the owner decides it. Every live ask it meets goes into ONE question, never one per overlap.
 */
import type { RetainedEntry } from "./retained.js";

/**
 * One live standing ask an imported one meets.
 *
 * @internal reached as {@link standingAskRelations}'s result, never named outside this file
 */
export interface StandingAskRelation {
  /** The live ask's id. */
  readonly key: string;
  readonly fingerprint: string;
  readonly summary: string;
  /** Whether the live ask is under the imported ask's own id. */
  readonly sameKey: boolean;
  /** The cards both cover, sorted. Empty for a live ask under the same id that covers none of the imported ask's cards. */
  readonly overlaps: readonly string[];
}

/** Code-unit order, which no runtime locale moves. */
function byCodeUnit({ left, right }: { left: string; right: string }): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The cards one standing-ask entry covers. Only `standingAskEntries` builds a standing-ask entry, and it always
 * sets them (its unit test asserts it), so an entry without them is an invariant broken, never an empty set: an
 * empty set would read as an ask meeting nothing and wave a conflict through.
 */
function coversOf({ entry }: { entry: RetainedEntry }): readonly string[] {
  return entry.covers!;
}

/**
 * Every live standing ask the imported one meets: the one under its own id, and each under another id covering a
 * card it covers. They are sorted by id, so the same two sides give the same list in any input order.
 *
 * @param row the imported ask
 * @param live the live store's active asks, by id
 * @returns the asks it meets, each with the cards both cover
 */
export function standingAskRelations({
  row,
  live,
}: {
  row: RetainedEntry;
  live: ReadonlyMap<string, RetainedEntry>;
}): readonly StandingAskRelation[] {
  const covers = new Set(coversOf({ entry: row }));
  const relations: StandingAskRelation[] = [];
  for (const there of live.values()) {
    const overlaps = coversOf({ entry: there })
      .filter((coverage) => covers.has(coverage))
      .toSorted((left, right) => byCodeUnit({ left, right }));
    const sameKey = there.key === row.key;
    if (sameKey || overlaps.length > 0) {
      relations.push({ fingerprint: there.fingerprint, key: there.key, overlaps, sameKey, summary: there.summary });
    }
  }
  return relations.toSorted((left, right) => byCodeUnit({ left: left.key, right: right.key }));
}

/**
 * What an imported standing ask is to the store: `new` when it meets no live ask, `identical` when the only one it
 * meets is the same ask under its own id, and `conflicting` otherwise.
 *
 * @param row the imported ask
 * @param relations every live ask it meets
 * @returns its status
 */
export function standingAskStatus({
  row,
  relations,
}: {
  row: RetainedEntry;
  relations: readonly StandingAskRelation[];
}): "new" | "identical" | "conflicting" {
  if (relations.length === 0) {
    return "new";
  }
  const [only] = relations;
  if (relations.length === 1 && only!.key === row.key && only!.fingerprint === row.fingerprint) {
    return "identical";
  }
  return "conflicting";
}

/** Why one live ask is in the question: under the same id, sharing cards, or both. */
function relationReason({ relation }: { relation: StandingAskRelation }): string {
  const reasons: string[] = [];
  if (relation.sameKey) {
    reasons.push("same id");
  }
  if (relation.overlaps.length > 0) {
    reasons.push(`shares ${relation.overlaps.join(", ")}`);
  }
  return reasons.join(", ");
}

/**
 * The live side of a standing-ask conflict as the entries its question shows, each naming why it is there: the
 * same id, the cards it shares, or both.
 *
 * @param relations every live ask the imported one meets
 * @returns one entry per live ask, in id order
 */
export function standingAskConflictSides({
  relations,
}: {
  relations: readonly StandingAskRelation[];
}): readonly RetainedEntry[] {
  return relations.map((relation) => ({
    fingerprint: relation.fingerprint,
    key: relation.key,
    summary: `${relation.summary} (${relationReason({ relation })})`,
  }));
}

/**
 * The live side's identity a standing-ask conflict's question id binds: every live ask it meets, its content and
 * the cards both cover. A change to any of them is a different question.
 *
 * @param relations every live ask the imported one meets
 * @returns the canonical value
 */
export function standingAskConflictIdentity({
  relations,
}: {
  relations: readonly StandingAskRelation[];
}): readonly { readonly key: string; readonly fingerprint: string; readonly overlaps: readonly string[] }[] {
  return relations.map(({ key, fingerprint, overlaps }) => ({ fingerprint, key, overlaps }));
}
