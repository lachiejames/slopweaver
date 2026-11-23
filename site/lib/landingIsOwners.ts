import type { Landing } from "../components/live/readLanding";

/**
 * Whether a landing reading is the owner's to draw Queue cards from: every reading but one whose own `selection` says it was
 * taken over another author, or every author. `github landing --record-reading` refuses that read, and a ledger
 * that kept one earlier would ask the owner to name a reviewer for a colleague's
 * pull request. A document older than the `selection` field predates every recorder but
 * `@me`, so it still draws.
 *
 * @param landing the landing document the Queue would draw from
 * @returns `false` when the document says it is not the owner's pull requests
 */
export function landingReadingIsOwners({ landing }: { landing: Landing }): boolean {
  if (landing.selection === undefined) {
    return true;
  }
  return landing.selection.author?.toLowerCase() === "@me";
}
