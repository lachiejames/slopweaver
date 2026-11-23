/*
 * The words the call widget draws around the conversation: what the voice believes it is looking at, and the
 * one-line summary the call's relays fold behind in the session details tray (`components/voice/VoiceSession.tsx`).
 *
 * Pure, so the unit lane holds them without React. The chip says only what the voice has been TOLD — the
 * title a page registered and what the owner's screen share is of. A page's reading and its open item reach the voice
 * only when the model asks for them (`components/voice/voiceContext.ts`, `usePageReading`), so the chip never
 * claims the voice has read the page.
 */
import type { ScreenSight } from "./screenFrame";

/** The chip's two halves: the short label drawn on it, and the sentence its tooltip carries. */
export interface VoiceSees {
  readonly label: string;
  readonly detail: string;
}

/**
 * What the voice believes the owner is looking at.
 *
 * @param pageTitle the title the current page registered, `""` when none has
 * @param sharing what the owner's screen share is of, in the voice's third person (`screenGrab.ts`), or `undefined`
 *   when the owner is not sharing
 * @param sight how the voice sees the owner's screen — `native` in the desktop app, which looks itself with no share, so the
 *   chip never says the owner is sharing (`screenFrame.ts` `ScreenSight`)
 * @returns the chip's label and tooltip
 */
export function voiceSeesWords({
  pageTitle,
  sharing,
  sight,
}: {
  pageTitle: string;
  sharing: string | undefined;
  sight: ScreenSight;
}): VoiceSees {
  let page = `on ${pageTitle}`;
  let pageDetail = `It believes you are on ${pageTitle}, and reads that page only when it asks to.`;
  if (pageTitle === "") {
    page = "no page named";
    pageDetail = "No page has told it where you are.";
  }
  if (sharing === undefined && sight === "native") {
    // Asking is the model's instruction, not a gate, so the chip claims only what the app enforces.
    return {
      detail:
        `${pageDetail} It can take one picture of your whole screen each time it looks, and is told to look only ` +
        "when you ask. The edge of your screen flashes for every picture.",
      label: `${page} · can look`,
    };
  }
  if (sharing === undefined) {
    return { detail: `${pageDetail} You are not sharing your screen.`, label: page };
  }
  const yours = sharing.replace(/^the owner's /u, "your ").replace(/ they picked$/u, " you picked");
  return { detail: `${pageDetail} It can see ${yours}.`, label: `${page} · sharing` };
}

/** How a relay attempt ended, in the order the summary counts them. */
const RELAY_ORDER = ["relayed", "board-only", "sending", "shut", "refused", "unknown"] as const;

/** One relay's outcome, as `RelayLine` records it. */
export type RelayOutcome = (typeof RELAY_ORDER)[number];

/**
 * The relays folded to one line: each outcome that happened, counted, in a fixed order.
 *
 * @param outcomes each relay attempt's outcome, oldest first
 * @returns e.g. `2 relayed · 1 board-only`, or `""` when nothing was relayed
 */
export function relaySummary({ outcomes }: { outcomes: readonly RelayOutcome[] }): string {
  return RELAY_ORDER.map((outcome) => ({ count: outcomes.filter((each) => each === outcome).length, outcome }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${String(entry.count)} ${entry.outcome}`)
    .join(" · ");
}
