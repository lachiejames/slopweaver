"use client";

/*
 * The "Since you opened this" section of a panel whose card left the owner's list while it was open: who took it, when,
 * with the owner's words quoted, and that it stays open until the owner closes it. The departure is derived by
 * `../../lib/cardDeparture.ts` from the readings the page filtered by; `./QueuePanels.tsx` provides it.
 */
import { createContext, type ReactElement, useContext } from "react";

import { ageOf } from "../../lib/ageOf";
import type { CardDeparture, DepartureHold } from "../../lib/cardDeparture";
import { cn } from "../../lib/utils";
import { SLIDE_SECTION } from "../live/SlideOver";

/** The open card's departure, provided only around a panel drawn from its snapshot: `undefined` outside one. */
export const OpenDeparture = createContext<CardDeparture | undefined>(undefined);

/** What every line about a card the owner's words or a steer took off opens with. */
const STAYS = "Off your list, and open here until you close it.";

/**
 * One hold's line: who, how long ago, the owner's words, and the row a session acts on.
 *
 * @param hold the hold
 * @returns the line
 */
function HoldLine({ hold }: { hold: DepartureHold }): ReactElement {
  return (
    <p className="wrap-anywhere">
      <b>{hold.who}</b>, {ageOf({ iso: hold.atIso })}: “{hold.words}”; a session acts on it as{" "}
      <code>{hold.workSlug}</code>.
    </p>
  );
}

/**
 * The body of the section for one departure.
 *
 * @param departure the departure
 * @param goneWord the register's own word, said when no register holds the card any more
 * @returns the lines
 */
function DepartureLines({ departure, goneWord }: { departure: CardDeparture; goneWord: string }): ReactElement {
  if (departure.kind === "words") {
    const [first, ...rest] = departure.holds;
    return (
      <>
        <p>{STAYS}</p>
        <HoldLine hold={first} />
        {rest.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              {String(rest.length)} more of your words hold it off the list
            </summary>
            {rest.map((hold) => (
              <HoldLine key={`${hold.atIso}:${hold.workSlug}`} hold={hold} />
            ))}
          </details>
        )}
      </>
    );
  }
  if (departure.kind === "unpicked") {
    const { hold } = departure;
    return (
      <>
        <p>{STAYS}</p>
        <p className="wrap-anywhere">
          <b>{hold.who}</b>, {ageOf({ iso: hold.atIso })}: “{hold.words}”; no session picked it up.
        </p>
      </>
    );
  }
  if (departure.kind === "steer") {
    return (
      <>
        <p>{STAYS}</p>
        <p className="wrap-anywhere">
          <b>Your words, relayed by the voice</b>, {ageOf({ iso: departure.sentAtIso })}: “{departure.heard}”
          {departure.relaySlug === undefined ? (
            "; its row is not on the board yet."
          ) : (
            <>
              ; a session acts on it as <code>{departure.relaySlug}</code>.
            </>
          )}
        </p>
      </>
    );
  }
  if (departure.kind === "kept") {
    return <p>Its register&apos;s latest read failed, so this is drawn from an earlier reading. Nobody took it.</p>;
  }
  if (departure.kind === "placing") {
    return <p>It waits on the board to be placed. Nobody took it.</p>;
  }
  if (departure.kind === "held") {
    return <p>A register still holds it, and nothing this page reads says why it is not in the list.</p>;
  }
  if (departure.kind === "alignment") {
    return <p>It is an act, which the Alignment page draws rather than the Queue. Nobody took it.</p>;
  }
  return <p>{goneWord}. Unless your own press here did it, no ledger this page reads names who did.</p>;
}

/**
 * The small indicator at the head of a panel whose card left the owner's list: that it is off the queue, and that
 * closing it may lose it, since it may not be easy to reopen. Who took it is the section below, in the reasoning
 * column.
 *
 * Plain text, a past fact, never a pill: a bordered label here reads as an action to remove the card.
 *
 * @returns the indicator, or `null` on a panel whose card is still in the list
 */
export function DepartureIndicator(): ReactElement | null {
  const departure = useContext(OpenDeparture);
  if (departure === undefined) {
    return null;
  }
  return (
    <p className="m-0 text-[0.78rem] text-muted-foreground" data-departure-indicator={departure.kind}>
      This card has left your queue. Close it and you may not be able to reopen it yet.
    </p>
  );
}

/**
 * The section, or `null` on a panel whose card is still in the list.
 *
 * @param goneWord the register's own word for a card it no longer holds
 * @returns the section
 */
export function DepartureSection({ goneWord }: { goneWord: string }): ReactElement | null {
  const departure = useContext(OpenDeparture);
  if (departure === undefined) {
    return null;
  }
  return (
    <div className={cn(SLIDE_SECTION, "border-t-border")} data-departure={departure.kind}>
      <h4>Since you opened this</h4>
      <DepartureLines departure={departure} goneWord={goneWord} />
    </div>
  );
}
