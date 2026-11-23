/**
 * The orb's call card and Messenger: what a press on the corner orb opens, and what its composer, header and orb say.
 * It is the archive's intercom widget: sat in the bottom right, typed into, switchable to voice mode, because the Talk
 * page's typed box was a text input the owner could not find. The orb stays the same size, the hearing-you status and
 * the page or card the owner is on sit on the card, and the call's controls sit on it.
 *
 * The card is two fixed-height rows, the conversation, then the box: a header carrying the voice's live state and every
 * control, the band saying what the owner is looking at (`messengerBand.ts`), the conversation or one tray at most in
 * its place, and the box to type in, last. Messenger has no button of its own to make it appear and disappear.
 *
 * Every control is a round icon whose word is its tooltip and accessible name, as on the stage, never over the
 * transcript; the inverse of the stage's move-to-corner is drawn as two arrows pointing away from each other. The
 * microphone and speaker tray's button is a chevron joined to the microphone control, Google Meet's place for it, which
 * is discoverable enough.
 *
 * Typing and a call stay one conversation on two transports, never two at once (`talkArbiter.ts`). So the box is
 * never read-only, and with a call up its button — and Enter — sends what the owner typed or pasted into that call,
 * where the voice takes it as their turn (`/api/talk/typed-in`), so a pasted Slack thread link needs no send button of
 * its own. The call stays up. Its placeholder is "Message", call or no call. No line of instructions sits under the
 * box: it would be noise.
 * Pure.
 */
import { type CallTray, trayButtonsOf } from "./callTrays";
import type { ScreenSight } from "./screenFrame";
import { stageRailOf } from "./stageRail";
import type { VoicePhase } from "./voiceActivity";

/** The typed conversation's phase, as `useTypedTalk` reports it. */
export type MessengerTypedPhase = "idle" | "opening" | "open" | "sending" | "replying";

/** The composer's placeholder, call or no call. */
export const MESSENGER_PLACEHOLDER = "Message";

/** What the composer's one button does now, and its words: send to the typed conversation, or into the live call. */
export type MessengerComposerMode =
  | { readonly kind: "send"; readonly target: "typed"; readonly button: "send" }
  | { readonly kind: "send"; readonly target: "call"; readonly button: "send to the call" }
  | { readonly kind: "busy"; readonly button: "opening…" | "sending…" | "answering…" };

/**
 * The composer's mode: a send into the call in flight first, then a call up, then the typed conversation's phase.
 *
 * @param callUp a call is up here or in the desktop shell's other window
 * @param phase the typed conversation's phase
 * @param sendingToCall a message the owner typed is on its way into the live call
 * @returns what the button does and says
 */
export function messengerComposerMode({
  callUp,
  phase,
  sendingToCall,
}: {
  callUp: boolean;
  phase: MessengerTypedPhase;
  sendingToCall: boolean;
}): MessengerComposerMode {
  if (sendingToCall) {
    return { button: "sending…", kind: "busy" };
  }
  if (callUp) {
    return { button: "send to the call", kind: "send", target: "call" };
  }
  if (phase === "opening") {
    return { button: "opening…", kind: "busy" };
  }
  if (phase === "sending") {
    return { button: "sending…", kind: "busy" };
  }
  if (phase === "replying") {
    return { button: "answering…", kind: "busy" };
  }
  return { button: "send", kind: "send", target: "typed" };
}

/** One control the call card can draw: a call control, or the button of one tray. */
export type MessengerControlId = "talk" | "mute" | "screen" | "end" | CallTray;

/** One control as the card draws it: an icon, with its word as tooltip and accessible name. */
export interface MessengerControl {
  readonly id: MessengerControlId;
  /** Its tooltip and accessible name, which change with its state. */
  readonly word: string;
  /** Whether it is on: muted, showing the screen, or its tray the one open. `undefined` for a control never pressed. */
  readonly pressed: boolean | undefined;
  /** Drawn but unable to act now: talk while a call is up in the shell's other window. */
  readonly disabled: boolean;
}

/** One tray button as a control. */
function trayControl({ open, tray }: { open: CallTray | undefined; tray: CallTray }): MessengerControl {
  const button = trayButtonsOf({ open }).find((row) => row.tray === tray)!;
  return { disabled: false, id: button.tray, pressed: button.pressed, word: button.word };
}

/**
 * The header's controls, left to right, all on its one row, with no second row of buttons. During a call: hang up, the microphone and
 * speaker chevron drawn joined to mute right after it, the stage's own screen control, the running list and session
 * details; full screen is a row of the size menu beside close (`MessengerResize.tsx`). With none: talk, the running list and session details; the microphone and speaker are
 * reached from session details then, and while their tray is open — opened there, or left open by a hang-up — its own
 * button joins the row, so it can be closed where it was opened. Mute's and screen's words and
 * pressed states are `stageRailOf`'s, so the two views never name one control two ways. Before the call has its live
 * session there is no mute, and the chevron stands alone.
 *
 * @param callActive a call is up in this window
 * @param callActiveAnywhere a call is up here or in the desktop shell's other window
 * @param openTray the tray open in the card, `undefined` with none
 * @param hasLive the call has its live session, which is what mute acts on
 * @param muted the owner's microphone is muted
 * @param sharing what the owner's screen share is of, `undefined` when not sharing
 * @param screenSight how the voice sees the owner's screen: a browser share, or the desktop app looking natively
 * @returns the controls in the order they are drawn
 */
export function messengerHeaderControls({
  callActive,
  callActiveAnywhere,
  openTray,
  hasLive,
  muted,
  sharing,
  screenSight,
}: {
  callActive: boolean;
  callActiveAnywhere: boolean;
  openTray: CallTray | undefined;
  hasLive: boolean;
  muted: boolean;
  sharing: string | undefined;
  screenSight: ScreenSight;
}): readonly MessengerControl[] {
  const trays = [trayControl({ open: openTray, tray: "list" }), trayControl({ open: openTray, tray: "details" })];
  if (!callActive) {
    const idle = [{ disabled: callActiveAnywhere, id: "talk", pressed: undefined, word: "talk" } as const, ...trays];
    if (openTray === "audio") {
      idle.push(trayControl({ open: openTray, tray: "audio" }));
    }
    return idle;
  }
  const controls: MessengerControl[] = [
    { disabled: false, id: "end", pressed: undefined, word: "hang up" },
    trayControl({ open: openTray, tray: "audio" }),
  ];
  for (const rail of stageRailOf({ callActive, hasLive, muted, preview: false, screenSight, sharing })) {
    if (rail.id === "mute" || rail.id === "screen") {
      controls.push({ disabled: false, id: rail.id, pressed: rail.pressed, word: rail.word });
    }
  }
  controls.push(...trays);
  return controls;
}

/**
 * The header's status line: the voice's live state during a call, which is what "on a call" only implied.
 *
 * @param callActiveAnywhere a call is up here or in the desktop shell's other window, which this window's own phase,
 *   `off` there, cannot say
 * @param headline the voice's state in words
 * @param phase where this window's call is, `off` with none up
 * @param seconds how long that state has held, when it is counted
 * @returns the words
 */
export function messengerHeaderStatus({
  callActiveAnywhere,
  headline,
  phase,
  seconds,
}: {
  callActiveAnywhere: boolean;
  headline: string;
  phase: VoicePhase;
  seconds: number | undefined;
}): string {
  if (phase === "off" && callActiveAnywhere) {
    return "on a call in the other window";
  }
  return messengerStatusWords({ headline, phase, seconds });
}

/**
 * The voice's state in words: the headline, and its age when it has one. With no call up the headline is the orb's
 * invitation, "talk", which beside the **talk** control reads as a second button, so it says there is no call.
 *
 * @param headline the voice's state in words
 * @param phase where the call is, `off` with none up
 * @param seconds how long that state has held, when it is counted
 * @returns the words
 */
export function messengerStatusWords({
  headline,
  phase,
  seconds,
}: {
  headline: string;
  phase: VoicePhase;
  seconds: number | undefined;
}): string {
  if (phase === "off") {
    return "no call up";
  }
  if (seconds === undefined) {
    return headline;
  }
  return `${headline} · ${String(seconds)}s`;
}

/**
 * The orb's accessible name, which is also its tooltip: a press opens or closes the call card, call or no call,
 * behind the voice's state during one.
 *
 * @param callActive a call is up in this window
 * @param headline the voice's state in words
 * @param open the call card is open
 * @returns the name
 */
export function messengerOrbLabel({
  callActive,
  headline,
  open,
}: {
  callActive: boolean;
  headline: string;
  open: boolean;
}): string {
  let action = "open the voice, then type or talk";
  if (open) {
    action = "close the voice";
  }
  if (!callActive) {
    return action;
  }
  return `${headline}: ${action}`;
}
