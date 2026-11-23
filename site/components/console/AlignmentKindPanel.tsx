"use client";

/**
 * One kind of act opened: the slide-over the Queue's cards open into (`../live/SlideOver.tsx`), holding that kind's own
 * act cards newest first, each drawn by `./AlignmentAct.tsx` exactly as before. A word on one of them still lands on
 * that act's ledger line alone; opening the kind answers nothing by itself.
 */

import type { ReactElement } from "react";

import type { GuidanceView } from "../../lib/alignmentGuidance";
import type { AlignmentKindCard } from "../../lib/alignmentKindCards";
import { kindWords } from "../../lib/queueCard";
import type { QueueRow } from "../../lib/queueRows";
import { SLIDE_BODY_FOLDED, SlideOver } from "../live/SlideOver";
import type { LiveState } from "../live/useLive";
import { ActCard } from "./AlignmentAct";
import { dayOf } from "./AlignmentCommon";
import { useActPullPrefetch } from "./useActPull";

/**
 * The kind's slide-over.
 *
 * @param card the kind card opened
 * @param focused the act card the owner touched or a link named, if any
 * @param guidance the owner's guidance, read once for the page and shared with every act card's sidebar
 * @param onEngage makes an act card the one the owner is answering
 * @param onClose closes the panel
 * @returns the panel
 */
export function AlignmentKindPanel({
  card,
  focused,
  guidance,
  onEngage,
  onClose,
}: {
  card: AlignmentKindCard<QueueRow>;
  focused: string | undefined;
  guidance: LiveState<GuidanceView>;
  onEngage: (key: string) => void;
  onClose: () => void;
}): ReactElement {
  // Only the open kind's pull requests are looked up ahead, never every act on the page.
  useActPullPrefetch({
    branches: card.rows.map((row) => (row.record.kind === "act" ? row.record.lookupBranch : undefined)),
  });
  const words = kindWords({ kind: card.kind });
  return (
    <SlideOver
      label={`${words} acts`}
      title={words}
      meta={`${String(card.acts)} ${card.acts === 1 ? "act" : "acts"} done without asking · last ${dayOf({ iso: card.newestDoneIso })} · ${card.kind}`}
      onClose={onClose}
    >
      <div className={SLIDE_BODY_FOLDED} data-alignment-panel={card.kind}>
        {card.rows.map((row) => (
          <ActCard key={row.key} row={row} focus={focused === row.key} onEngage={onEngage} guidance={guidance} />
        ))}
      </div>
    </SlideOver>
  );
}
