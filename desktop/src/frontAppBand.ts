/**
 * The messenger band's own read of what is in front of the owner: names only, never a picture, only while the messenger is
 * open. Deliberately apart from `slopweaver:front-window`, which the drift and ISO
 * watches read and whose three-field reply stays exactly as it is.
 *
 * Clicking the messenger makes Slopweaver the front application, so "what is in front" would always answer the
 * messenger itself. The last application that was not Slopweaver is what the owner was looking at, so the band keeps it for
 * as long as the messenger stays open and forgets it the moment it closes — and answers it as `behind` while the
 * messenger has the focus, never as the application in front. It is the last external application SAMPLED, not
 * necessarily the window literally under the overlay: a quick trip through the console between two reads is missed.
 *
 * Pure: the epoch, the cache and the reply. The IPC is `frontAppBandShell.ts`.
 */
import type { FrontWindowReply } from "./frontWindow";

/** What the band's channel holds between reads. */
export interface FrontAppBandState {
  /** Whether the messenger is open now. */
  readonly open: boolean;
  /** Which opening this is, so a read begun under an earlier one cannot land on this one. */
  readonly epoch: number;
  /** The last application in front that was not Slopweaver, during this opening. */
  readonly lastExternal: FrontAppBandApp | undefined;
}

/** One application, as the band's channel answers it. */
export interface FrontAppBandApp {
  readonly kind: "app";
  readonly app: string;
  readonly bundleId: string | null;
  readonly title: string | null;
}

/**
 * The kept application while the messenger itself is in front: the last one sampled before it, never passed off as the
 * application in front. A page from before this kind reads it as no application and draws its own page instead,
 * which is the truer of the two claims it could make.
 */
export interface FrontAppBandBehind {
  readonly kind: "behind";
  readonly app: string;
  readonly bundleId: string | null;
  readonly title: string | null;
}

/** What the band's channel answers: an application, the one before the messenger, Slopweaver's console, or why none. */
export type FrontAppBandReply =
  FrontAppBandApp | FrontAppBandBehind | { readonly kind: "console" } | { readonly why: string };

/** Which of Slopweaver's own windows, if any, is in front. */
export type FrontProcess = "external" | "voice" | "console";

/** Before the messenger has ever reported. */
export const FRONT_APP_BAND_START: FrontAppBandState = { epoch: 0, lastExternal: undefined, open: false };

/**
 * The state after the messenger reports whether it is open.
 *
 * @param state the state before
 * @param open whether it is open now
 * @returns the same state when nothing changed; a new epoch on any change; a close forgets the application
 */
export function reportedMessengerOpen({ state, open }: { state: FrontAppBandState; open: boolean }): FrontAppBandState {
  if (state.open === open) {
    return state;
  }
  return { epoch: state.epoch + 1, lastExternal: undefined, open };
}

/**
 * The messenger's report, read strictly.
 *
 * @param value what the overlay sent
 * @returns whether it is open, or `undefined` for anything but exactly `{ open: boolean }`
 */
export function parseMessengerOpen({ value }: { value: unknown }): boolean | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || !("open" in value) || typeof value.open !== "boolean") {
    return undefined;
  }
  return value.open;
}

/**
 * What one finished read answers, and what the channel keeps of it.
 *
 * @param state the state as the read finished
 * @param startedEpoch the epoch as the read began
 * @param read what the read found
 * @param front whose window was in front
 * @returns the next state and the reply; a read from an earlier opening changes nothing and answers only why
 */
export function settledFrontAppBand({
  state,
  startedEpoch,
  read,
  front,
}: {
  state: FrontAppBandState;
  startedEpoch: number;
  read: FrontWindowReply;
  front: FrontProcess;
}): { readonly state: FrontAppBandState; readonly reply: FrontAppBandReply } {
  if (startedEpoch !== state.epoch) {
    return { reply: { why: "the messenger closed while the front window was read" }, state };
  }
  if ("why" in read) {
    return { reply: { why: read.why }, state };
  }
  if (front === "console") {
    // The owner has gone back to Slopweaver, so what was in front before is no longer what they are looking at.
    return { reply: { kind: "console" }, state: { ...state, lastExternal: undefined } };
  }
  if (front === "voice") {
    if (state.lastExternal === undefined) {
      return { reply: { kind: "console" }, state };
    }
    // Slopweaver IS in front: the owner clicked the messenger. Saying "Chrome is in front" here is what they saw
    // read false for minutes, so the kept application is answered as the one before it.
    return { reply: { ...state.lastExternal, kind: "behind" }, state };
  }
  const reply: FrontAppBandApp = { app: read.app, bundleId: read.bundleId, kind: "app", title: read.title };
  return { reply, state: state.open ? { ...state, lastExternal: reply } : state };
}
