/**
 * The queue's rows for the landing register: one per pull request of the owner's still missing their word. Split from
 * `./queueRows.ts`, which folds every register into one list, so that file stays under the 300-line cap.
 */

import type { BoardRow } from "../components/live/read";
import type { LandingReading, LandingRow } from "../components/live/readLanding";
import type { Reviewers } from "../components/live/readReviewers";
import type { LiveState } from "../components/live/useLive";
import { briefingCardForm } from "./briefingCardForm";
import { landingReadingIsOwners } from "./landingIsOwners";
import { prCardKeyOf } from "./prCardKey";
import { NAME_THE_REVIEWER, needsOwnerRows } from "./prNeedsOwner";
import { prProvenanceOf } from "./provenance";
import type { BriefingCard } from "./queueCard";
import { nameTheReviewerCard, prCard } from "./queueCardPull";
import { belongingRowSource } from "./queueCardSource";
import { placedIn, whatAndLeanOf } from "./queueRowFields";
import type { QueueRow } from "./queueRows";
import type { QueueTags } from "./queueTagsInherited";
import { prPlacement } from "./registerPlacementDirect";
import { waitingTierOf } from "./waitingRank";
import type { WorkspacePlacer } from "./workspacePlacement";

/**
 * The landing rows that are the owner's, in the order the register draws them — `needsOwnerRows` (`./prNeedsOwner.ts`) is the
 * whole rule, the same one the pull-requests page accents its cards by, so the two surfaces cannot
 * disagree about whether the owner's word is still missing. When a pick's park failed, the approve said so at the press,
 * and the page still draws the pick with no ask seen; the question this card asks, who, is answered either way.
 *
 * @param reviewers the reviewer reading, which withdraws nothing until it is ready
 * @returns the rows, each with the card that asks for its missing word, whether that word is a reviewer's name, and
 *   the record values its what and lean are drawn from
 */
function ownerLandingRows({
  rows,
  reviewers,
}: {
  rows: readonly LandingRow[];
  reviewers: LiveState<Reviewers>;
}): readonly {
  row: LandingRow;
  card: BriefingCard;
  naming: boolean;
  lean: string | undefined;
  what: string | undefined;
}[] {
  const picks = reviewers.phase === "ready" ? reviewers.value : undefined;
  return needsOwnerRows({ reviewers: picks, rows }).map(({ row, word }) => {
    const wait = row.humanWait;
    if (word === "naming" && wait !== undefined) {
      const card = nameTheReviewerCard({ row: { ...row, sentence: wait.sentence, who: wait.who } });
      return { card, lean: wait.sentence, naming: true, row, what: wait.sentence };
    }
    const ci = row.ciFailure.kind === "red" ? "red" : row.ci;
    const what = [ci, ...row.blockedOn, row.dispatchWhy].filter((part) => part !== undefined).join(" ");
    return { card: prCard({ row }), lean: row.actionDetail, naming: false, row, what };
  });
}

/**
 * One row per pull request of the owner's that needs their word.
 *
 * @param landing the register as the page holds it
 * @param reviewers the reviewer reading — an overlay on the register, not a register: it only withdraws a naming card
 *   whose reviewer the owner already picked
 * @param readRows the board's rows, or `undefined` while it is unread, which a card's source says aloud
 * @param placer the organisation's address readers, which place each pull request
 * @returns the rows, without tags yet; none until the register has read, or when it is not the owner's
 */
export function landingRows({
  landing,
  reviewers,
  readRows,
  placer,
}: {
  landing: LiveState<LandingReading>;
  reviewers: LiveState<Reviewers>;
  readRows: readonly BoardRow[] | undefined;
  placer: WorkspacePlacer;
}): Omit<QueueRow, keyof QueueTags>[] {
  if (landing.phase !== "ready" || !landingReadingIsOwners({ landing: landing.value.landing })) {
    return [];
  }
  const out: Omit<QueueRow, keyof QueueTags>[] = [];
  for (const { row, card, naming, lean, what } of ownerLandingRows({ reviewers, rows: landing.value.landing.rows })) {
    // The repository AND the number: two repositories' same-numbered pull requests are two cards, never one key resolved by row order.
    // A row whose key would name another pull request draws no card, as `src/handover/currencyCards.ts` reads no such
    // row (`prCardKeyOf`).
    const key = prCardKeyOf({ number: row.number, repoSlug: row.repoSlug });
    if (key === undefined) {
      continue;
    }
    const placement = prPlacement({ placer, row });
    const provenance = prProvenanceOf({
      facts: { action: row.action, botAwaitingUs: row.codeRabbit.awaitingUs },
      placement,
    });
    out.push({
      card,
      hint: row.repoSlug,
      id: key.slice("pr:".length),
      key,
      kind: "pr",
      pill: naming ? NAME_THE_REVIEWER : row.action,
      provenance,
      record: {
        form: briefingCardForm({ basis: whatAndLeanOf({ lean, what }), card }),
        kind: "pr",
        reading: landing.value,
        row,
      },
      placement,
      // The owner's own pull request: the landing reading says it waits on them, not whose idea it was
      // — unless the board row it lands for carries their words.
      source: belongingRowSource({
        otherwise: {
          kind: "unrecorded",
          origin: `the landing reading of the owner's pull request #${String(row.number)}`,
          steers: [],
        },
        rows: readRows,
        slug: row.boardRowSlug,
      }),
      threadUrl: undefined,
      tier: waitingTierOf({
        checkIn: false,
        teamFacing: naming || provenance === "team" || placedIn({ placement, workspace: "team" }),
      }),
      verifiedBy: "the landing reading",
      currencyFloorIso: row.updatedAtIso,
      verifiedIso: landing.value.observedAtIso,
      whenIso: landing.value.observedAtIso,
    });
  }
  return out;
}
