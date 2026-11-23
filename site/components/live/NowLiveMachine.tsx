"use client";

import type { ReactElement } from "react";

import { type WorkingSessionCard, workingSessionsOf } from "../../lib/workingSessions";
import { LiveMachine } from "./LiveMachine";
import type { Board } from "./read";
import { isReadingNotRecorded, type Reading, type RecordedReading } from "./reading";
import { readMachineSeries } from "./readMachineSeries";
import type { Seats } from "./readNow";
import type { Reconcile } from "./readWorkstreams";
import { type LiveState, readyValueOf, useLive } from "./useLive";

/** The page's poll for the machine's last hour, the twenty seconds the rest of Now asks on. */
const SERIES_POLL_MS = 20_000;

/**
 * The Now view's first tile: the machine read live every two seconds, each reading's age in its header, its session rows titled from the working-session cards the Agents tile draws off the same readings.
 *
 * The machine's last hour, drawn on Past, is sampled by `machine series` only while a page asks for it. Now keeps
 * asking without drawing it, as it did when the charts lived here, so Past opens on the hour rather than on one
 * sample. A fixture page freezes the seats to a capture, so it draws no live machine and samples nothing.
 *
 * @param seats the seats reading the Agents tile draws
 * @param boardRows the board rows that title a card, absent while unread or when the seats are frozen
 * @param reconcile the board reconcile the seats are joined to
 * @param onOpen opens one session's panel in the Agents tile
 * @returns the tile, or nothing on a fixture page
 */
export function NowLiveMachine({
  boardRows,
  fixture,
  onOpen,
  reconcile,
  seats,
}: {
  boardRows: Board["rows"] | undefined;
  fixture: string | undefined;
  onOpen: (card: WorkingSessionCard) => void;
  reconcile: LiveState<Reading<Reconcile>>;
  seats: LiveState<RecordedReading<Seats>>;
}): ReactElement | null {
  useLive({ everyMs: SERIES_POLL_MS, fixture, read: readMachineSeries, slug: "machine-series" });
  if (fixture !== undefined) {
    return null;
  }
  const recorded = readyValueOf({ state: seats });
  let cards: readonly WorkingSessionCard[] = [];
  if (recorded !== undefined && !isReadingNotRecorded(recorded)) {
    cards = workingSessionsOf({
      boardRows,
      reconcileReading: readyValueOf({ state: reconcile }),
      seatReading: recorded,
    }).cards;
  }
  return <LiveMachine cards={cards} onOpen={onOpen} />;
}
