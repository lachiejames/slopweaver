/**
 * The shape one family's rows of the help-truth tables take, and the merge that assembles every slice into the
 * `GUARDED`, `PROBES` and `PARSERS` tables `../helpTruth.test.ts` sweeps. `UNGUARDED` stays a literal in the
 * test itself, because the `help-flag-opt-out` gate reads it there.
 *
 * The tables were one object literal each until they reached 10,415 code lines in one file. A literal refuses a
 * duplicate key at compile time; a merge of slices would let a later slice's row silently replace an earlier
 * one, so {@link mergeSlices} returns every address it saw twice and the test asserts that list is empty.
 */

import { type Result } from "../../../../lib/result.js";

/** One guarded verb's real parser, fed a probe fragment. */
type HelpTruthParser = (args: { fragment: readonly string[] }) => Result<unknown>;

/** One noun's (or one verb run's) rows of each table; a slice states only the tables it has rows in. */
export interface HelpTruthSlice {
  /** Address to the flags its parser accepts, which the usage must advertise exactly. */
  readonly guarded?: Readonly<Record<string, readonly string[]>>;
  /** Address to flag to a valid invocation that exercises that flag. */
  readonly probes?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /** Address to the parser a guarded verb is probed against. */
  readonly parsers?: Readonly<Record<string, HelpTruthParser>>;
}

/**
 * Merge one table out of every slice, keeping the first row for an address and recording each later one.
 *
 * @param slices every slice, in a fixed order
 * @param pick which of a slice's tables to merge
 * @returns the merged table, and every address defined in more than one slice
 */
export function mergeSlices<T>({
  slices,
  pick,
}: {
  slices: readonly HelpTruthSlice[];
  pick: (slice: HelpTruthSlice) => Readonly<Record<string, T>> | undefined;
}): { readonly table: Readonly<Record<string, T>>; readonly duplicates: readonly string[] } {
  // A Map, not an object, so no address — `__proto__` included — can reach a prototype setter and slip past
  // the duplicate check; `Object.fromEntries` then defines every key as an own property.
  const table = new Map<string, T>();
  const duplicates: string[] = [];
  for (const slice of slices) {
    const rows = pick(slice);
    if (rows === undefined) {
      continue;
    }
    for (const [address, row] of Object.entries(rows)) {
      if (table.has(address)) {
        duplicates.push(address);
        continue;
      }
      table.set(address, row);
    }
  }
  return { duplicates: duplicates.toSorted(), table: Object.fromEntries(table) };
}
