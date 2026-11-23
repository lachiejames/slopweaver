/**
 * The queue's rows for the held-reply register: one per bot reply held for the owner's word in a thread. Split from
 * `./queueRows.ts`, which folds every register into one list, so that file stays under the 300-line cap.
 */

import { type HeldDraft, isHeld } from "../components/live/readThread";
import type { LiveState } from "../components/live/useLive";
import { briefingCardForm } from "./briefingCardForm";
import { queueProvenanceOf } from "./provenance";
import { draftCard } from "./queueCardDraft";
import { whatAndLeanOf } from "./queueRowFields";
import type { QueueRow } from "./queueRows";
import type { QueueTags } from "./queueTagsInherited";
import { draftPlacement } from "./registerPlacementDirect";
import { waitingTierOf } from "./waitingRank";
import type { WorkspacePlacer } from "./workspacePlacement";

/**
 * One row per reply still held.
 *
 * @param drafts the register as the page holds it
 * @param placer the organisation's address readers, which place each reply
 * @returns the rows, without tags yet; none until the register has read
 */
export function heldReplyRows({
  drafts,
  placer,
}: {
  drafts: LiveState<readonly HeldDraft[]>;
  placer: WorkspacePlacer;
}): Omit<QueueRow, keyof QueueTags>[] {
  if (drafts.phase !== "ready") {
    return [];
  }
  const out: Omit<QueueRow, keyof QueueTags>[] = [];
  for (const draft of drafts.value) {
    if (!isHeld({ draft })) {
      continue;
    }
    const card = draftCard({ draft });
    const placement = draftPlacement({ draft, placer });
    out.push({
      card,
      hint: `${draft.channel} ${draft.question} ${draft.text}`,
      id: draft.id,
      key: `draft:${draft.id}`,
      kind: "draft",
      pill: "held reply",
      provenance: queueProvenanceOf({ placement }),
      record: {
        draft,
        form: briefingCardForm({
          basis: whatAndLeanOf({ lean: draft.reason, what: `${draft.askedBy} ${draft.channel} ${draft.reason}` }),
          card,
        }),
        kind: "draft",
      },
      placement,
      source: { kind: "none", origin: `a bot reply held for ${draft.askedBy} in ${draft.channel}`, steers: [] },
      threadUrl: draft.permalink,
      tier: waitingTierOf({ checkIn: false, teamFacing: true }),
      verifiedBy: "the held-reply register still holds it",
      currencyFloorIso: draft.tsIso,
      verifiedIso: drafts.observedAtIso,
      whenIso: draft.tsIso,
    });
  }
  return out;
}
