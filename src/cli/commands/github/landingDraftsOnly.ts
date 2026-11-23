/**
 * `github landing --drafts-only`: the supervisor tick's SECOND landing reading, which reads only the owner's drafts and
 * boards the ones nobody holds.
 *
 * ## Why drafts are a reading of their own rather than `--include-drafts` on the press read
 *
 * MEASURED: four of the owner's drafts sat red for days. The tick's press read excludes drafts, and the
 * `hygiene-sweep` row meant to read them was absent from the store (`automation list`). Folding drafts into the
 * press read fails on one property, each case a sharper counterexample: a draft takes a register-cap slot, a
 * hundred recent drafts fill `--limit` ahead of an older ready row, and draft-only pages spend the fleet read's
 * time budget before the non-drafts arrive. One combined read couples the press path to how many drafts the
 * owner has. A separate reading — its own server-side `draft:true` query,
 * its own process, its own timeout — leaves the press read byte-for-byte what it was and fails on its own.
 *
 * It takes `--if-due` on a ration of its own (`../../../review/readJournal.ts`'s `DRAFTS_ONLY_SUFFIX`), and refuses
 * `--press` (a draft has no button) and `--record-reading` (the ledger is the console's whole picture of the owner's
 * pull requests, never a drafts slice).
 */

/** The flags `--drafts-only` refuses beside it, with the reason each one is refused. */
const DRAFTS_ONLY_REFUSES: readonly { readonly flag: string; readonly why: string }[] = [
  { flag: "press", why: "a draft has no button to press" },
  {
    flag: "record-reading",
    why: "the readings ledger holds the whole picture of the owner's pull requests, never a drafts slice",
  },
];

/**
 * The usage problems `--drafts-only` adds.
 *
 * @param values the parsed flag values
 * @returns one problem per refused flag present, in {@link DRAFTS_ONLY_REFUSES}'s order; none without the flag
 */
export function draftsOnlyProblems({ values }: { values: Readonly<Record<string, unknown>> }): readonly string[] {
  if (values["drafts-only"] !== true) {
    return [];
  }
  return DRAFTS_ONLY_REFUSES.filter(({ flag }) => values[flag] !== undefined && values[flag] !== false).map(
    ({ flag, why }) => `--drafts-only cannot be combined with --${flag}: ${why}`,
  );
}
