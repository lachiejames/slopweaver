/**
 * The voice sees the owner's screen natively in the shell: one still of the display the voice is on, taken by the
 * main process when the model calls `read_screen`, with no screen share for the owner to start. macOS does not let
 * one screen be shared with two applications at once, and the voice is a floating, always-on-top desktop app, so it
 * needs no screen sharing from Slopweaver. The shell holds macOS's Screen Recording permission, and a look is
 * `desktopCapturer.getSources` of the screen as the owner sees it, the voice's own window in it (what the owner
 * sees is what the voice sees).
 *
 * What stays from the share's consent model (`site/lib/screenFrame.ts`): a frame is taken only on `read_screen`,
 * only from the voice's own window, only while a call the owner started is up or for a typed message that asked with the
 * messenger open ({@link lookRefusal}). No frame is sampled on a timer. Pure: `main.ts` applies it.
 */

/** A width and a height in pixels. */
export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The longest edge a still keeps — the relay picture's own (`site/lib/screenFrame.ts` `RELAY_FRAME_LONG_EDGE`),
 * since the model's copy is scaled down from it and nothing larger is ever sent.
 */
export const NATIVE_CAPTURE_LONG_EDGE = 2048;

/**
 * What the main process answers the voice's window: one still as PNG bytes, which cross IPC as a `Uint8Array` rather
 * than a data-sized string, or why there is none. A refusal macOS Screen Recording caused says so in `cause`, so the
 * page relays the permission to grant rather than a share that gave no frame — the voice looked with no share at all.
 */
export type NativeCaptureReply =
  | { readonly png: Uint8Array; readonly width: number; readonly height: number }
  | { readonly why: string; readonly cause?: typeof SCREEN_RECORDING_CAUSE };

/** The `cause` a refusal carries when macOS Screen Recording is what refused the look. */
export const SCREEN_RECORDING_CAUSE = "screen-recording-off";

/**
 * The one line the voice's refusal, the launch check and the menu bar all carry while macOS has not let the shell
 * see the owner's screen: the exact switch, and what to do when that switch already shows on — a grant made to an
 * earlier build, which macOS lists as on while refusing this one (`src/desktop/signing.ts`).
 */
export const SCREEN_RECORDING_OFF =
  "Screen Recording is off for Slopweaver: turn on Slopweaver in System Settings › Privacy & Security › Screen & System Audio Recording, then quit and reopen it (already on? remove it with −, and the next look asks again)";

/**
 * A size with its longest edge brought down to {@link NATIVE_CAPTURE_LONG_EDGE}, keeping its aspect ratio — never
 * scaled UP. Applied twice: to the box asked of macOS, and to the still it hands back, which `desktopCapturer` does
 * not promise is exactly the size asked for.
 *
 * @param source the size to fit
 * @returns the fitted size, whole pixels, at least one each way
 */
export function fittedNativeCaptureSize({ source }: { source: PixelSize }): PixelSize {
  const fit = Math.min(1, NATIVE_CAPTURE_LONG_EDGE / Math.max(source.width, source.height, 1));
  return {
    height: Math.max(1, Math.round(source.height * fit)),
    width: Math.max(1, Math.round(source.width * fit)),
  };
}

/**
 * The box to ask macOS for: the whole display — menu bar and Dock included, as a share of it showed — in physical
 * pixels, fitted by {@link fittedNativeCaptureSize}.
 *
 * @param size the display's size in points (`Display.size`, never its work area)
 * @param scaleFactor its backing scale (`Display.scaleFactor`)
 * @returns the box, or `undefined` when the display reports no usable size or scale
 */
export function nativeCaptureSize({
  size,
  scaleFactor,
}: {
  size: PixelSize;
  scaleFactor: number;
}): PixelSize | undefined {
  const usable = [size.width, size.height, scaleFactor].every((value) => Number.isFinite(value) && value > 0);
  if (!usable) {
    return undefined;
  }
  return fittedNativeCaptureSize({ source: { height: size.height * scaleFactor, width: size.width * scaleFactor } });
}

/**
 * The screen source showing one display: the one whose `display_id` is that display's — never the first listed, and
 * never a source that names no display, since a still of the wrong screen would be read as the one the owner is looking at.
 *
 * @param sources what `desktopCapturer.getSources({ types: ["screen"] })` listed
 * @param displayId the display the voice sits on (`Display.id`)
 * @returns that source, or `undefined` when none names it
 */
export function sourceForDisplay<Source extends { readonly display_id: string }>({
  sources,
  displayId,
}: {
  sources: readonly Source[];
  displayId: number;
}): Source | undefined {
  return sources.find((source) => source.display_id !== "" && source.display_id === String(displayId));
}

/**
 * Why no look may be taken now, when there is no call up: main refuses a still unless the voice's window reports a call
 * AND holds a live microphone track of its own — the track macOS marks with its own microphone indicator, never the
 * console window's — so the permission is spent only inside a call the owner started. Both are
 * what the voice's window reports, so a renderer that lied about both could still look; the model, the threat this
 * closes, cannot make either true.
 *
 * @param overlayCallActive whether the voice's window last reported a call up
 * @param overlayAudioTracks live microphone tracks in the voice's own window
 * @returns `undefined` while a call is up, else why there is no picture
 */
export function noCallRefusal({
  overlayCallActive,
  overlayAudioTracks,
}: {
  overlayCallActive: boolean;
  overlayAudioTracks: number;
}): string | undefined {
  if (overlayCallActive && overlayAudioTracks > 0) {
    return undefined;
  }
  return "the voice looks only during a call you started, and none is up";
}

/**
 * Why no look may be taken now, under either of the two things that allow one: the live-call proof
 * ({@link noCallRefusal}), or a typed ask while the messenger is open. A typed ask to
 * look is first class, and looks only on that ask. `focus_screen` never comes through here and stays call-only.
 *
 * @param overlayCallActive whether the voice's window last reported a call up
 * @param overlayAudioTracks live microphone tracks in the voice's own window
 * @param messengerOpen whether the messenger last reported itself open
 * @param typedAsk whether this look was asked for by a typed message
 * @returns `undefined` when the look may be taken, else why there is no picture
 */
export function lookRefusal({
  overlayCallActive,
  overlayAudioTracks,
  messengerOpen,
  typedAsk,
}: {
  overlayCallActive: boolean;
  overlayAudioTracks: number;
  messengerOpen: boolean;
  typedAsk: boolean;
}): string | undefined {
  // A typed look stands on the messenger alone: closed, it refuses even with a call up.
  if (typedAsk) {
    return messengerOpen ? undefined : "a typed look needs the messenger open, and it was closed";
  }
  return noCallRefusal({ overlayAudioTracks, overlayCallActive });
}

/** The messenger as main last heard it: open or not, and an epoch that moves on every open and every close. */
export interface MessengerReport {
  readonly open: boolean;
  readonly epoch: number;
}

/**
 * Whether the messenger has stayed open since a look began: open now, and no close and reopen in between. A close that
 * lands while macOS takes the still is a close, even if the owner reopened it before the still came back.
 *
 * @param started the messenger as the look began
 * @param now the messenger as it is now
 * @returns true only when it is open and its epoch has not moved
 */
export function messengerHeldOpen({ started, now }: { started: MessengerReport; now: MessengerReport }): boolean {
  return now.open && now.epoch === started.epoch;
}

/**
 * What the voice's window asked of one capture, read strictly: nothing at all for a call's look, or exactly
 * `{ typedAsk: true }`.
 *
 * @param value what the voice's window sent
 * @returns whether the look is a typed ask's, or `undefined` for anything else
 */
export function captureAskOf({ value }: { value: unknown }): { readonly typedAsk: boolean } | undefined {
  if (value === undefined) {
    return { typedAsk: false };
  }
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 1) {
    return undefined;
  }
  return "typedAsk" in value && value.typedAsk === true ? { typedAsk: true } : undefined;
}

/**
 * Whether macOS lets the shell see the owner's screen, from `systemPreferences.getMediaAccessStatus("screen")` read AFTER
 * the attempt — the attempt is what raises macOS's own prompt the first time. Only `granted` is: without it macOS
 * withholds other apps' windows, and the voice would describe a screen the owner is not looking at.
 *
 * Only an answer the owner can change carries the `cause` that makes a relay tell them to grant it: `denied`, and
 * `not-determined` (the prompt went unanswered). `restricted` is a device policy they cannot change, and `unknown`
 * says nothing about the switch, so those refuse without it and relay as a look that gave no frame. The pinned
 * Electron answers only `granted` or `denied` for the screen, so a device policy reaches here as `denied`, and the
 * relay's own words allow for that.
 *
 * @param status what macOS answered
 * @returns `undefined` when granted, else the refusal naming the switch, a `cause` only when the owner can grant it
 */
export function screenRecordingRefusal({
  status,
}: {
  status: string;
}): { readonly why: typeof SCREEN_RECORDING_OFF; readonly cause?: typeof SCREEN_RECORDING_CAUSE } | undefined {
  if (status === "granted") {
    return undefined;
  }
  if (status === "denied" || status === "not-determined") {
    return { cause: SCREEN_RECORDING_CAUSE, why: SCREEN_RECORDING_OFF };
  }
  return { why: SCREEN_RECORDING_OFF };
}
