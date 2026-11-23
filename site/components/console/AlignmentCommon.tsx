/** What every question card on the Alignment page (`./Alignment.tsx`) is built from. */

import type { ReactElement } from "react";

import type { AlignmentAnswer } from "../live/readAlignment";

/** One question's frame: a rounded card in the page's glass. */
export const CARD = "sw-glass-plane mb-3 rounded-[14px] border border-solid px-[1.1rem] py-[0.9rem]";

/**
 * A date as the page prints it, `D Mon YYYY`.
 *
 * @returns the date
 */
export function dayOf({ iso }: { iso: string }): string {
  return new Date(Date.parse(iso)).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The reply line under a question the owner has answered.
 *
 * @returns the line, or nothing when the owner has not answered
 */
export function Answered({ answer }: { answer: AlignmentAnswer | undefined }): ReactElement | null {
  if (answer === undefined) {
    return null;
  }
  return (
    <p className="my-[0.5rem] text-[0.82rem]">
      <span className="text-muted-foreground">You said, {dayOf({ iso: answer.atIso })}:</span> “{answer.words}”
    </p>
  );
}

/**
 * The line every question ends on, in place of a box: the console's one text input is the call's chat, with no other
 * text input anywhere in the app.
 *
 * @returns the line
 */
export function ConversationHint(): ReactElement {
  return (
    <p className="mt-[0.5rem] mb-0 text-[0.75rem] text-muted-foreground">
      Say your answer aloud or in the call&apos;s chat; touching this card makes it what you are answering.
    </p>
  );
}

/**
 * The props that make a card the page's open item the moment the owner touches it — a pointer, or focus landing anywhere
 * inside — so a word said or typed in the call names the card's key. The voice reads the open item when it relays,
 * never when the call starts.
 *
 * @param about the card's key
 * @param onEngage told the key when the owner touches the card
 * @returns the handlers to spread on the card
 */
export function engaging({ about, onEngage }: { about: string; onEngage: (key: string) => void }): {
  onFocusCapture: () => void;
  onPointerDownCapture: () => void;
} {
  const engage = (): void => {
    onEngage(about);
  };
  return { onFocusCapture: engage, onPointerDownCapture: engage };
}
