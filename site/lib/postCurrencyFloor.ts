/**
 * The instant a parked post's Queue card is floored at: when its current words were written. The producer computes the
 * same instant off the folded register (`src/outbound/slack/draftRevision.ts` `wordsWrittenIso`), and the reading's
 * row joins this card only when the two match byte for byte (`./cardCurrencyHalves.ts`).
 */

import type { DraftComparisonView } from "../components/live/readDraftComparison";
import type { DraftVersionView } from "../components/live/readDraftVersions";
import type { ParkedDraft } from "../components/live/readSlackDrafts";

/**
 * When the post's current words were written: its newest version once the voice revised it, else the owner's pick between the
 * original and Codex's draft, else its park. Flooring at the park instead counts the very words the owner said to rework it as
 * said since, so a reworked draft's steers half could never pass.
 *
 * @param post the fields that date the words
 * @returns the floor
 */
export function postCurrencyFloorIso({
  post,
}: {
  post: Pick<ParkedDraft, "tsIso"> & {
    readonly comparison?: Pick<DraftComparisonView, "pick"> | undefined;
    readonly versions?: readonly Pick<DraftVersionView, "atIso">[] | undefined;
  };
}): string {
  const newest = post.versions?.at(-1);
  if (newest !== undefined) {
    return newest.atIso;
  }
  const pick = post.comparison?.pick;
  if (pick !== undefined) {
    return pick.atIso;
  }
  return post.tsIso;
}
