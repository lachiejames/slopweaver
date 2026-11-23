/**
 * The browser half of the call's microphone: the device list, the device a live track is on, opening the owner's pick, and
 * switching a new microphone onto the call. `useAudioRoute.ts` decides when; this does it.
 *
 * A mid-call switch opens the new microphone, swaps it onto the peer connection's sender with `replaceTrack`, and only
 * then stops the old one, so the call never goes deaf in between.
 */
import type { OpenAILiveWebRTC } from "openai/live/webrtc";
import type { RefObject } from "react";

import {
  type DeviceRow,
  isPickedDeviceGone,
  micConstraintsOf,
  SYSTEM_DEFAULT,
  type TrackOnDevice,
} from "../../lib/audioDevices";
import { stillMine } from "../live/talkSession";

/** A microphone the call holds, and whether it opened on the system default because the owner's pick was not there. */
export interface OpenedMic {
  readonly stream: MediaStream;
  readonly fellBack: boolean;
}

/**
 * The rows of `enumerateDevices()`, copied out of the browser's live objects.
 *
 * @returns every device row, kind and label included
 */
export async function listDevices(): Promise<readonly DeviceRow[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.map((device) => ({
    deviceId: device.deviceId,
    groupId: device.groupId,
    kind: device.kind,
    label: device.label,
  }));
}

/**
 * The device a live track is on, read off the track.
 *
 * @returns its device and group, whether it ended, and its label
 */
export function trackOnDevice({ track }: { track: MediaStreamTrack }): TrackOnDevice {
  const settings = track.getSettings();
  let deviceId = "";
  if (settings.deviceId !== undefined) {
    deviceId = settings.deviceId;
  }
  let groupId = "";
  if (settings.groupId !== undefined) {
    groupId = settings.groupId;
  }
  return { deviceId, ended: track.readyState === "ended", groupId, label: track.label };
}

/**
 * Open the owner's picked microphone, or the system default — loudly — when the pick is not connected. A permission
 * refusal is thrown as it came, never retried.
 *
 * @param chosen the owner's stored pick
 * @returns the stream, and whether it fell back
 */
export async function openPickedMic({ chosen }: { chosen: string }): Promise<OpenedMic> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraintsOf({ chosen }) });
    return { fellBack: false, stream };
  } catch (cause) {
    const gone = cause instanceof DOMException && isPickedDeviceGone({ name: cause.name });
    if (chosen === SYSTEM_DEFAULT || !gone) {
      throw cause;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraintsOf({ chosen: SYSTEM_DEFAULT }) });
    return { fellBack: true, stream };
  }
}

/**
 * A refusal's words.
 *
 * @returns the error's message, or the thrown value as text
 */
export function causeWords({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Switch the live call to a picked microphone: open it, swap it onto the sender, then hold it. Every await is
 * re-checked against the call's generation and against a newer switch, and only a switch still the live one reports
 * why it did not land.
 *
 * @param chosen the pick to open
 * @param generation the call's generation, bumped by Stop
 * @param switches how many switches have started, bumped here so a later one overtakes this
 * @param muted the owner's mute, carried onto the new track
 * @param onFailed shows why the switch did not land
 * @param hold holds the microphone now on the sender
 * @returns whether the new microphone landed on the call
 */
export async function switchMicrophone({
  chosen,
  generation,
  switches,
  connection,
  microphone,
  audio,
  micMeter,
  muted,
  onFailed,
  hold,
}: {
  chosen: string;
  generation: RefObject<number>;
  switches: RefObject<number>;
  connection: RefObject<OpenAILiveWebRTC | undefined>;
  microphone: RefObject<MediaStream | undefined>;
  audio: RefObject<AudioContext | undefined>;
  micMeter: RefObject<AnalyserNode | undefined>;
  muted: RefObject<boolean>;
  onFailed: (reason: string) => void;
  hold: (opened: OpenedMic) => void;
}): Promise<boolean> {
  const mine = generation.current;
  switches.current += 1;
  const turn = switches.current;
  const alive = (): boolean => stillMine({ current: generation.current, mine });
  const current = (): boolean => alive() && switches.current === turn;
  let opened: OpenedMic;
  try {
    opened = await openPickedMic({ chosen });
  } catch (cause) {
    if (current()) {
      onFailed(causeWords({ cause }));
    }
    return false;
  }
  const swapped = await swapMicrophone({ alive, audio, connection, current, micMeter, microphone, muted, opened });
  if (swapped !== undefined) {
    if (current()) {
      onFailed(swapped);
    }
    return false;
  }
  // Held even when a newer pick has started: this IS the track on the sender until that pick lands. But a
  // fallback a newer pick overtook must not write the system default over that pick.
  hold(current() ? opened : { ...opened, fellBack: false });
  return true;
}

/**
 * Put a newly opened microphone on the call: onto the sender, then the meter, then the old one stopped. A microphone
 * that opens after Stop or after a newer pick is stopped before it reaches the sender; once it has, only Stop
 * discards it.
 *
 * @param opened the microphone just opened
 * @param current whether the call and this switch are still the live ones
 * @param alive whether the call is still the live one, whatever pick came since
 * @param muted the owner's mute, applied to the new track before it is heard
 * @returns `undefined` when swapped, else why not
 */
async function swapMicrophone({
  opened,
  current,
  alive,
  connection,
  microphone,
  audio,
  micMeter,
  muted,
}: {
  opened: OpenedMic;
  current: () => boolean;
  alive: () => boolean;
  connection: RefObject<OpenAILiveWebRTC | undefined>;
  microphone: RefObject<MediaStream | undefined>;
  audio: RefObject<AudioContext | undefined>;
  micMeter: RefObject<AnalyserNode | undefined>;
  muted: RefObject<boolean>;
}): Promise<string | undefined> {
  const drop = (): void => {
    opened.stream.getTracks().forEach((track) => {
      track.stop();
    });
  };
  const next = opened.stream.getAudioTracks().at(0);
  const conn = connection.current;
  if (!current() || next === undefined || conn === undefined) {
    drop();
    return "the call ended, or a newer pick replaced this one";
  }
  const sender = conn.peerConnection.getSenders().find((one) => one.track?.kind === "audio");
  if (sender === undefined) {
    drop();
    return "the call has no microphone sender to switch";
  }
  next.enabled = !muted.current;
  try {
    await sender.replaceTrack(next);
  } catch (cause) {
    drop();
    return causeWords({ cause });
  }
  // Once the sender carries the new track, only the call ending discards it. A newer pick that started meanwhile
  // swaps after this one — `replaceTrack` resolves in call order — so dropping it here would leave a STOPPED track
  // on the sender, and the call deaf, whenever that newer pick then failed to open.
  if (!alive()) {
    drop();
    return "the call ended before the switch landed";
  }
  // A mute pressed during the swap reached the old track, so it is re-read now.
  next.enabled = !muted.current;
  const old = microphone.current;
  microphone.current = opened.stream;
  old?.getTracks().forEach((track) => {
    track.stop();
  });
  const context = audio.current;
  if (context !== undefined) {
    const meter = context.createAnalyser();
    meter.fftSize = 64;
    context.createMediaStreamSource(opened.stream).connect(meter);
    micMeter.current = meter;
  }
  return undefined;
}
