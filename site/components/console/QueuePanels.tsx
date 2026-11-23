"use client";

import { type ReactElement, useMemo } from "react";

import { cardDeparture, departedRow } from "../../lib/cardDeparture";
import { attestedNumbers, cardReferences, checkoutsOf } from "../../lib/cardReferences";
import { rowForOpen } from "../../lib/queueOpen";
import { type QueueRow } from "../../lib/queueRows";
import { type BoardRow } from "../live/read";
import { NO_LINEAR_REFERENCES } from "../live/readBoardDocument";
import { NO_RECORD_REFERENCES } from "../live/readRecords";
import { OpenDeparture } from "./CardDepartureNote";
import { CardReferencesScope } from "./InlineText";
import { MissingPanel, SwitchingPanel, WithheldPanel } from "./OpenFallbackPanels";
import { PressHold } from "./press";
import { QueuePanel } from "./QueuePanelsRow";
import { type OpenedRow, type QueueReading, REGISTERS } from "./useQueueRows";
import { useWorkContext } from "./workContextState";

/*
 * Every row's panel, whichever register it came from — the one set the Queue opens, so a row carries the same
 * card and the same acts whether the owner opens it or a triage pass does.
 */

/** The board's rows before it has read, one array so the attestation memo holds across renders. */
const NO_BOARD_ROWS: readonly BoardRow[] = [];

/** The board slugs a card's sentences may cite: none, so a row a card names is words. */
const NO_BOARD_SLUGS: ReadonlySet<string> = new Set();

/**
 * Whichever panel `?open=` calls for: the row's own, a switch to the context that holds it, a gone note, or
 * nothing yet.
 *
 * The Queue draws it, so a row the owner opens and a row a triage pass opens are the same panel with the same acts.
 *
 * @param reading the eight registers and the rows the page draws
 * @param opened which row is open, from `useOpenedRow`
 * @param numberOf the number the page drew beside the row, if it drew one
 * @returns the panel, or nothing when none is open or the registers have not said yet
 */
export function OpenedPanel({
  reading,
  opened,
  numberOf,
}: {
  reading: QueueReading;
  opened: OpenedRow;
  numberOf: (row: QueueRow) => number | undefined;
}): ReactElement | null {
  let linear = NO_LINEAR_REFERENCES;
  let records = NO_RECORD_REFERENCES;
  let boardRows = NO_BOARD_ROWS;
  if (reading.board.phase === "ready") {
    linear = reading.board.value.linear;
    records = reading.board.value.records;
    boardRows = reading.board.value.rows;
  }
  // How many digits each repository's numbers run to, read across every row once rather than per render.
  const attested = useMemo(
    () => attestedNumbers({ board: boardRows, rows: reading.every }),
    [boardRows, reading.every],
  );
  // Every repository a row checks out: the only ones a number its card names no repository for may fall back to.
  const checkouts = useMemo(() => checkoutsOf({ board: boardRows, rows: reading.every }), [boardRows, reading.every]);
  const { shows } = useWorkContext();
  const key = opened.opened;
  if (key === null) {
    return null;
  }
  const common = {
    acts: reading.acts,
    board: reading.board,
    drafts: reading.drafts,
    hands: reading.hands,
    imports: reading.imports,
    landing: reading.landing,
    onClose: opened.close,
    posts: reading.posts,
    reviews: reading.reviews,
  };
  // A card a gate refused never draws, live or from a snapshot: only that it is held, and which check held it.
  if (opened.withheld !== undefined) {
    return <WithheldPanel row={opened.withheld} onClose={opened.close} />;
  }
  // No board slugs: a sentence on a card naming a row stays words, never a board citation on a queue card.
  const queueWide = { attested, boardSlugs: NO_BOARD_SLUGS, checkouts, linear, people: reading.people, records };
  // The live and the gone panel are the SAME element tree, the departure provider included, so a card leaving the
  // list under the owner never remounts its panel and loses a press's outcome, the words being typed or an open fold.
  if (opened.live !== undefined) {
    return (
      <CardReferencesScope references={cardReferences({ ...queueWide, row: opened.live })}>
        <PressHold value={reading.kept.includes(opened.live.kind) ? "kept" : undefined}>
          <OpenDeparture.Provider value={undefined}>
            <QueuePanel {...common} snapshot={opened.live} index={numberOf(opened.live)} gone={false} />
          </OpenDeparture.Provider>
        </PressHold>
      </CardReferencesScope>
    );
  }
  const held = rowForOpen({ open: key, rows: reading.every });
  // A card that left the list stays open, drawn gone, naming who took it (`../../lib/cardDeparture.ts`): from its
  // snapshot, or — reloaded, or deep-linked to a card the owner's words already landed on — from the register still holding
  // it in this context, which is never the work context hiding it.
  const gonePanel = departedRow({ held, open: key, shows, snapshot: opened.snapshot });
  if (gonePanel !== undefined) {
    const departure = cardDeparture({
      board: reading.board,
      held,
      kept: reading.kept,
      key: gonePanel.key,
      spoken: reading.spoken,
      steers: reading.steered.overlay,
    });
    return (
      <CardReferencesScope references={cardReferences({ ...queueWide, row: gonePanel })}>
        <PressHold value="gone">
          <OpenDeparture.Provider value={departure}>
            <QueuePanel {...common} snapshot={gonePanel} index={numberOf(gonePanel)} gone={true} />
          </OpenDeparture.Provider>
        </PressHold>
      </CardReferencesScope>
    );
  }
  if (held !== undefined) {
    // A register HOLDS it; the work-context filter is what is hiding it. Saying it was settled or swept
    // would be a confident lie — measured on `?open=act:1063-open-finding-pr` in the Acme
    // context, which reported a live slopweaver-repo act as gone.
    return <SwitchingPanel row={held} onClose={opened.close} />;
  }
  if (reading.readCount === REGISTERS) {
    return <MissingPanel opened={key} onClose={opened.close} />;
  }
  return null;
}
