/**
 * Every look the provider takes at the owner's screen, built in one place: a call's two (the owner's ask's frame and the `read_screen`
 * tool's) and a typed message's one. A typed look runs under `typedLookGate`'s authority, spent synchronously so two
 * calls in one turn take one frame, and asks the shell for a look that needs no call.
 *
 * Each `read_screen` is also credited to the application it landed on, by reading what is in front on either side of
 * it: a look that straddled a switch of application is credited to neither (`messengerBand.ts`). Those reads are names
 * only and go to the band, never to the model.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { FrameTaken } from "../../lib/edgeGlow";
import { frontAppBandOf } from "../../lib/messengerBand";
import type { LookTaken } from "../../lib/screenFocus";
import { type TypedLookState, typedLookGate } from "../../lib/typedLookGate";
import type { DesktopVoiceSeam } from "./desktopVoiceSeam";
import { screenLookSeam } from "./screenLookSeam";
import type { screenShotOf } from "./talkToolRunScreen";

/** What one look came to. */
type ScreenShot = Awaited<ReturnType<typeof screenShotOf>>;

/** What `read_screen`'s run reads a look through, and where it finds what the look landed on. */
export interface ToolLook {
  readonly screenShot: () => Promise<ScreenShot>;
  /** The application the look stayed on throughout, once it has run; `undefined` for none. */
  readonly lookedApp: () => string | undefined;
}

/**
 * The look a typed message did not ask for: words for the model, and no frame.
 *
 * @param reason what the model is told
 * @returns a look that took nothing
 */
export function refusedLook({ reason }: { reason: string }): ScreenShot {
  return {
    answer: reason,
    detail: "not asked for in this message",
    looked: undefined,
    output: undefined,
    relayScreen: { kind: "none", reason: "screen-not-shared" },
  };
}

/**
 * Run one look under a typed message's authority.
 *
 * @param typedLook the authority held, marked spent before anything awaits
 * @param look the look to take once allowed
 * @returns the look's seam
 */
export function gatedTypedLook({
  typedLook,
  look,
}: {
  typedLook: RefObject<TypedLookState | undefined>;
  look: () => Promise<ScreenShot>;
}): () => Promise<ScreenShot> {
  return async () => {
    const decision = typedLookGate({ state: typedLook.current, tool: "read_screen" });
    if (decision.kind === "refuse") {
      return refusedLook({ reason: decision.reason });
    }
    // An allow means the authority is there. Spent here, before anything awaits.
    typedLook.current = { ...typedLook.current!, spent: true };
    return look();
  };
}

/**
 * Credit one look to the application in front on both sides of it.
 *
 * @param front the shell's read of what is in front, `undefined` under a shell without one
 * @returns the look's seam, and what it landed on once it has run
 */
export function creditedLook({
  look,
  front,
}: {
  look: () => Promise<ScreenShot>;
  front: (() => Promise<unknown>) | undefined;
}): ToolLook {
  let app: string | undefined;
  const sample = async (): Promise<string | undefined> => {
    if (front === undefined) {
      return undefined;
    }
    const value = await front().catch(() => undefined);
    // Only the application is read here, never where it sits, so a reply behind the messenger credits it the same.
    return frontAppBandOf({ messengerFocused: false, sampledAtIso: new Date().toISOString(), value })?.appKey;
  };
  return {
    lookedApp: () => app,
    screenShot: async () => {
      const before = sample();
      const shot = await look();
      const [from, to] = [await before, await sample()];
      app = shot.output !== undefined && from !== undefined && from === to ? from : undefined;
      return shot;
    },
  };
}

/** The provider's live state every look reads and marks, the desktop app's own look aside. */
type LookRefs = Omit<Parameters<typeof screenLookSeam>[0]["refs"], "native">;

/**
 * The provider's looks.
 *
 * @param refs the provider's live state a look reads and marks
 * @param seam the provider's place in the desktop shell, read as each look is taken
 * @param typedLook the typed message's authority to look
 * @param setFrameTaken the edge pulse's record of the latest frame
 * @param noteLook tells `focus_screen`'s gate the latest look
 * @returns the owner's ask's frame on a call, and `read_screen`'s look on a call or a typed turn
 */
export function screenLooks({
  refs,
  seam,
  typedLook,
  setFrameTaken,
  noteLook,
}: {
  refs: LookRefs;
  seam: RefObject<DesktopVoiceSeam | undefined>;
  typedLook: RefObject<TypedLookState | undefined>;
  setFrameTaken: Dispatch<SetStateAction<FrameTaken | undefined>>;
  noteLook: (input: { looked: LookTaken | undefined; ownerTurnId: string | undefined }) => void;
}): {
  readonly ask: (input: { mine: number; token: string }) => () => Promise<ScreenShot>;
  readonly tool: (input: { mine: number; token: string; typed: boolean }) => ToolLook;
} {
  const seamLook = ({
    mine,
    token,
    role,
    native,
  }: {
    mine: number;
    token: string;
    role: "ask" | "tool";
    native: () => (() => Promise<unknown>) | undefined;
  }): (() => Promise<ScreenShot>) =>
    screenLookSeam({ mine, noteLook, refs: { ...refs, native }, role, setFrameTaken, token });
  const callNative = (): (() => Promise<unknown>) | undefined => seam.current?.captureScreen;
  // Only a shell that says so takes a typed look; an older one would refuse it as having no call.
  const typedNative = (): (() => Promise<unknown>) | undefined => {
    const captureScreen = seam.current?.supportsTypedScreenLook === true ? seam.current.captureScreen : undefined;
    return captureScreen === undefined ? undefined : () => captureScreen({ typedAsk: true });
  };
  return {
    ask: ({ mine, token }) => seamLook({ mine, native: callNative, role: "ask", token }),
    tool: ({ mine, token, typed }) => {
      const look = seamLook({ mine, native: typed ? typedNative : callNative, role: "tool", token });
      return creditedLook({
        front: seam.current?.frontAppBand,
        look: typed ? gatedTypedLook({ look, typedLook }) : look,
      });
    },
  };
}
