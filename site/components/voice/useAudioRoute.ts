"use client";

/**
 * The call's audio route: which microphone and speaker it opens on, what it is ACTUALLY on, and a switch of either
 * while it runs. The words are `site/lib/audioDevices.ts`'s; this is the browser half.
 *
 * ## What the line reads is the track, never the pick
 *
 * A headset can be the macOS system input while the call hears the owner only near the laptop, and nothing says which
 * device the call is on. So the microphone line is read off the live track's own label and settings,
 * re-read when the device list changes and when the track ends.
 *
 * ## On the system default, the call follows the Mac
 *
 * Measured: a headset plugged in mid-call left neither side hearing the other until the call was reopened, so the
 * call follows the device the Mac selects.
 * A track opened on
 * Chrome's `default` stays on the device that was default when it opened, so on every device change and track end the
 * call reopens on the system default when the Mac names another device (`micFollowOf`), and the speaker element is
 * routed to the device the Mac's default names now rather than left on an empty sink (`speakerFollowOf`).
 *
 * ## A pick that is gone becomes the system default
 *
 * The owner's own pick of either device overrides the system default. When that device is not there — at open, or
 * unplugged mid-call — the call moves to the system default and the selector reads "System default" from then on: the
 * microphone line says, in its warning, that the pick was not there.
 *
 * ## A mid-call switch is held to the generation
 *
 * A switch opens the new microphone, swaps it onto the peer connection's sender with `replaceTrack`, and only then
 * stops the old one, so the call never goes deaf in between. Every await is re-checked against the call's generation
 * and against a newer switch: a microphone that opens after Stop, or after a later pick, is stopped on the spot.
 */
import type { OpenAILiveWebRTC } from "openai/live/webrtc";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type AudioRouteState,
  audioChoicesOf,
  type DeviceRow,
  inputReading,
  micFollowOf,
  outputReading,
  pickerOptionsOf,
  SYSTEM_DEFAULT,
  type TrackOnDevice,
} from "../../lib/audioDevices";
import { usePreference } from "../console/preference";
import {
  causeWords,
  listDevices,
  type OpenedMic,
  openPickedMic,
  switchMicrophone,
  trackOnDevice,
} from "./audioRouteBrowser";
import { useSpeakerRoute } from "./useSpeakerRoute";

/** The browser storage keys the owner's microphone and speaker picks are kept under between visits. */
const INPUT_STORAGE_KEY = "slopweaver.talk.inputDevice";
const OUTPUT_STORAGE_KEY = "slopweaver.talk.outputDevice";

/**
 * How many microphone follows a call starts within the window before it waits for the window to free — a chosen
 * bound, not a measured one: a default whose fresh tracks keep ending, or keep being refused, would otherwise
 * reopen as fast as the device list changes.
 */
const FOLLOW_LIMIT = 3;
const FOLLOW_WINDOW_MS = 10_000;

/** How long a refused follow waits before one more read of the devices, while a device is still arriving. */
const FOLLOW_RETRY_MS = 1000;

/** Any stored device id. A pick no longer connected is still the owner's pick, and the picker says so. */
function isStoredDevice(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * The call's audio route. Called once, by `VoiceProvider`, with the refs the call itself holds.
 *
 * @param generation the call's generation, bumped by Stop
 * @param connection the peer connection a switch swaps its track on
 * @param microphone the stream the call holds, replaced by a switch
 * @param audio the call's audio context, where a switched microphone's meter is wired
 * @param micMeter the microphone's analyser, which the orb's bars read every tick
 * @param speaker the element the voice plays through
 * @param muted whether the owner's microphone is muted, carried across a switch
 * @returns the route's state, and what the call calls at open and at stop
 */
export function useAudioRoute({
  generation,
  connection,
  microphone,
  audio,
  micMeter,
  speaker,
  muted,
}: {
  generation: RefObject<number>;
  connection: RefObject<OpenAILiveWebRTC | undefined>;
  microphone: RefObject<MediaStream | undefined>;
  audio: RefObject<AudioContext | undefined>;
  micMeter: RefObject<AnalyserNode | undefined>;
  speaker: RefObject<HTMLAudioElement | null>;
  muted: boolean;
}): {
  readonly route: AudioRouteState;
  readonly openMic: () => Promise<OpenedMic>;
  readonly holdMic: (opened: OpenedMic) => void;
  readonly releaseMic: () => void;
} {
  const { set: setInput, value: input } = usePreference<string>({
    accept: isStoredDevice,
    fallback: SYSTEM_DEFAULT,
    key: INPUT_STORAGE_KEY,
  });
  const { set: setOutput, value: output } = usePreference<string>({
    accept: isStoredDevice,
    fallback: SYSTEM_DEFAULT,
    key: OUTPUT_STORAGE_KEY,
  });
  const [devices, setDevices] = useState<readonly DeviceRow[]>([]);
  const [track, setTrack] = useState<TrackOnDevice | undefined>(undefined);
  const [fellBack, setFellBack] = useState(false);
  const [inputFailed, setInputFailed] = useState<string | undefined>(undefined);
  const chosenInput = useRef(input);
  const mutedNow = useRef(muted);
  // Written after every render, as `VoiceProvider`'s own `items` ref is: a call opening, or a switch, reads the
  // pick and the mute as they are now rather than as a stale closure saw them.
  useEffect(() => {
    chosenInput.current = input;
    mutedNow.current = muted;
  });
  const held = useRef<MediaStreamTrack | undefined>(undefined);
  const switches = useRef(0);
  // The default's group the call last followed toward and landed on. A reopened default that never reports that
  // group would otherwise follow again on every list it re-reads; a follow that did not land clears it, so the next
  // device change retries.
  const followedTo = useRef<string | undefined>(undefined);
  // The switch opening a microphone now (0 for none), and whether a list arrived meanwhile. One switch at a time:
  // two racing switches drop the first's working microphone, and a refused second leaves the dead track on the
  // sender; a follow racing the owner's own pick would write the system default over it.
  const busy = useRef(0);
  const busySeq = useRef(0);
  const missed = useRef(false);
  // When this call's recent follows happened, and the one re-read held for when that window frees.
  const attempts = useRef<readonly number[]>([]);
  const capTimer = useRef<number | undefined>(undefined);
  // What a fresh device list is handed to: set below, once the switch and the pick they read exist.
  const follow = useRef<(rows: readonly DeviceRow[]) => void>(() => undefined);
  const retrySpeaker = useRef<(rows: readonly DeviceRow[]) => void>(() => undefined);

  const refresh = useCallback((): void => {
    void listDevices().then(
      (rows) => {
        setDevices(rows);
        follow.current(rows);
        retrySpeaker.current(rows);
        return rows;
      },
      () => undefined,
    );
    const live = held.current;
    if (live !== undefined) {
      setTrack(trackOnDevice({ track: live }));
    }
  }, []);

  useEffect(() => {
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, [refresh]);

  // Called here, after the device-list effect and before the follow below, so the speaker's effects, then its retry
  // handed to the next device list, keep their order.
  const { outputFailed, playingOn, retryRoute, sinkId, supported } = useSpeakerRoute({
    devices,
    output,
    setOutput,
    speaker,
  });
  useEffect(() => {
    retrySpeaker.current = retryRoute;
  });

  const holdMic = useCallback(
    ({ stream, fellBack: fell }: OpenedMic): void => {
      const next = stream.getAudioTracks().at(0);
      held.current = next;
      setFellBack(fell);
      setInputFailed(undefined);
      // The owner's pick was not there, so the call opened on the system default — and the selector says so from now on.
      if (fell) {
        setInput(SYSTEM_DEFAULT);
        chosenInput.current = SYSTEM_DEFAULT;
      }
      if (next === undefined) {
        setTrack(undefined);
        return;
      }
      next.addEventListener("ended", () => {
        if (held.current === next) {
          setTrack(trackOnDevice({ track: next }));
          refresh();
        }
      });
      setTrack(trackOnDevice({ track: next }));
      refresh();
    },
    [refresh, setInput],
  );

  const releaseMic = useCallback((): void => {
    switches.current += 1;
    held.current = undefined;
    followedTo.current = undefined;
    busy.current = 0;
    missed.current = false;
    attempts.current = [];
    window.clearTimeout(capTimer.current);
    capTimer.current = undefined;
    setTrack(undefined);
    setFellBack(false);
    setInputFailed(undefined);
  }, []);

  const openMic = useCallback((): Promise<OpenedMic> => openPickedMic({ chosen: chosenInput.current }), []);

  const switchInput = useCallback(
    ({ chosen }: { chosen: string }): Promise<boolean> =>
      switchMicrophone({
        audio,
        chosen,
        connection,
        generation,
        hold: holdMic,
        micMeter,
        microphone,
        muted: mutedNow,
        onFailed: setInputFailed,
        switches,
      }),
    [audio, connection, generation, holdMic, micMeter, microphone],
  );

  // A switch held to "one at a time": a list arriving meanwhile is re-read once it settles, and a refused switch
  // reads the list again a moment later, since a refusal while a device is arriving or leaving is often transient.
  const switchOnce = useCallback(
    async ({ chosen }: { chosen: string }): Promise<boolean> => {
      busySeq.current += 1;
      const mine = busySeq.current;
      busy.current = mine;
      missed.current = false;
      let landed = false;
      try {
        landed = await switchInput({ chosen });
      } catch (cause) {
        if (busy.current === mine) {
          setInputFailed(causeWords({ cause }));
        }
      }
      if (busy.current !== mine) {
        return landed;
      }
      busy.current = 0;
      if (!landed) {
        window.setTimeout(() => {
          refresh();
        }, FOLLOW_RETRY_MS);
      } else if (missed.current) {
        refresh();
      }
      return landed;
    },
    [refresh, switchInput],
  );

  const pickInput = useCallback(
    (next: string): void => {
      setInput(next);
      chosenInput.current = next;
      followedTo.current = undefined;
      attempts.current = [];
      if (microphone.current !== undefined && connection.current !== undefined) {
        void switchOnce({ chosen: next });
      }
    },
    [connection, microphone, setInput, switchOnce],
  );

  // The call follows the Mac: on the system default, a moved default or an
  // unplugged microphone reopens on whatever the Mac names now; a picked microphone that is gone becomes the system
  // default and stays. Decided on the list just read, never on render state — the first render's empty list would
  // read the owner's pick as unplugged.
  useEffect(() => {
    follow.current = (rows) => {
      const live = held.current;
      if (live === undefined) {
        return;
      }
      const inputs = audioChoicesOf({ devices: rows }).inputs;
      const onDevice = trackOnDevice({ track: live });
      const decision = micFollowOf({ chosen: chosenInput.current, inputs, track: onDevice });
      if (decision === "stay") {
        return;
      }
      if (busy.current !== 0) {
        missed.current = true;
        return;
      }
      if (decision === "reset") {
        setInput(SYSTEM_DEFAULT);
        chosenInput.current = SYSTEM_DEFAULT;
      }
      const toward = inputs[0].groupId;
      if (!onDevice.ended && followedTo.current === toward) {
        return;
      }
      // Bounded by rate, never by count: past the limit the call waits for the window to free and reads once more,
      // so a microphone that comes back after a run of refusals is still followed. The refusal on show stays the
      // real one.
      const now = Date.now();
      const recent = attempts.current.filter((at) => now - at < FOLLOW_WINDOW_MS);
      if (recent.length >= FOLLOW_LIMIT) {
        if (capTimer.current === undefined) {
          capTimer.current = window.setTimeout(
            () => {
              capTimer.current = undefined;
              refresh();
            },
            recent[0]! + FOLLOW_WINDOW_MS - now,
          );
        }
        return;
      }
      attempts.current = [...recent, now];
      if (microphone.current === undefined || connection.current === undefined) {
        return;
      }
      const call = generation.current;
      void switchOnce({ chosen: SYSTEM_DEFAULT }).then((landed) => {
        // A follow that Stop overtook must not touch the next call's record.
        if (generation.current === call) {
          followedTo.current = landed ? toward : undefined;
        }
        return landed;
      });
    };
  });

  const route = useMemo((): AudioRouteState => {
    const choices = audioChoicesOf({ devices });
    return {
      input,
      inputs: pickerOptionsOf({ chosen: input, devices: choices.inputs }),
      mic: inputReading({ chosen: input, failed: inputFailed, fellBack, inputs: choices.inputs, track }),
      output,
      outputs: pickerOptionsOf({ chosen: output, devices: choices.outputs }),
      pickInput,
      pickOutput: setOutput,
      playingOn,
      speaker: outputReading({ failed: outputFailed, outputs: choices.outputs, sinkId, supported }),
    };
  }, [
    devices,
    fellBack,
    input,
    inputFailed,
    output,
    outputFailed,
    pickInput,
    playingOn,
    setOutput,
    sinkId,
    supported,
    track,
  ]);

  return { holdMic, openMic, releaseMic, route };
}
