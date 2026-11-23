/**
 * One value per kind, keyed by that kind — the record every atlas builds from its own exhaustive kind list.
 *
 * Every atlas once built this inline as `Object.fromEntries(KINDS.map(...)) as Record<Kind, Value>`, because
 * `Object.fromEntries` widens its keys to `string`, and that assertion rested on a comment saying the list was
 * exhaustive. Two things replace the comment. Every atlas declares its kind union AS its list
 * (`type Kind = (typeof KINDS)[number]`), so `TKind` inferred from `kinds` is exactly the listed kinds; and
 * the record is filled one kind at a time and handed back only once a type guard has confirmed each listed
 * kind is present — no assertion anywhere. Passing an explicit `TKind` wider than the list is the one way to
 * make the result claim more than it holds.
 */

/**
 * Build a record holding one value for every kind in the list.
 *
 * @param kinds the platform's own EXHAUSTIVE kind list; a kind missing here is missing from the record
 * @param valueFor produces the value stored under one kind
 * @returns a record keyed by every kind in the list
 */
export function recordPerKind<TKind extends string, TValue>({
  kinds,
  valueFor,
}: {
  kinds: readonly TKind[];
  valueFor: (args: { kind: TKind }) => TValue;
}): Record<TKind, TValue> {
  const record: Partial<Record<TKind, TValue>> = {};
  for (const kind of kinds) {
    record[kind] = valueFor({ kind });
  }
  const coversEveryKind = (candidate: Partial<Record<TKind, TValue>>): candidate is Record<TKind, TValue> =>
    kinds.every((kind) => Object.hasOwn(candidate, kind));
  if (!coversEveryKind(record)) {
    throw new Error("recordPerKind: a listed kind is missing from the record it just filled");
  }
  return record;
}
