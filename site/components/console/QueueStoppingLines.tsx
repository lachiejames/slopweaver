"use client";

/*
 * A stopping card's own lines on its collapsed Queue row: whose card it is when this view draws it only because it
 * stops the owner's work, then its decision. Lifted out of `QueueSections.tsx` so that file stays under the line cap.
 */
import { type ReactElement } from "react";

import type { QueueRow } from "../../lib/queueRows";
import { stoppingElsewhere, stoppingFold } from "../../lib/queueStopping";
import { entryOf } from "../../lib/workContext";
import { contextOfWorkspace } from "../../lib/workspacePlacementContext";
import { useTeamLabel } from "./organisationState";
import { useWorkContext } from "./workContextState";

/**
 * A stopping card's lines, drawn as plain spans because the row is one button. A card the view draws only because it
 * stops the owner's work (`shownOnQueue`) first names the workspace it belongs to, so its glyph, its mark and its deep link —
 * each of which names that workspace — read as that workspace's card shown here, never as this view's own.
 *
 * @returns the lines, or nothing on a card that is not stopping
 */
export function StoppingLines({ row }: { row: QueueRow }): ReactElement | null {
  if (row.stopping === undefined) {
    return null;
  }
  return (
    <>
      <StoppingElsewhere row={row} />
      <StoppingDecision row={row} />
    </>
  );
}

/**
 * Whose card this is, on a stopping card the view draws only because it stops the owner's work — on its collapsed row and in
 * its open panel alike, so neither reads as the view's own card.
 *
 * @returns the line, or nothing on a card that is this view's own
 */
export function StoppingElsewhere({ row }: { row: QueueRow }): ReactElement | null {
  const { shows } = useWorkContext();
  const teamLabel = useTeamLabel();
  const elsewhere = stoppingElsewhere({ row, shows });
  if (elsewhere === undefined) {
    return null;
  }
  return (
    <span
      className="mt-[0.2rem] block text-[0.78rem] text-muted-foreground"
      data-meta="stopping-elsewhere"
      data-workspace={elsewhere}
    >
      {entryOf({ context: contextOfWorkspace({ workspace: elsewhere }), teamLabel }).label}&apos;s card, shown here
      because it stops your work
    </span>
  );
}

/**
 * A stopping card's decision on its collapsed row: the problem, each option by letter, and the lean — the card's own
 * recorded fields (`../../lib/queueStopping.ts` `stoppingFold`).
 *
 * @returns the decision, or nothing on a card that records none
 */
function StoppingDecision({ row }: { row: QueueRow }): ReactElement | null {
  const fold = stoppingFold({ card: row.card });
  if (fold === undefined) {
    return null;
  }
  return (
    <span className="mt-[0.2rem] block text-[0.78rem] wrap-anywhere" data-meta="stopping-decision">
      <span className="block text-foreground">{fold.problem}</span>
      {fold.options.map((option) => (
        <span key={option.letter} className="block text-muted-foreground" data-option={option.letter}>
          <b className="text-foreground">{option.letter}.</b> {option.sentence}
        </span>
      ))}
      {fold.lean !== undefined && <span className="block text-muted-foreground">Lean: {fold.lean}</span>}
    </span>
  );
}
