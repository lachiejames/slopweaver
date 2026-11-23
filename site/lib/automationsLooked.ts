/**
 * The Automations page's "since you last looked": how many of a row's failures landed after the moment the owner last
 * had the page in front of them. A floating note per automation failure overwhelms, so a
 * failure is READ here as the row's state plus this count, never pushed. Pure; the mark itself is kept by
 * `components/live/useLastLooked.ts`.
 */

/** The `localStorage` key the mark lives under, one per browser like the theme. */
export const LAST_LOOKED_KEY = "sw-automations-last-looked";

/**
 * How many break instants fall strictly after the mark.
 *
 * @param brokeAtIsos when each failed or dead firing settled, any order
 * @param lookedIso the moment the owner last looked; an unparsable mark counts nothing rather than everything
 * @returns the count of breaks the owner has not seen
 */
export function breaksSince({ brokeAtIsos, lookedIso }: { brokeAtIsos: readonly string[]; lookedIso: string }): number {
  const looked = Date.parse(lookedIso);
  if (Number.isNaN(looked)) {
    return 0;
  }
  return brokeAtIsos.filter((iso) => Date.parse(iso) > looked).length;
}
