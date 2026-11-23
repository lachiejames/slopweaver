/**
 * The desktop shell's build, screen-still and focus replies, each read off the wire exactly (`./desktopShell.ts`), and
 * the record check every desktop-shell reader shares. Pure.
 */
import type { FocusRect } from "./screenFocus";

/** The commit an app build was made from (`desktop/src/shellBuild.ts` `ShellStamp`). */
export interface ShellStamp {
  readonly sha: string;
  readonly committedIso: string;
  /** `dirty` when the build carried desktop changes beyond that commit. */
  readonly tree: "clean" | "dirty";
}

/** The shell's word on its own build: a run from source, the running app's stamp, the installed app's. */
export interface ShellBuild {
  readonly dev: boolean;
  readonly running: ShellStamp | undefined;
  readonly installed: ShellStamp | undefined;
}

/**
 * One stamp off the wire — the shell's, or `checkout console --json`'s installed app: exactly a full sha, a
 * parseable instant and a tree word.
 *
 * @returns the stamp, `null` for the wire's no-stamp, or `undefined` when it is not exactly one
 */
export function stampOf({ value }: { value: unknown }): ShellStamp | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || Array.isArray(value) || Object.keys(value).length !== 3) {
    return undefined;
  }
  const { committedIso, sha, tree } = value;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/u.test(sha) || typeof committedIso !== "string") {
    return undefined;
  }
  if (Number.isNaN(Date.parse(committedIso)) || (tree !== "clean" && tree !== "dirty")) {
    return undefined;
  }
  return { committedIso, sha, tree };
}

/**
 * The shell's answer to `shellBuild` (`desktop/src/shellBuild.ts` `ShellBuildWire`): exactly `dev` and the two
 * stamps, each a stamp or `null`.
 *
 * @param value what `shellBuild` resolved to
 * @returns the build, or `undefined` when it is not exactly one
 */
export function shellBuildOf({ value }: { value: unknown }): ShellBuild | undefined {
  if (!isRecord(value) || Array.isArray(value) || Object.keys(value).length !== 3) {
    return undefined;
  }
  const { dev } = value;
  const running = stampOf({ value: value["running"] });
  const installed = stampOf({ value: value["installed"] });
  if (typeof dev !== "boolean" || running === undefined || installed === undefined) {
    return undefined;
  }
  return { dev, installed: offWire({ stamp: installed }), running: offWire({ stamp: running }) };
}

/** A stamp off the wire: the shell sends an absent one as `null`, which the page reads as `undefined`. */
function offWire({ stamp }: { stamp: ShellStamp | null }): ShellStamp | undefined {
  if (stamp === null) {
    return undefined;
  }
  return stamp;
}

/**
 * One still of the owner's screen the shell took, as PNG bytes with the size it declares, or why it took none —
 * `screenRecordingOff` when macOS Screen Recording is what refused the look, which a relay names as such.
 */
export type NativeScreenStill =
  | { readonly kind: "frame"; readonly png: Uint8Array; readonly width: number; readonly height: number }
  | { readonly kind: "refused"; readonly why: string; readonly screenRecordingOff: boolean };

/** The shell's `SCREEN_RECORDING_CAUSE`, restated because `desktop/` is another project. */
const SCREEN_RECORDING_CAUSE = "screen-recording-off";

/** The eight bytes every PNG opens with. */
const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The longest edge a still may have — the shell's `NATIVE_CAPTURE_LONG_EDGE`, restated because `desktop/` is another project. */
const STILL_LONG_EDGE = 2048;

/** The longest refusal carried across; a refusal is a sentence. */
const MAX_WHY = 512;

/** The answer when the shell's reply is not exactly one the voice can vouch for. */
const MALFORMED_STILL: NativeScreenStill = {
  kind: "refused",
  screenRecordingOff: false,
  why: "the desktop app answered the look with no picture the voice could read",
};

/**
 * One still off the shell (`desktop/src/nativeCapture.ts` `NativeCaptureReply`): exactly PNG bytes with a whole-pixel
 * size inside the shell's long edge, or exactly a one-line refusal, with Screen Recording as its `cause` or none. An
 * older shell sends the refusal alone. Anything else is a refusal naming the desktop app, so the voice says why
 * rather than describing a picture nobody checked.
 *
 * @param value what `captureScreen` resolved to
 * @returns the still, or why there is none
 */
export function nativeScreenStillOf({ value }: { value: unknown }): NativeScreenStill {
  if (!isRecord(value) || Array.isArray(value)) {
    return MALFORMED_STILL;
  }
  const keys = Object.keys(value).length;
  const { cause, height, png, why, width } = value;
  if ("why" in value) {
    const caused = "cause" in value;
    if (caused && cause !== SCREEN_RECORDING_CAUSE) {
      return MALFORMED_STILL;
    }
    if (keys !== (caused ? 2 : 1) || typeof why !== "string" || why.trim() === "" || why.length > MAX_WHY) {
      return MALFORMED_STILL;
    }
    return { kind: "refused", screenRecordingOff: caused, why: why.replace(/[\r\n]+/gu, " ") };
  }
  if (keys !== 3 || !(png instanceof Uint8Array) || !PNG_SIGNATURE.every((byte, at) => png[at] === byte)) {
    return MALFORMED_STILL;
  }
  if (png.length === PNG_SIGNATURE.length || !isStillEdge(width) || !isStillEdge(height)) {
    return MALFORMED_STILL;
  }
  return { height, kind: "frame", png, width };
}

/** Where the shell says to draw a lifted region in the voice's window, or why it will not. */
export type FocusRectReply =
  { readonly kind: "rect"; readonly rect: FocusRect } | { readonly kind: "refused"; readonly why: string };

/** The answer when the shell's reply to a lift is not exactly one the voice can vouch for. */
const MALFORMED_RECT: FocusRectReply = {
  kind: "refused",
  why: "the desktop app answered the highlight with nowhere the voice could draw it",
};

/**
 * The shell's answer to a lift (`desktop/src/screenFocus.ts` `FocusRegionReply`): exactly a rect of four finite,
 * non-negative CSS pixel numbers, or exactly a one-line refusal. Anything else is a refusal naming the desktop app.
 *
 * @param value what `focusRegion` resolved to
 * @returns the rect to draw, or why there is none
 */
export function focusRectReplyOf({ value }: { value: unknown }): FocusRectReply {
  if (!isRecord(value) || Array.isArray(value) || Object.keys(value).length !== 1) {
    return MALFORMED_RECT;
  }
  const { rect, why } = value;
  if ("why" in value) {
    if (typeof why !== "string" || why.trim() === "" || why.length > MAX_WHY) {
      return MALFORMED_RECT;
    }
    return { kind: "refused", why: why.replace(/[\r\n]+/gu, " ") };
  }
  if (!isRecord(rect) || Array.isArray(rect) || Object.keys(rect).length !== 4) {
    return MALFORMED_RECT;
  }
  const { height, left, top, width } = rect;
  if (!isCssEdge(height) || !isCssEdge(left) || !isCssEdge(top) || !isCssEdge(width)) {
    return MALFORMED_RECT;
  }
  return { kind: "rect", rect: { height, left, top, width } };
}

/** Whether a value is one finite, non-negative CSS pixel measure. */
function isCssEdge(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Whether a value is one edge of a still: whole pixels, at least one, inside the shell's long edge. */
function isStillEdge(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= STILL_LONG_EDGE;
}

/**
 * Whether a value is an object whose fields can be read by name.
 *
 * @returns true when its fields can be read by name
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
