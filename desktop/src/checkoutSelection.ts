/**
 * What the clone folder picker's answer means, as a pure decision. `checkoutSelectionShell.ts` opens the picker and
 * acts on this.
 */

/**
 * The folder the picker chose, or `undefined` when it chose none: a cancel, or an answer naming no folder. Neither is
 * an error, so neither redraws the note or retries the console.
 *
 * @param canceled whether the picker was dismissed
 * @param filePaths what it chose; one folder at most, the picker allowing no multiple selection
 * @returns the chosen folder's path as the picker gave it
 */
export function chosenFolder({
  canceled,
  filePaths,
}: {
  canceled: boolean;
  filePaths: readonly string[];
}): string | undefined {
  if (canceled) {
    return undefined;
  }
  return filePaths[0];
}
