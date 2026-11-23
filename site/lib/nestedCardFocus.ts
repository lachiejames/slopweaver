/**
 * A warning mark inside a control (a Queue row is one `<button>`) opens its card while a keyboard has the control
 * focused (`../components/console/WarningMark.tsx`). Each card is portalled to the end of the document, so the
 * browser's own Tab order runs from the control to the NEXT control and never into a card: the card closed on that blur,
 * and the Full message fold in it was reachable by pointer only. One control may hold several
 * marks, so the route walks every card of that control in the marks' own order, as if each card sat right after the
 * control in the document. Past the last card it hands focus back to the control and lets the browser's own Tab run on
 * from there, so which stop follows the control is always the browser's answer, never a copy of it. This function is
 * that route, kept pure so the site lane can test it without a DOM.
 */

/** Where focus is when a key is pressed: on the control, or on one stop of one of its cards. */
export type NestedCardFrom = { kind: "control" } | { kind: "card"; card: number; at: number };

/**
 * Where the key press sends focus: leave it to the browser, back to the control, on to whatever follows the control
 * (focus returns to the control and the browser's own Tab moves on from it), or onto one stop of one card.
 */
export type NestedCardMove =
  { kind: "stay" } | { kind: "control" } | { kind: "after-control" } | { kind: "card"; card: number; stop: number };

/**
 * The move a key press makes. Tab from the control enters the first card that holds a stop; Tab off a card's last stop
 * enters the next such card, and off the last card goes on past the control. Shift+Tab walks the same route backwards,
 * ending on the control. A Tab between two stops of one card, Shift+Tab off the control, and every other key are the
 * browser's own.
 *
 * @param key the pressed key's `KeyboardEvent.key`
 * @param shift whether Shift was held
 * @param from where focus is
 * @param cards how many focusable stops each of the control's cards holds, in the marks' order; a closed card holds 0
 * @returns the move to make
 */
export function nestedCardMove({
  key,
  shift,
  from,
  cards,
}: {
  key: string;
  shift: boolean;
  from: NestedCardFrom;
  cards: readonly number[];
}): NestedCardMove {
  if (key !== "Tab") {
    return { kind: "stay" };
  }
  const withStops = cards.flatMap((stops, card) => (stops > 0 ? [card] : []));
  if (from.kind === "control") {
    const first = withStops.at(0);
    if (shift || first === undefined) {
      return { kind: "stay" };
    }
    return { card: first, kind: "card", stop: 0 };
  }
  const stops = cards.at(from.card);
  if (stops === undefined || from.at < 0 || from.at >= stops) {
    return { kind: "stay" };
  }
  if (shift) {
    if (from.at > 0) {
      return { kind: "stay" };
    }
    const previous = withStops.findLast((card) => card < from.card);
    if (previous === undefined) {
      return { kind: "control" };
    }
    return { card: previous, kind: "card", stop: cards.at(previous)! - 1 };
  }
  if (from.at < stops - 1) {
    return { kind: "stay" };
  }
  const next = withStops.find((card) => card > from.card);
  if (next === undefined) {
    return { kind: "after-control" };
  }
  return { card: next, kind: "card", stop: 0 };
}
