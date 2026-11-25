"use client";

import { TriangleAlert } from "lucide-react";
import {
  createContext,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ageOf } from "../../lib/ageOf";
import { describedByWith, describedByWithout } from "../../lib/describedBy";
import { type NestedCardFrom, nestedCardMove } from "../../lib/nestedCardFocus";
import { type StalenessFact, stalenessLabel, stalenessRaw, stalenessShortWords } from "../../lib/stalenessLabel";
import { cn } from "../../lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { RawFold } from "./RawFold";

/**
 * Whether the mark is drawn inside a control of its own — a Queue row is one whole `<button>`. A button inside a
 * button is invalid HTML and a focus stop that does nothing, so there the mark is a labelled image instead: the
 * pointer's hover still opens the same words and fold, the row's own accessible name carries the words, its
 * description carries the raw message, and a keyboard focusing the row opens every card it holds, which Tab then walks
 * to reach each Full message fold (`../../lib/nestedCardFocus.ts`). Any control that draws a mark wraps its children in
 * this; `site/__tests__/unit/nestedControls.test.ts` refuses one that does not.
 */
export const InsideControl = createContext(false);

/** The attribute a nested mark's anchor carries, naming the mark, so its control can list every mark it holds. */
const MARK = "data-warning-mark";

/** The attribute a nested mark's portalled card carries, naming the mark that drew it; React omits it when undefined. */
const CARD = "data-warning-card-for";

/**
 * Every stop inside one card a keyboard may land on, in document order, its Full message `<summary>` included — by
 * name only while it sets no `tabindex` of its own, since an engine may report a bare summary's as -1. The browser's
 * own parsed `tabIndex` decides, never a selector list.
 */
function focusablesUnder({ root }: { root: ParentNode }): readonly (HTMLElement | SVGElement)[] {
  return [...root.querySelectorAll("*")].filter(
    (element): element is HTMLElement | SVGElement =>
      (element instanceof HTMLElement || element instanceof SVGElement) &&
      (element.tabIndex >= 0 || (element.localName === "summary" && !element.hasAttribute("tabindex"))),
  );
}

/** Every nested mark inside a control, named, in document order. */
function marksIn({ host }: { host: Element }): readonly string[] {
  return [...host.querySelectorAll(`[${MARK}]`)].map((mark) => mark.getAttribute(MARK)!);
}

/** The card a mark has open, wherever its portal put it; `null` while it is closed. */
function cardOf({ mark }: { mark: string }): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${CARD}="${CSS.escape(mark)}"]`);
}

/**
 * Whether focus landing on `target` holds a control's cards open: the control itself focused by a keyboard, or any stop
 * inside any card one of its marks drew. Every mark in a row asks the same question, so they open and close together.
 */
function keyboardHolds({ host, target }: { host: Element; target: EventTarget | null }): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target === host) {
    return host.matches(":focus-visible");
  }
  const card = target.closest(`[${CARD}]`);
  return card !== null && marksIn({ host }).includes(card.getAttribute(CARD)!);
}

/**
 * Carry out one Tab along a control's cards: read every card the control's marks have open, ask the pure route where
 * focus goes, and move it there, leaving the browser's own Tab alone when the route says so.
 */
function routeTab({
  host,
  event,
  from,
}: {
  host: HTMLElement;
  event: KeyboardEvent | ReactKeyboardEvent;
  from: "control" | { mark: string };
}): void {
  const cards = marksIn({ host }).map((mark) => ({ card: cardOf({ mark }), mark }));
  const stops = cards.map(({ card }) => (card === null ? [] : focusablesUnder({ root: card })));
  let where: NestedCardFrom = { kind: "control" };
  if (from !== "control") {
    const index = cards.findIndex(({ mark }) => mark === from.mark);
    if (index === -1) {
      return;
    }
    where = { at: stops.at(index)!.findIndex((stop) => stop === document.activeElement), card: index, kind: "card" };
  }
  const move = nestedCardMove({
    cards: stops.map((list) => list.length),
    from: where,
    key: event.key,
    shift: event.shiftKey,
  });
  if (move.kind === "stay") {
    return;
  }
  if (move.kind === "card") {
    event.preventDefault();
    stops.at(move.card)!.at(move.stop)!.focus();
    return;
  }
  if (move.kind === "control") {
    event.preventDefault();
    host.focus();
    return;
  }
  // Past the row: focus goes back to the row and the browser's own Tab is left to run from there, so the next stop is
  // whatever the browser itself picks — a radio group's checked radio, a positive tabindex, an iframe. A hand-built
  // order disagrees with the browser's in edge cases.
  host.focus();
}

/**
 * The warning glyph a failed read draws: its hover — or keyboard focus — says what could not be read, why in plain
 * words, and how old the data still drawn beside it is, with the raw message folded under them. Never a sentence in the data's place: raw text at the top of the Queue reads as broken.
 * Where a page supplied a fact's two or three short words ("burn not read"), they sit beside the glyph, so its reason
 * shows without a hover; the full words stay on the hover.
 *
 * On a failed refresh the two-hour stale queue stays readable and the staleness indicator shows beside it. So the data stays where it was (`../../lib/liveState.ts`) and this sits beside it.
 *
 * A page draws `StaleMark` (`./StaleMark.tsx`), which draws this for every fact that is not a not-connected
 * integration; only the secret paste field draws it directly, because the connect affordance is built from that field.
 *
 * @param facts every subject that could not be read, with its reason and the age of what is still drawn
 * @param block draw it centred in a box of its own, where the data would be, when nothing earlier is drawn
 * @param className spacing the page gives it
 * @returns the mark
 */
export function WarningMark({
  facts,
  block = false,
  className,
}: {
  facts: readonly StalenessFact[];
  block?: boolean;
  className?: string;
}): ReactElement {
  const label = stalenessLabel({ age: (iso) => ageOf({ iso }), facts });
  const raw = stalenessRaw({ facts });
  const shortWords = <ShortWords words={stalenessShortWords({ facts })} />;
  const nested = useContext(InsideControl);
  const describedBy = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [keyboardHeld, setKeyboardHeld] = useState(false);
  const described = raw.length > 0;
  // Inside a control the mark holds no focus stop of its own, so it borrows the CONTROL's: the raw message joins the
  // control's description, and the card opens while a keyboard has the control, or any of its cards, focused. Without
  // this the Full message was reachable by pointer only. A LAYOUT effect, so the id leaves the
  // control in the same synchronous commit that removes the hidden description; a passive one ran after paint, leaving
  // a dangling id an assistive technology could read in between.
  useLayoutEffect(() => {
    const host = anchor.current?.closest<HTMLElement>("a, button");
    if (!nested || host === null || host === undefined) {
      return undefined;
    }
    control.current = host;
    if (described) {
      host.setAttribute(
        "aria-describedby",
        describedByWith({ id: describedBy, value: host.getAttribute("aria-describedby") }),
      );
    }
    // Focus is judged wherever it lands, never only on the control, because each card is portalled out of it: Tab
    // from the row into a card is a blur of the row that must not close the card it is moving into.
    const onFocusIn = (event: FocusEvent): void => {
      setKeyboardHeld(keyboardHolds({ host, target: event.target }));
    };
    // A pointer resting on a keyboard-opened card, or on the mark itself, holds it open past the row's blur, so
    // pressing the Full message fold or tabbing away under the pointer never closes it: Radix saw the card already open
    // and reported no change. Focus leaving the page entirely lands nowhere, so no focusin follows it.
    const onFocusOut = (event: FocusEvent): void => {
      if (event.target === host) {
        if ([card.current, anchor.current].some((element) => element?.matches(":hover") === true)) {
          setHovered(true);
        }
      }
      if (event.relatedTarget === null) {
        setKeyboardHeld(false);
      }
    };
    // Each card is portalled to the end of the document, so the browser's own Tab runs from the row to the next row
    // and never into a card: Tab off a keyboard-focused row enters its first card instead. A row holding several marks
    // hears one Tab once per mark, so only its FIRST mark routes it, along every card of the row.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (marksIn({ host })[0] === describedBy) {
        routeTab({ event, from: "control", host });
      }
    };
    // A control already focused when the mark mounts (a hydration under the keyboard) opens it at once.
    setKeyboardHeld(keyboardHolds({ host, target: document.activeElement }));
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    host.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("keydown", onKeyDown);
      control.current = null;
      const left = describedByWithout({ id: describedBy, value: host.getAttribute("aria-describedby") });
      if (left === null) {
        host.removeAttribute("aria-describedby");
      } else {
        host.setAttribute("aria-describedby", left);
      }
    };
  }, [nested, described, describedBy]);
  // Inside a card, Tab off its last stop goes on to the row's next card, then past the row; Shift+Tab walks back to
  // the row, as if every card sat right after the row in the document.
  const onCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const host = control.current;
    if (host !== null) {
      routeTab({ event, from: { mark: describedBy }, host });
    }
  };
  const size = block ? "size-[1.15rem]" : "size-[0.85rem]";
  const frame = cn(
    "inline-flex items-center text-warning",
    block && "flex w-full justify-center py-[1.2rem]",
    className,
  );
  // Inside a control the trigger is an image, never a second button, and the card it opens is the same one as
  // anywhere else, raw message fold and all: it is portalled out of the control's DOM, and its
  // clicks stop at its edge, so opening the fold never presses the row it sits in. The description is `hidden`, so it
  // never joins the control's accessible NAME, while `aria-describedby` still reads a hidden element it points at.
  if (nested) {
    return (
      <HoverCard
        openDelay={150}
        closeDelay={150}
        open={[hovered, keyboardHeld].includes(true)}
        onOpenChange={setHovered}
      >
        <HoverCardTrigger asChild>
          <span ref={anchor} className={frame} data-warning-mark={describedBy}>
            {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a lucide <svg>, not HTML: role="img" with a label is how a drawing announces itself */}
            <TriangleAlert className={size} role="img" aria-label={label} />
            {shortWords}
            {described ? (
              <span id={describedBy} hidden>
                Full message: {raw.join("\n\n")}
              </span>
            ) : null}
          </span>
        </HoverCardTrigger>
        <WarningCard label={label} raw={raw} card={card} keyboard={{ mark: describedBy, onKeyDown: onCardKeyDown }} />
      </HoverCard>
    );
  }
  // A hover card rather than a tooltip, so the pointer can move onto it and open the raw message's fold. A hover card
  // is for sighted pointer users only (Radix's own note), so the button also carries the raw message as its accessible
  // description: a keyboard or screen reader reaches the same Full message a pointer does.
  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        {/* A button so a keyboard reaches the same words a pointer does; pressing it does nothing. */}
        <button
          type="button"
          aria-label={label}
          aria-describedby={raw.length === 0 ? undefined : describedBy}
          className={cn(frame, "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        >
          <TriangleAlert className={size} aria-hidden="true" />
          {shortWords}
          {raw.length === 0 ? null : (
            <span id={describedBy} className="sr-only">
              Full message: {raw.join("\n\n")}
            </span>
          )}
        </button>
      </HoverCardTrigger>
      <WarningCard label={label} raw={raw} card={card} />
    </HoverCard>
  );
}

/**
 * The two or three words a page supplied, drawn beside the glyph so a reader sees why without a hover — "burn not
 * read", "app build not read". Hidden from assistive technology, because the glyph's label already says the full
 * words and a Queue row's or sidebar link's name would otherwise carry them twice. Hidden only on a mark inside the
 * sidebar while it is icons alone, which has room for the glyph only: the icons setting sits on the whole console's
 * frame, so the `.sw-sidebar` scope is what keeps a mark on the page itself saying its words. A page's own `<aside>`
 * (a pull request's conversation column, say) is not the sidebar, so a bare `aside` scope would hide them there too.
 *
 * @returns the words, or nothing when none was supplied
 */
function ShortWords({ words }: { words: readonly string[] }): ReactElement | null {
  if (words.length === 0) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className="ml-1 text-[0.78rem] group-data-[sidebar=icons]/console:in-[.sw-sidebar]:hidden"
      data-short-words
    >
      {words.join(" · ")}
    </span>
  );
}

/**
 * What every warning's hover opens, in both of the mark's drawings: the plain words, then the raw message folded under
 * them. A click inside it stops here, since React carries a portalled click up to the control the mark sits in.
 */
function WarningCard({
  label,
  raw,
  card,
  keyboard,
}: {
  label: string;
  raw: readonly string[];
  /** The card's element, so a nested mark can ask whether the pointer is on it. */
  card: RefObject<HTMLDivElement | null>;
  /** A nested mark's name for its card, and the keyboard route through the row's cards; absent for the ordinary mark. */
  keyboard?: { mark: string; onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void };
}): ReactElement {
  return (
    <HoverCardContent
      ref={card}
      className="w-auto max-w-[24rem] p-2 text-left text-[0.78rem]"
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={keyboard?.onKeyDown}
      data-warning-card-for={keyboard?.mark}
    >
      <p className="m-0 whitespace-pre-line">{label}</p>
      {raw.length === 0 ? null : <RawFold raw={raw.join("\n\n")} />}
    </HoverCardContent>
  );
}
