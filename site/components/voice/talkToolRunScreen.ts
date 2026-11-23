/**
 * Looking at the owner's screen for the voice: what a look would be of, and one frame of it as `read_screen`'s answer. Split
 * from `talkToolRun.ts` to keep it under the line cap.
 */
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";

import type { LookTaken } from "../../lib/screenFocus";
import { frameByteBudget, noScreenAnswer, type ScreenSight, screenOutputOf } from "../../lib/screenFrame";
import type { TalkRelayWire } from "../../lib/talkRelayRequestWire";
import { grabNativeScreenFrames, grabScreenFrames, type ScreenCapture, type ScreenShare } from "./screenGrab";

/** What the desktop app's own look is of: the whole display the voice is on (`desktop/src/nativeCapture.ts`). */
export const NATIVE_SURFACE = "the owner's whole screen";

/**
 * What a look at the owner's screen would be of, for the activity line: the share's surface, which `screenShotOf` looks
 * at first, else the desktop app's own whole-screen look.
 *
 * @param sharing what the owner's share is of, or `undefined` with none open
 * @param native whether this voice's window can look itself (`captureScreen`)
 * @returns the surface, or `undefined` when the voice has no way to see the owner's screen
 */
export function lookSurfaceOf({
  sharing,
  native,
}: {
  sharing: string | undefined;
  native: boolean;
}): string | undefined {
  if (sharing !== undefined) {
    return sharing;
  }
  if (native) {
    return NATIVE_SURFACE;
  }
  return undefined;
}

/**
 * One frame of the owner's screen as `read_screen`'s answer, or the refusal naming the step that gives one. A share the
 * owner opened is looked at first; with none, the desktop app looks itself when it can, so no share is asked of the
 * owner there.
 *
 * @param share the owner's screen share, when they opened one
 * @param native the desktop app's own look (`captureScreen`), in its voice window under a shell that has one
 * @param maxMessageSize the channel's largest message, which bounds the frame
 * @returns the answer, the image output when there is a frame, the log line's detail, and the picture a relay
 *   this turn carries — the same frame at relay size, or why there is none
 */
export async function screenShotOf({
  share,
  native,
  maxMessageSize,
}: {
  share: ScreenShare | undefined;
  native: (() => Promise<unknown>) | undefined;
  maxMessageSize: number | undefined;
}): Promise<{
  answer: unknown;
  output: ResponseFunctionCallOutputItemList | undefined;
  detail: string;
  relayScreen: TalkRelayWire["screen"];
  looked: LookTaken | undefined;
}> {
  const modelBudget = frameByteBudget({ maxMessageSize });
  let capture: ScreenCapture;
  let surface: string;
  let sight: ScreenSight;
  if (share !== undefined) {
    capture = await grabScreenFrames({ modelBudget, share });
    surface = share.surface;
    sight = "share";
  } else if (native !== undefined) {
    capture = await grabNativeScreenFrames({ capture: native, modelBudget });
    surface = NATIVE_SURFACE;
    sight = "native";
  } else {
    const answer = noScreenAnswer({ sight: "share", why: "The owner has not shared their screen in this call" });
    return {
      answer,
      detail: "no screen shared",
      looked: undefined,
      output: undefined,
      relayScreen: { kind: "none", reason: "screen-not-shared" },
    };
  }
  const { model: frame, relay } = capture;
  if ("why" in frame) {
    return {
      answer: noScreenAnswer({ sight, why: frame.why }),
      detail: frame.why,
      looked: undefined,
      output: undefined,
      relayScreen: relay,
    };
  }
  return {
    answer: undefined,
    detail:
      `${String(frame.size.width)}×${String(frame.size.height)} of ${surface}, ` +
      `${String(Math.round(frame.dataUrl.length / 1024))} KiB, ~${String(frame.tokens)} image tokens (estimate)`,
    looked: { sight, size: frame.size },
    output: screenOutputOf({ frame, surface }),
    relayScreen: relay,
  };
}
