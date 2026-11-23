"use client";

/*
 * How many looks a Queue card took the owner, drawn two ways: a line under a steered card's question, and the owner's
 * words look by look in the opened card. Both read `talk laps --json` once, on the slow lane, because a lap is counted in half hours
 * and days. What each may claim is `../../lib/cardLaps.ts`'s.
 */

import type { ReactElement } from "react";

import { ageOf } from "../../lib/ageOf";
import { cardLapsFor, lapsLine } from "../../lib/cardLaps";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import { type CardLapsReading, readCardLaps, type ServerLapWord } from "../live/readCardLaps";
import { type LiveState, useLive } from "../live/useLive";

/** What the laps reading's spinner or staleness mark names. */
const LAPS_SUBJECT = "how many looks each card took you";

/** The laps channel as it stands. */
function useCardLapsState(): LiveState<CardLapsReading> {
  return useLive<CardLapsReading>({ read: readCardLaps, slug: "talk-laps" });
}

/**
 * The line under a steered card's question: how many laps it has taken and whose. Nothing for a card the owner has looked
 * at once or never — the line exists to make a steered card stand out. Until the laps are read the OPENED card carries
 * the one spinner or staleness mark (`CardSteers`), rather than one on every row; a reading kept over a failed re-read
 * carries its own mark.
 *
 * @param rowKey the Queue row's key
 * @returns the line, or nothing
 */
export function CardLapsLine({ rowKey }: { rowKey: string }): ReactElement | null {
  const state = useCardLapsState();
  if (state.phase !== "ready") {
    return null;
  }
  const card = cardLapsFor({ key: rowKey, reading: state.value });
  if (card === undefined) {
    return null;
  }
  const line = lapsLine({ card });
  if (line === undefined) {
    return null;
  }
  return (
    <span className="text-[0.76rem] text-muted-foreground" data-laps={String(card.laps)}>
      {line} <ReadMark state={state} subject={LAPS_SUBJECT} />
    </span>
  );
}

/** One quoted word, its anchor in the hover so the whole utterance can be read again. */
function Quoted({ word }: { word: ServerLapWord }): ReactElement {
  return (
    <li className="m-0" title={word.anchor}>
      &ldquo;{word.text}&rdquo; <span className="text-muted-foreground">· {ageOf({ iso: word.atIso })}</span>
    </li>
  );
}

/**
 * The owner's words on the opened card, look by look and folded: what they said each lap, and whose lap it was.
 *
 * @param rowKey the opened row's key
 * @returns the fold, a spinner while the laps read or a staleness mark when they did not, or nothing when the card has
 *   no lap
 */
export function CardSteers({ rowKey }: { rowKey: string }): ReactElement | null {
  const state = useCardLapsState();
  if (state.phase !== "ready") {
    return (
      <div className="mt-[0.4rem]">
        <ReadStandIn state={state} subject={LAPS_SUBJECT} />
      </div>
    );
  }
  const card = cardLapsFor({ key: rowKey, reading: state.value });
  if (card === undefined || card.laps === 0) {
    return null;
  }
  return (
    <details className="mt-[0.4rem] text-[0.78rem]">
      <summary className="cursor-pointer text-muted-foreground">
        {lapsLine({ card })}: what you said each time <ReadMark state={state} subject={LAPS_SUBJECT} />
      </summary>
      <ol className="m-0 mt-[0.4rem] grid gap-[0.5rem] pl-[1.1rem]">
        {card.steers.map((lap) => (
          <li key={lap.startIso}>
            <b>
              {lap.cause === "world"
                ? "Steered, then away three days or more: the world's lap"
                : "Steered: the fleet's lap"}
            </b>
            <ul className="m-0 grid list-none gap-[0.2rem] p-0">
              {lap.words.map((word) => (
                <Quoted key={word.anchor} word={word} />
              ))}
            </ul>
          </li>
        ))}
        <li>
          <b>Latest look</b>
          <ul className="m-0 grid list-none gap-[0.2rem] p-0">
            {card.last.map((word) => (
              <Quoted key={word.anchor} word={word} />
            ))}
          </ul>
        </li>
      </ol>
    </details>
  );
}
