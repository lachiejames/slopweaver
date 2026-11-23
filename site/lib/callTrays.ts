/**
 * The call widget's trays: what opens in the conversation's place inside the one card in the bottom right, or in the
 * stage, one at a time and the same tray in both views. The trays form a dedicated section, more may follow, and
 * only one is ever open at once. Each tray has its own button, and pressing it again closes it, the
 * way the orb opens and closes the widget; pressing another's swaps the one open. So the state is one tray or none, and
 * the reducer is the whole rule. Pure.
 *
 * With none open the card shows Messenger, the conversation and the box to type in: it is the card's resting content,
 * never a tray of its own, so it needs no button to appear and disappear. The card stays in the bottom right, with
 * Messenger on the right. On the stage, which already shows the conversation on its right,
 * Messenger is only its box under that conversation, and an open tray takes the left half.
 */

/**
 * One tray the widget can open over Messenger: the running list, what the voice is doing, and its microphone and
 * speaker.
 */
export type CallTray = "list" | "details" | "audio";

/**
 * The corner card, in rem: its 34.2rem, what the window keeps clear under and around it where the window is shorter —
 * the orb, the gap over it and the margins — and the floor it never goes under, room for the header's 3.4rem, the
 * band's 3.1rem and the box to type in, so a short screen squeezes the slot alone, never a control or a fixed row.
 */
const CORNER_CARD = { clearRem: 9.8, floorRem: 11 } as const;

/** The corner card's own height at its Small size, rem: what it opens at until the owner picks or drags another. */
export const CORNER_CARD_HEIGHT_REM = 34.2;

/**
 * The root's custom property the desktop overlay writes with the screen's work-area height (`useOverlayExtent.ts`).
 * The overlay's window is the corner the card opens in, sized off the card's own height, so a card bounded by `100vh`
 * there is bounded by itself and collapses to nothing; the screen is what the card has to fit on.
 */
export const SCREEN_HEIGHT_PROPERTY = "--sw-screen-height";

/**
 * The corner card's height as CSS: its own, or the screen less what it keeps clear where the screen is shorter — the
 * viewport in a browser tab, which sets no screen height. The conversation and every tray fill the one slot left inside
 * that height, so swapping them never moves an edge. However tall the owner sizes it, the screen bound keeps it on
 * screen.
 *
 * @param heightRem the height the owner chose (`messengerSize.ts`), before the screen bounds it
 * @returns the CSS height
 */
export function cardHeightCss({ heightRem }: { heightRem: number }): string {
  return `max(${String(CORNER_CARD.floorRem)}rem, min(${String(heightRem)}rem, calc(var(${SCREEN_HEIGHT_PROPERTY}, 100vh) - ${String(CORNER_CARD.clearRem)}rem - var(--sw-orb-floor, 0px))))`;
}

/**
 * The corner card's width as CSS: the owner's, or the window less the widget's margins and the work area's insets
 * where the window is narrower, so a long title truncates rather than widening it.
 *
 * @param widthRem the width the owner chose (`messengerSize.ts`), before the window bounds it
 * @returns the CSS width
 */
export function cardWidthCss({ widthRem }: { widthRem: number }): string {
  return `min(${String(widthRem)}rem, calc(100vw - 2.5rem - var(--sw-inset-left, 0px) - var(--sw-inset-right, 0px)))`;
}

/** The trays, in the order their buttons sit in the bar. */
export const CALL_TRAYS: readonly CallTray[] = ["list", "details", "audio"];

/**
 * The tray open after a press on one tray's button: that tray, unless it was already the one open, which closes it.
 *
 * @param open the tray open now, `undefined` with none
 * @param pressed the tray whose button the owner pressed
 * @returns the tray open after it, `undefined` with none
 */
export function nextTray({ open, pressed }: { open: CallTray | undefined; pressed: CallTray }): CallTray | undefined {
  if (open === pressed) {
    return undefined;
  }
  return pressed;
}

/** What each tray's button is called, closed and open: its tooltip and accessible name. */
const TRAY_WORDS: Readonly<Record<CallTray, { readonly closed: string; readonly open: string }>> = {
  audio: { closed: "microphone and speaker", open: "close microphone and speaker" },
  details: { closed: "session details", open: "close session details" },
  list: { closed: "running list", open: "close running list" },
};

/**
 * A tray's name, for its region's accessible name wherever it is drawn.
 *
 * @returns its name, as its closed button says it
 */
export function trayWordOf({ tray }: { tray: CallTray }): string {
  return TRAY_WORDS[tray].closed;
}

/** One tray button as the bar draws it. */
export interface CallTrayButton {
  readonly tray: CallTray;
  /** Its tooltip and accessible name, which say what a press does now. */
  readonly word: string;
  /** Whether its tray is the one open. */
  readonly pressed: boolean;
}

/**
 * The bar's tray buttons, one per tray, each pressed while its tray is the one open.
 *
 * @param open the tray open now, `undefined` with none
 * @returns the buttons, in the order they are drawn
 */
export function trayButtonsOf({ open }: { open: CallTray | undefined }): readonly CallTrayButton[] {
  return CALL_TRAYS.map((tray) => {
    const pressed = tray === open;
    let word = TRAY_WORDS[tray].closed;
    if (pressed) {
      word = TRAY_WORDS[tray].open;
    }
    return { pressed, tray, word };
  });
}
