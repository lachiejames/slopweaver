/**
 * The Automations page's paused rows, split by whose pause it is. Only a pause whose fix is the owner's reads "paused
 * by you": an owner hold no word of the owner's names carries the fleet as its fixer
 * (`src/automations/brokenAccount.ts`), and headlining it as the owner's is a misattribution. Pure.
 */

/** The one slice of a row this split reads. */
interface PausableRow {
  readonly account?: { readonly state: string; readonly fix: { readonly by: string } } | undefined;
}

/**
 * Split the paused rows into the owner's own pauses and the holds nobody the owner can see chose.
 *
 * @param automations every row the page shows, any order
 * @returns the paused rows whose fix is the owner's, then every other paused row, each in the order given
 */
export function pausedBy<T extends PausableRow>({
  automations,
}: {
  automations: readonly T[];
}): {
  readonly byOwner: readonly T[];
  readonly unowned: readonly T[];
} {
  const paused = automations.filter((automation) => automation.account?.state === "paused");
  return {
    byOwner: paused.filter((automation) => automation.account?.fix.by === "you"),
    unowned: paused.filter((automation) => automation.account?.fix.by !== "you"),
  };
}
