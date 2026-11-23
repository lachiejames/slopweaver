"use client";

/*
 * The right-hand column every Queue panel carries (`./QueuePanels.tsx`), and the Checked section that continues
 * full width beneath it, in their own file so the panels stay under the line cap as they grow.
 */
import { type ReactElement, useContext } from "react";

import { ageOf } from "../../lib/ageOf";
import type { CurrencyCard, CurrencyReading } from "../../lib/cardCurrency";
import { cardCurrencyOf } from "../../lib/cardCurrencyMark";
import type { CardProperties as Properties } from "../../lib/cardPropertiesTypes";
import { cn } from "../../lib/utils";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import { readCurrencyReading } from "../live/readCurrency";
import type { Reading } from "../live/reading";
import { SLIDE_SECTION } from "../live/SlideOver";
import { readyValueOf, useLive } from "../live/useLive";
import { DepartureSection, OpenDeparture } from "./CardDepartureNote";
import { CardProperties } from "./CardProperties";
import { CheckedFold } from "./CurrencySaid";
import { PressHold } from "./press";
import { StaleMark } from "./StaleMark";
import { FAST_POLL_MS } from "./useQueueRows";

/** The reasoning's small print, in the column and in the Checked section beneath it alike. */
const REASONING_TEXT = "[&_p]:mt-0 [&_p]:mb-2 [&_p]:text-[0.8rem]";

/**
 * The opened card's Checked section, ONE closed line naming the mark (`CheckedFold`): whether the card is fresh or may
 * be stale, when it was last checked and what done means — at most four lines, however much the owner has said since — then
 * what the owner has said since that could bear on it, each folded inside it. The same lines as the collapsed mark's hover.
 *
 * It spans the whole body rather than sitting in the 300px column: opened, that list runs to a hundred lines and more,
 * and in the column it left the panel empty to its left once the owner scrolled past the card.
 *
 * @param card the row the panel opened
 * @returns the section
 */
function CheckedSection({ card }: { card: CurrencyCard }): ReactElement {
  const currency = useLive<Reading<CurrencyReading>>({
    everyMs: FAST_POLL_MS,
    read: readCurrencyReading,
    slug: "currency-reading",
  });
  const mark = cardCurrencyOf({ ageOf, card, reading: readyValueOf({ state: currency })?.value });
  // A ruled card's words never read the check; any other card's would say "no check recorded" over a read still in
  // flight or one that failed, so those draw the spinner or the staleness mark instead.
  if (card.ruledIso === undefined && currency.phase !== "ready") {
    return (
      <div className={cn(SLIDE_SECTION, REASONING_TEXT, "col-span-full border-t-border")}>
        <h4>Checked</h4>
        <ReadStandIn state={currency} subject="the check of what you have said since" block />
      </div>
    );
  }
  return (
    <div className={cn(SLIDE_SECTION, REASONING_TEXT, "col-span-full border-t-border")} data-currency={mark.kind}>
      <div className="flex items-start justify-between gap-2">
        <CheckedFold mark={mark} />
        {mark.unread.length > 0 && <StaleMark facts={mark.unread} />}
        {currency.phase === "ready" && <ReadMark state={currency} subject="the check of what you have said since" />}
      </div>
    </div>
  );
}

/**
 * The right-hand column every panel carries — the card's one properties section and what has moved since it was
 * opened — and, as a second grid item spanning the body beneath it, whether the card is fresh and when it was last
 * checked. One properties section, label left and value right, Linear's sidebar the model — no
 * "Read from" line with a command in code, and no tag pills at the bottom.
 *
 * @param card the opened row, with its Linear-style properties
 * @param gone whether the register no longer holds the record since the panel opened
 * @param goneWord what to say when it is gone
 * @returns the column and the Checked section, unwrapped so each is its own item of the body's grid
 */
export function Reasoning({
  card,
  gone,
  goneWord,
}: {
  card: CurrencyCard & { readonly properties: Properties };
  gone: boolean;
  goneWord: string;
}): ReactElement {
  const kept = useContext(PressHold) === "kept";
  // Provided around a panel drawn from its snapshot (`./QueuePanels.tsx`): who took the card off the owner's list.
  const departed = useContext(OpenDeparture);
  return (
    <>
      <aside className={REASONING_TEXT}>
        <CardProperties properties={card.properties} />
        {kept && (
          <div className={cn(SLIDE_SECTION, "border-t-border")}>
            <h4>An earlier reading</h4>
            <p>this register's latest read failed, so nothing here can be pressed until it reads again</p>
          </div>
        )}
        {gone && !kept && departed !== undefined && <DepartureSection goneWord={goneWord} />}
        {gone && !kept && departed === undefined && (
          <div className={cn(SLIDE_SECTION, "border-t-border")}>
            <h4>Since you opened this</h4>
            <p>{goneWord}</p>
          </div>
        )}
      </aside>
      <CheckedSection card={card} />
    </>
  );
}
