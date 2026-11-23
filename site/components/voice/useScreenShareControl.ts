"use client";

/**
 * Sharing the owner's screen with the call: the browser's picker opened on their press, and closed by their Stop, by the share
 * ending in the browser, or by a newer press. Its own file so `./VoiceProvider.tsx` stays under the line cap.
 */
import { type RefObject, useCallback, useRef, useState } from "react";

import { stillMine } from "../live/talkSession";
import { stopTracks } from "./prepareCall";
import { closeScreenShare, openScreenShare, type ScreenShare } from "./screenGrab";
import type { ToolLine } from "./voiceContext";

/** The share, and the owner's two acts on it. */
export interface ScreenShareControl {
  /** The surface the owner is sharing, `undefined` when none is. */
  readonly sharing: string | undefined;
  /** The open share itself, read by a screen look at the moment it takes its frame. */
  readonly share: RefObject<ScreenShare | undefined>;
  /** Stop sharing the owner's screen. Also run by Stop: a share outliving the call it was opened for is not wanted. */
  readonly stopShare: () => void;
  /** Open the browser's screen picker; a click on the widget is the user gesture `getDisplayMedia` requires. */
  readonly shareScreen: () => Promise<void>;
}

/**
 * Hold the owner's screen share. A share chosen after the owner hung up — the picker can stay open across Stop — is closed rather
 * than kept, so a later session never inherits a screen offered to one that was ending. A capture still starting when
 * Stop is pressed is ended at the press, and a picker that fails after Stop says nothing to the next call.
 *
 * @param generation the provider's call generation, which a press is bound to
 * @param closing the generation the owner pressed end on
 * @param dropFrame takes the relay's available frame away: a stopped or replaced share's is not one a relay may carry
 * @param note writes a line in the call's log
 * @returns the share and its acts
 */
export function useScreenShareControl({
  generation,
  closing,
  dropFrame,
  note,
}: {
  generation: RefObject<number>;
  closing: RefObject<number | undefined>;
  dropFrame: () => void;
  note: (input: { line: ToolLine }) => void;
}): ScreenShareControl {
  const [sharing, setSharing] = useState<string | undefined>(undefined);
  const share = useRef<ScreenShare | undefined>(undefined);
  // Every capture the picker has returned but `openScreenShare` has not finished — two presses can overlap — so
  // Stop can end each at the press.
  const pendingShares = useRef(new Set<MediaStream>());

  const stopShare = useCallback((): void => {
    if (share.current !== undefined) {
      closeScreenShare({ share: share.current });
    }
    share.current = undefined;
    // A frame of a share the owner has stopped is not one a relay may carry; a picture an attempt already sent stays, since
    // a retry of that turn must replay it.
    dropFrame();
    for (const stream of pendingShares.current) {
      stopTracks({ stream });
    }
    pendingShares.current.clear();
    setSharing(undefined);
  }, [dropFrame]);

  const shareScreen = useCallback(async (): Promise<void> => {
    const mine = generation.current;
    if (closing.current === mine) {
      return;
    }
    stopShare();
    let captured: MediaStream | undefined;
    try {
      // Its own end clears only itself: a share this call closed must never take down one opened after it.
      const opened: ScreenShare = await openScreenShare({
        onEnded: () => {
          if (share.current === opened) {
            stopShare();
          }
        },
        onStream: (stream) => {
          captured = stream;
          // A picker that returns after Stop has nothing to join: its capture ends the moment it arrives.
          if (!stillMine({ current: generation.current, mine }) || closing.current === mine) {
            stopTracks({ stream });
            return;
          }
          pendingShares.current.add(stream);
        },
      });
      // Released while it was starting — by Stop, or by a newer press — so it is not this press's to keep.
      const released = !pendingShares.current.delete(opened.stream);
      if (released || !stillMine({ current: generation.current, mine }) || closing.current === mine) {
        closeScreenShare({ share: opened });
        return;
      }
      // An overlapping press that resolved first is replaced, never left capturing beside this one, and a frame of it
      // is no longer one a relay may carry.
      if (share.current !== undefined) {
        closeScreenShare({ share: share.current });
      }
      dropFrame();
      share.current = opened;
      setSharing(opened.surface);
    } catch (cause) {
      // A capture that failed to become a share has no owner left to end it, whatever threw.
      if (captured !== undefined) {
        pendingShares.current.delete(captured);
        stopTracks({ stream: captured });
      }
      if (!stillMine({ current: generation.current, mine }) || closing.current === mine) {
        return;
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      note({ line: { detail, ms: undefined, name: "share screen", refused: true, usage: undefined } });
    }
  }, [closing, dropFrame, generation, note, stopShare]);

  return { share, shareScreen, sharing, stopShare };
}
