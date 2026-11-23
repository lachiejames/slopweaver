/**
 * `read_screen`'s seam on the page: take one look, keep it for a relay this turn when it is still the latest, pulse the
 * edge for a frame actually taken, and tell `focus_screen`'s gate what it may point into. Its own file so
 * `VoiceProvider.tsx` stays under the line cap.
 */
import type { OpenAILiveWebRTC } from "openai/live/webrtc";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { type FrameTaken, frameTakenOf } from "../../lib/edgeGlow";
import { type LookTaken, latestOwnerTurnOf } from "../../lib/screenFocus";
import type { HeardSegment } from "../../lib/voiceTranscript";
import { stillMine } from "../live/talkSession";
import type { TurnWindow } from "./relayAttempt";
import type { ScreenShare } from "./screenGrab";
import { screenShotOf } from "./talkToolRunScreen";

/** What one look came to, as `screenShotOf` answers it. */
type ScreenShot = Awaited<ReturnType<typeof screenShotOf>>;

/** The frame the owner's look ask took, held for the `read_screen` that same turn of theirs makes next. */
export interface AskFrame {
  /** The owner's turn the ask was heard on. */
  readonly ownerTurnId: string | undefined;
  /** When the look began, on the page's `performance.now()` clock. */
  readonly atMs: number;
  /** The look, settled or still running. */
  readonly shot: Promise<ScreenShot>;
}

/**
 * How long after the owner's look ask began its frame a `read_screen` of the same turn of theirs is answered with that
 * frame rather than a second capture. MEASURED: the thread's `read_screen` reached the page 7–8 s after the
 * hand-off (`docs/console/`'s "The voice sees the owner's screen" page, its "late" row); twice that is the margin, and past it the frame
 * is old enough that a fresh look is the honest answer.
 */
export const ASK_FRAME_REUSE_MS = 15_000;

/**
 * The ask's frame a `read_screen` may answer with: one taken on the same turn of the owner's, recently. Without it, every
 * look ask would send the owner's screen twice — once steered in by the console, once by the `read_screen` the prompt asks for first.
 *
 * @param kept the ask's frame the page holds, if any
 * @param ownerTurnId the owner's turn the `read_screen` call is answering
 * @param nowMs the page clock now
 * @returns the frame to answer with, or undefined when the call takes its own
 */
export function askFrameFor({
  kept,
  ownerTurnId,
  nowMs,
}: {
  kept: AskFrame | undefined;
  ownerTurnId: string | undefined;
  nowMs: number;
}): AskFrame | undefined {
  if (kept === undefined || ownerTurnId === undefined || kept.ownerTurnId !== ownerTurnId) {
    return undefined;
  }
  if (nowMs - kept.atMs > ASK_FRAME_REUSE_MS) {
    return undefined;
  }
  return kept;
}

/**
 * The look for one `read_screen` call, or for the owner's look ask's frame.
 *
 * @param refs the provider's live state the look reads and marks, and the desktop app's own look read at call time
 * @param mine the session the call belongs to
 * @param token the call's token, which names the frame it takes
 * @param setFrameTaken the edge pulse's record of the latest frame
 * @param noteLook tells `focus_screen`'s gate the latest look and the owner's turn it started on, or that it took no frame
 * @param role `ask` keeps the frame for the turn's `read_screen`; `tool` answers with that frame when it may
 * @returns the seam `runTalkTool` calls
 */
export function screenLookSeam({
  refs,
  mine,
  token,
  setFrameTaken,
  noteLook,
  role,
}: {
  refs: {
    latestLook: RefObject<number>;
    turnWindow: RefObject<TurnWindow>;
    share: RefObject<ScreenShare | undefined>;
    connection: RefObject<OpenAILiveWebRTC | undefined>;
    generation: RefObject<number>;
    heard: RefObject<{ readonly segments: readonly HeardSegment[] }>;
    native: () => (() => Promise<unknown>) | undefined;
    askFrame: RefObject<AskFrame | undefined>;
  };
  mine: number;
  token: string;
  setFrameTaken: Dispatch<SetStateAction<FrameTaken | undefined>>;
  noteLook: (input: { looked: LookTaken | undefined; ownerTurnId: string | undefined }) => void;
  role: "ask" | "tool";
}): () => Promise<ScreenShot> {
  const take = async ({ ownerTurnId }: { ownerTurnId: string | undefined }): Promise<ScreenShot> => {
    // The look the owner asked for replaces whatever an earlier one left for a relay, and is cleared while it runs: a
    // relay racing it carries no picture rather than the frame before. It is kept only by the latest look, in
    // the window, session and share it was taken in.
    refs.latestLook.current += 1;
    const look = refs.latestLook.current;
    const lookedIn = refs.turnWindow.current;
    const lookedAt = refs.share.current;
    lookedIn.availableScreen = undefined;
    // Counted on the window it started in, so a relay fired while any look runs carries no picture.
    lookedIn.looksRunning += 1;
    let shot: ScreenShot;
    try {
      shot = await screenShotOf({
        maxMessageSize: refs.connection.current?.peerConnection.sctp?.maxMessageSize,
        native: refs.native(),
        share: lookedAt,
      });
    } finally {
      lookedIn.looksRunning -= 1;
    }
    const sameSession = stillMine({ current: refs.generation.current, mine });
    const current =
      sameSession &&
      refs.latestLook.current === look &&
      refs.turnWindow.current === lookedIn &&
      refs.share.current === lookedAt;
    if (current) {
      lookedIn.availableScreen = shot.relayScreen;
      // The latest look is the only one `focus_screen` may point into; one that took no frame leaves nothing to.
      noteLook({ ownerTurnId, looked: shot.looked });
    }
    // Every frame actually taken pulses the edge, even one a newer look or tool has overtaken.
    if (sameSession && shot.output !== undefined) {
      setFrameTaken(frameTakenOf({ segments: refs.heard.current.segments, token }));
    }
    return shot;
  };
  return async () => {
    // The turn a picture can answer is the one the owner was on as it was taken; one they began meanwhile, it predates.
    const ownerTurnId = latestOwnerTurnOf({ segments: refs.heard.current.segments });
    if (role === "ask") {
      const shot = take({ ownerTurnId });
      refs.askFrame.current = { atMs: performance.now(), ownerTurnId, shot };
      return shot;
    }
    const kept = askFrameFor({ ownerTurnId, kept: refs.askFrame.current, nowMs: performance.now() });
    if (kept !== undefined) {
      // Spent once: a second `read_screen` this turn is asking for a newer look.
      refs.askFrame.current = undefined;
      const asked = await kept.shot.catch(() => undefined);
      if (asked?.output !== undefined) {
        return { ...asked, detail: `${asked.detail} (the frame the owner's look ask took)` };
      }
    }
    return take({ ownerTurnId });
  };
}
