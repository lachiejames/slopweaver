"use client";

/**
 * Where the voice plays: the owner's speaker pick while it is connected, else the device the Mac's default names now, so a
 * headset plugged in mid-call takes the voice with it. A pick that is gone becomes
 * the system default and stays. `useAudioRoute.ts` holds the device list and the owner's picks; this routes the element.
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { type DeviceRow, SYSTEM_DEFAULT, speakerFollowOf } from "../../lib/audioDevices";
import { causeWords } from "./audioRouteBrowser";

/**
 * The speaker's route, applied to the element the voice plays through, call or not.
 *
 * @param devices the device list last read
 * @param output the owner's stored speaker pick: a device id, or `default`
 * @param setOutput stores a new speaker pick, used when the owner's pick is gone
 * @param speaker the element the voice plays through
 * @returns what the speaker plays on, why its last route was refused, whether this browser can choose a speaker, the
 *   device it plays on at this instant, and this render's retry of a refused route for a fresh device list
 */
export function useSpeakerRoute({
  devices,
  output,
  setOutput,
  speaker,
}: {
  devices: readonly DeviceRow[];
  output: string;
  setOutput: (next: string) => void;
  speaker: RefObject<HTMLAudioElement | null>;
}): {
  readonly outputFailed: string | undefined;
  readonly playingOn: () => string | undefined;
  readonly retryRoute: (rows: readonly DeviceRow[]) => void;
  readonly sinkId: string;
  readonly supported: boolean;
} {
  const supported = useSyncExternalStore(subscribeNever, sinkSupported, () => true);
  const [sinkId, setSinkId] = useState("");
  const [outputFailed, setOutputFailed] = useState<string | undefined>(undefined);
  // Whether the speaker's last route was refused, so the next device list retries it — and only then.
  const speakerFailed = useRef(false);
  // Bumped by every speaker route, so only the newest one reports.
  const speakerTurn = useRef(0);

  // Where the speaker plays: the owner's pick while it is connected, else the device the Mac's default names NOW — so a
  // headset plugged in mid-call takes the voice with it. A pick that is gone becomes the system default and stays.
  const speakerRoute = useMemo(() => speakerFollowOf({ chosen: output, devices }), [devices, output]);
  useEffect(() => {
    if (speakerRoute.reset) {
      setOutput(SYSTEM_DEFAULT);
    }
  }, [setOutput, speakerRoute.reset]);

  // Applied once the element exists, call or not: the element outlives every call. A route replaced before its
  // switch settles does not get to report over the newer one.
  useEffect(() => {
    const element = speaker.current;
    if (element === null || !supported) {
      return undefined;
    }
    let latest = true;
    speakerTurn.current += 1;
    const mine = speakerTurn.current;
    void routeSpeaker({ element, target: speakerRoute.sinkId }).then((routed) => {
      if (latest && speakerTurn.current === mine) {
        speakerFailed.current = routed.failed !== undefined;
        setSinkId(routed.sinkId);
        setOutputFailed(routed.failed);
      }
      return routed;
    });
    return () => {
      latest = false;
    };
  }, [speaker, speakerRoute.sinkId, supported]);

  // A route refused while a device was still arriving is retried on the next device list — never re-applied while
  // it holds, where an output restart could be heard. Built fresh every render, so it reads this render's pick.
  const retryRoute = (rows: readonly DeviceRow[]): void => {
    const element = speaker.current;
    if (element === null || !supported || !speakerFailed.current) {
      return;
    }
    const target = speakerFollowOf({ chosen: output, devices: rows }).sinkId;
    speakerTurn.current += 1;
    const mine = speakerTurn.current;
    void routeSpeaker({ element, target }).then((routed) => {
      if (speakerTurn.current === mine) {
        speakerFailed.current = routed.failed !== undefined;
        setSinkId(routed.sinkId);
        setOutputFailed(routed.failed);
      }
      return routed;
    });
  };

  const playingOn = useCallback((): string | undefined => sinkNow({ speaker }), [speaker]);

  return { outputFailed, playingOn, retryRoute, sinkId, supported };
}

/** Whether this browser can choose a speaker. Read once, and `true` on the server so the first paint does not warn. */
function sinkSupported(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/** Nothing to subscribe to: whether a browser can choose a speaker does not change while the page is open. */
function subscribeNever(): () => void {
  return () => undefined;
}

/** The device the element plays on at this instant; `undefined` before it exists. */
function sinkNow({ speaker }: { speaker: RefObject<HTMLAudioElement | null> }): string | undefined {
  const element = speaker.current;
  if (element === null) {
    return undefined;
  }
  return element.sinkId;
}

/** Play the element through one device; what it plays on afterwards, and why not when it was refused. */
async function routeSpeaker({
  element,
  target,
}: {
  element: HTMLAudioElement;
  target: string;
}): Promise<{ sinkId: string; failed: string | undefined }> {
  try {
    await element.setSinkId(target);
    return { failed: undefined, sinkId: element.sinkId };
  } catch (cause) {
    return { failed: causeWords({ cause }), sinkId: element.sinkId };
  }
}
