"use client";

import type { ReactElement } from "react";

import { type CardLoadingWait, cardLoadingLine } from "../../lib/cardLoading";
import type { QueueRow } from "../../lib/queueRows";
import { SLIDE_BODY, SlideOver } from "../live/SlideOver";
import { CHIP } from "./controls";
import { StoppingElsewhere } from "./QueueStoppingLines";
import { Icon, KINDS } from "./queueKinds";
import { ReadingIndicator } from "./ReadingIndicator";
import { FindingMark } from "./workContextState";

/** The skeleton's bars, one per line a card's body usually opens with, each named so React can key it. */
const BARS = [
  { id: "heading", width: "w-3/4" },
  { id: "what", width: "w-full" },
  { id: "why", width: "w-5/6" },
  { id: "stakes", width: "w-2/3" },
  { id: "links", width: "w-full" },
  { id: "options", width: "w-1/2" },
] as const;

/**
 * The one state an opened card draws while a read its content is derived from is still in flight
 * (`../../lib/cardLoading.ts`): the row's kind and workspace mark — whose card it is, on a stopping card this view draws
 * from another workspace — a skeleton, and a spinner in the title whose hover
 * and screen-reader label name what it is reading — never a sentence printed in the card.
 *
 * Nothing else, on purpose — no heading off a half-read record, no absence sentence, no footer. A card opened fresh
 * reads as broken for ten to fifteen seconds before it fills in, and a partial card with a live Approve button is the
 * worst case. The row's own panel replaces this one the render its reads arrive.
 *
 * @param row the opened row
 * @param waits what it is still reading, at least one
 * @returns the panel
 */
export function LoadingPanel({
  row,
  waits,
  onClose,
}: {
  row: QueueRow;
  waits: readonly CardLoadingWait[];
  onClose: () => void;
}): ReactElement {
  const kind = KINDS[row.kind];
  return (
    <SlideOver
      label={`${kind.label}: loading`}
      tag={
        // The mark is the row's, not the card's, so it is drawn while the card loads.
        <>
          <span className={CHIP}>{row.pill}</span>
          <FindingMark placement={row.placement} />
          <StoppingElsewhere row={row} />
        </>
      }
      title={<ReadingIndicator label={cardLoadingLine({ waits })} />}
      icon={<Icon kind={row.kind} size="head" />}
      onClose={onClose}
    >
      <div className={SLIDE_BODY} aria-busy="true">
        <div className="flex animate-pulse flex-col gap-3 py-4 motion-reduce:animate-none" aria-hidden="true">
          {BARS.map((bar) => (
            <div key={bar.id} className={`h-3 rounded-[4px] bg-muted ${bar.width}`} />
          ))}
        </div>
      </div>
    </SlideOver>
  );
}
