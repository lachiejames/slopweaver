"use client";

/**
 * The Alignment page's act list: one row per kind of act, drawn in the Queue's row shape (`./QueueSections.tsx`) and
 * opening that kind's slide-over (`./AlignmentKindPanel.tsx`). A row is a way into the kind's own act cards, never a
 * question of its own, so it carries no card key of its own: only its act cards' keys, hidden.
 */

import { ChevronRight } from "lucide-react";
import type { ReactElement } from "react";

import type { AlignmentKindCard } from "../../lib/alignmentKindCards";
import { kindWords } from "../../lib/queueCard";
import type { QueueRow } from "../../lib/queueRows";
import { cn } from "../../lib/utils";
import { dayOf } from "./AlignmentCommon";
import { QUEUE_META, QUEUE_ROW, QUEUE_ROW_EDGE, QUEUE_TEXT, QUEUE_TITLE } from "./QueueSections";

/**
 * The kind rows.
 *
 * @param cards the kind cards, in the page's order
 * @param openedKind the kind whose slide-over is open, if one is
 * @param onOpen opens a kind's slide-over
 * @returns the rows
 */
export function AlignmentKindRows({
  cards,
  openedKind,
  onOpen,
}: {
  cards: readonly AlignmentKindCard<QueueRow>[];
  openedKind: string | undefined;
  onOpen: (kind: string) => void;
}): ReactElement {
  return (
    <div className="sw-glass-plane overflow-hidden rounded-[14px] border border-solid" data-testid="alignment-kinds">
      {cards.map((card) => (
        <button
          type="button"
          key={card.kind}
          className={cn(QUEUE_ROW, QUEUE_ROW_EDGE, "bg-transparent")}
          data-alignment-kind={card.kind}
          aria-current={openedKind === card.kind ? "true" : undefined}
          onClick={() => {
            onOpen(card.kind);
          }}
        >
          <span />
          <span className={QUEUE_TEXT}>
            <span className={QUEUE_TITLE}>{kindWords({ kind: card.kind })}</span>
            <span className="block text-[0.76rem] text-muted-foreground">
              {String(card.acts)} {card.acts === 1 ? "act" : "acts"} done without asking · last{" "}
              {dayOf({ iso: card.newestDoneIso })}
            </span>
          </span>
          <span className={QUEUE_META}>
            <ChevronRight className="size-[0.95rem] flex-none text-muted-foreground" aria-hidden="true" />
            {/* Each act card the kind holds, one press away, still names its key on the page for `desktop e2e
                --call-card all`'s inventory (`src/cli/commands/desktop/e2eCallCardInventory.ts`), which reads every
                `data-card-key` drawn, shown or not. */}
            {card.rows.map((row) => (
              <span key={row.key} hidden data-card-key={row.key} />
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
